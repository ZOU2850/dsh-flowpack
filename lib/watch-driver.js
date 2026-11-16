/**
 * Windows human-screen watcher driver for dsh-flowpack.
 * Compiles `lib/WatchHelper.cs` on first use with Windows in-box .NET Framework `csc.exe`
 * (cached by SHA-256 hash under `%LOCALAPPDATA%\dsh-flowpack\`), with automatic signed `powershell.exe`
 * hosting fallback under Smart App Control / CodeIntegrity policies.
 */

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REFERENCES = [
  'System.dll',
  'System.Drawing.dll',
  'System.Windows.Forms.dll',
  'System.Web.Extensions.dll',
  'WindowsBase.dll',
  'UIAutomationClient.dll',
  'UIAutomationTypes.dll',
]

const POLICY_CODES = new Set(['UNKNOWN', 'EACCES', 'EPERM'])

function isPolicyBlock(error) {
  return POLICY_CODES.has(String(error?.code)) && error?.syscall?.startsWith('spawn') === true
}

function frameworkDir() {
  const windir = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319')
}

function powershellPath() {
  const windir = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function helperSourcePath() {
  return fileURLToPath(new URL('./WatchHelper.cs', import.meta.url))
}

function hostScriptPath() {
  return fileURLToPath(new URL('./host.ps1', import.meta.url))
}

export function resolveWatchHelperPaths() {
  return {
    sourcePath: helperSourcePath(),
    hostScriptPath: hostScriptPath(),
    cscPath: join(frameworkDir(), 'csc.exe'),
  }
}

let buildingPromise
let hostedHelper = false

/** Compile `WatchHelper.cs` once per source SHA-256 and return the cached exe path. */
export async function ensureWatchHelperExe(source = helperSourcePath()) {
  if (process.platform !== 'win32') {
    throw new Error('Live screen watching is currently supported on Windows only.')
  }
  const csc = join(frameworkDir(), 'csc.exe')
  if (!existsSync(csc)) {
    throw new Error(`.NET Framework csc.exe not found at ${csc}`)
  }
  buildingPromise ??= (async () => {
    const code = await readFile(source)
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 12)
    const dir = join(process.env.LOCALAPPDATA ?? tmpdir(), 'dsh-flowpack', `watch-${hash}`)
    const exe = join(dir, 'fp-watch.exe')
    if (existsSync(exe)) return exe
    await mkdir(dir, { recursive: true })
    const temp = join(dir, `build-${process.pid}-${Date.now()}.exe`)
    const args = [
      '-nologo',
      '-optimize+',
      '-target:exe',
      `-out:${temp}`,
      `-lib:${join(frameworkDir(), 'WPF')}`,
      ...REFERENCES.map(ref => `-r:${ref}`),
      source,
    ]
    await new Promise((resolve, reject) => {
      execFile(csc, args, { windowsHide: true, timeout: 120000 }, (error, stdout) => {
        if (error) reject(new Error(`Compiling WatchHelper failed: ${String(stdout).trim() || error.message}`))
        else resolve()
      })
    })
    try {
      await rename(temp, exe)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      if (!existsSync(exe)) throw error
    }
    return exe
  })()
  try {
    return await buildingPromise
  } catch (error) {
    buildingPromise = undefined
    throw error
  }
}

/** Manages the persistent Windows screen-watching helper process cleanly. */
export class Win32WatchDriver {
  constructor(log = () => {}) {
    this.log = log
    this.child = undefined
    this.starting = undefined
    this.pending = new Map()
    this.listeners = new Set()
    this.nextId = 0
    this.disposed = false
    this.activeTrainId = ''
  }

  onAction(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isSupported() {
    return process.platform === 'win32'
  }

  async start({ trainId, outDir, intervalMs = 130, maxLongEdge = 1280, quality = 65 }) {
    this.activeTrainId = trainId || ''
    return this.call('start', { outDir, intervalMs, maxLongEdge, quality }, 25000)
  }

  async captureNow(reason = 'manual_capture') {
    return this.call('capture_now', { reason }, 15000)
  }

  async stop() {
    this.activeTrainId = ''
    if (!this.child || this.child.exitCode !== null) return { watching: false }
    try {
      return await this.call('stop', {}, 5000)
    } finally {
      this.kill()
    }
  }

  async call(cmd, args = {}, timeoutMs = 20000) {
    if (this.disposed) throw new Error('Watch driver is disposed.')
    const child = await this.ensure()
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`WatchHelper timed out on "${cmd}"`))
        this.kill()
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ ...args, id, cmd })}\n`)
    })
  }

  async ensure() {
    if (this.child && this.child.exitCode === null) return this.child
    this.starting ??= this.startProcess().catch((error) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  async startProcess() {
    const exe = await ensureWatchHelperExe()
    if (!hostedHelper) {
      try {
        return await this.launch(exe, [])
      } catch (error) {
        if (!isPolicyBlock(error)) throw error
        this.log(`[dsh-flowpack] WatchHelper exe blocked (${error.code}); falling back to signed PowerShell host`)
        hostedHelper = true
      }
    }
    return this.launch(powershellPath(), [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      hostScriptPath(),
      exe,
    ])
  }

  launch(command, args) {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let buffer = ''
    let resolveReady
    let settled = false
    const readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve
      child.once('error', (err) => {
        if (!settled) { settled = true; reject(err) }
      })
      setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('WatchHelper did not report ready in time.')) }
      }, 15000).unref()
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.event === 'ready') {
          if (!settled) { settled = true; resolveReady(child) }
          continue
        }
        if (msg.event === 'action') {
          for (const listener of this.listeners) {
            try { listener({ ...msg, trainId: this.activeTrainId }) } catch { /* ignore */ }
          }
          continue
        }
        if (typeof msg.id === 'number') {
          const entry = this.pending.get(msg.id)
          if (entry) {
            this.pending.delete(msg.id)
            clearTimeout(entry.timer)
            if (msg.ok) entry.resolve(msg.result ?? null)
            else entry.reject(new Error(msg.error || 'WatchHelper error'))
          }
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const t = String(chunk).trim()
      if (t) this.log(`[WatchHelper stderr] ${t.slice(0, 200)}`)
    })

    child.on('exit', (code) => {
      if (this.child === child) this.child = undefined
      this.starting = undefined
      if (!settled) {
        settled = true
      }
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(new Error(`WatchHelper exited (${String(code)})`))
        this.pending.delete(id)
      }
    })

    return readyPromise.then(() => {
      this.child = child
      return child
    })
  }

  kill() {
    const child = this.child
    this.child = undefined
    this.starting = undefined
    if (child && child.exitCode === null) {
      try { child.stdin.end() } catch { /* ignore */ }
      setTimeout(() => {
        if (child.exitCode === null) child.kill()
      }, 600).unref()
    }
  }

  dispose() {
    this.disposed = true
    this.activeTrainId = ''
    this.kill()
    this.listeners.clear()
  }
}
