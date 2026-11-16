/**
 * Atomic JSON storage for dsh-flowpack under `$DSH_HOME/flowpack` (or configured `storageDir`).
 * Uses serialized write queues and temp-file rename so settings, distilled workflows,
 * strict memory packs, immutable archives, and quarantine records remain crash-safe.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { clampInt, pathKey, resolveDshHome, slugifyId } from './util.js'

export const DEFAULT_PREFERENCES = Object.freeze({
  strictMode: true,
  requireSealedForInjection: false,
  autoInject: true,
  autoDistillOnIdle: false,
  autoPackOnCompact: true,
  autoConsolidateOnIdle: true,
  selfHealEnabled: true,
  subagentInheritance: true,
  crystallizeThreshold: 3,
  redactSecrets: 'mask', // 'mask' | 'reject' | 'off'
  promptBudgetChars: 3600,
  maxTotalPackChars: 8000,
  maxEntryChars: 500,
  maxEntriesPerSection: 24,
  defaultScope: 'workspace',
  appearanceTheme: 'host',
})

/** Sanitize persisted preferences with safe numeric and enum bounds. */
export function normalizePreferences(raw, fallback = DEFAULT_PREFERENCES) {
  const input = typeof raw === 'object' && raw !== null ? raw : {}
  const redact = input.redactSecrets === 'reject' || input.redactSecrets === 'off' ? input.redactSecrets : 'mask'
  const scope = input.defaultScope === 'session' || input.defaultScope === 'global' || input.defaultScope === 'workflow'
    ? input.defaultScope
    : 'workspace'
  const theme = input.appearanceTheme === 'dark' || input.appearanceTheme === 'light' || input.appearanceTheme === 'system'
    ? input.appearanceTheme
    : 'host'
  return {
    strictMode: typeof input.strictMode === 'boolean' ? input.strictMode : fallback.strictMode,
    requireSealedForInjection: typeof input.requireSealedForInjection === 'boolean'
      ? input.requireSealedForInjection
      : fallback.requireSealedForInjection,
    autoInject: typeof input.autoInject === 'boolean' ? input.autoInject : fallback.autoInject,
    autoDistillOnIdle: typeof input.autoDistillOnIdle === 'boolean' ? input.autoDistillOnIdle : fallback.autoDistillOnIdle,
    autoPackOnCompact: typeof input.autoPackOnCompact === 'boolean' ? input.autoPackOnCompact : fallback.autoPackOnCompact,
    autoConsolidateOnIdle: typeof input.autoConsolidateOnIdle === 'boolean'
      ? input.autoConsolidateOnIdle
      : fallback.autoConsolidateOnIdle,
    selfHealEnabled: typeof input.selfHealEnabled === 'boolean' ? input.selfHealEnabled : fallback.selfHealEnabled,
    subagentInheritance: typeof input.subagentInheritance === 'boolean'
      ? input.subagentInheritance
      : fallback.subagentInheritance,
    crystallizeThreshold: clampInt(input.crystallizeThreshold, 1, 10, fallback.crystallizeThreshold),
    redactSecrets: redact,
    promptBudgetChars: clampInt(input.promptBudgetChars, 400, 16000, fallback.promptBudgetChars),
    maxTotalPackChars: clampInt(input.maxTotalPackChars, 1000, 32000, fallback.maxTotalPackChars),
    maxEntryChars: clampInt(input.maxEntryChars, 120, 2000, fallback.maxEntryChars),
    maxEntriesPerSection: clampInt(input.maxEntriesPerSection, 4, 100, fallback.maxEntriesPerSection),
    defaultScope: scope,
    appearanceTheme: theme,
  }
}

/** Write UTF-8 text atomically via a temporary sibling file. */
async function writeFileAtomic(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tempPath, content, 'utf8')
  try {
    await rename(tempPath, filePath)
  } catch (error) {
    try { await rm(tempPath, { force: true }) } catch { /* ignore */ }
    throw error
  }
}

/** Read and parse a JSON file, returning `{ readable, exists, value, error }`. */
async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return { exists: true, readable: true, value: JSON.parse(raw), error: '' }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, readable: true, value: undefined, error: '' }
    }
    return {
      exists: true,
      readable: false,
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Assert an identifier stays strictly single-segment inside its collection directory. */
function safeCollectionId(id, prefix = 'item') {
  const text = String(id ?? '').trim()
  if (/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(text) && !text.includes('..')) return text
  return slugifyId(text, prefix)
}

/** Durable FlowPack store with atomic file operations and serialized write queue. */
export class FlowPackStore {
  /**
   * @param {string} [rootDir] - explicit directory override (for tests/config).
   */
  constructor(rootDir) {
    this.rootDir = resolve(typeof rootDir === 'string' && rootDir.trim().length > 0
      ? rootDir.trim()
      : join(resolveDshHome(), 'flowpack'))
    this.configPath = join(this.rootDir, 'config.json')
    this.workflowsDir = join(this.rootDir, 'workflows')
    this.packsDir = join(this.rootDir, 'packs')
    this.capsulesDir = join(this.rootDir, 'capsules')
    this.apprenticeshipsDir = join(this.rootDir, 'apprenticeships')
    this.activationsPath = join(this.rootDir, 'activations.json')
    this.archivesDir = join(this.rootDir, 'archives')
    this.quarantineDir = join(this.rootDir, 'quarantine')
    this.auditPath = join(this.rootDir, 'audit.json')
    this.writeQueue = Promise.resolve()
    this.prefCache = undefined
    this.activationsCache = undefined
    this.fileCache = new Map() // filePath -> { mtimeMs, size, value }
    this.workflowsCache = undefined
    this.packsCache = undefined
    this.capsulesCache = undefined
    this.apprenticeshipsCache = undefined
  }

  /** Clear cached parsed files and directory listings (useful after external disk edits). */
  invalidateCaches() {
    this.fileCache.clear()
    this.workflowsCache = undefined
    this.packsCache = undefined
    this.capsulesCache = undefined
    this.apprenticeshipsCache = undefined
  }

  async readJsonCached(filePath, bypassCache = false) {
    try {
      const st = await stat(filePath)
      const cached = !bypassCache ? this.fileCache.get(filePath) : undefined
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return { exists: true, readable: true, value: cached.value, error: '' }
      }
      const raw = await readFile(filePath, 'utf8')
      const value = JSON.parse(raw)
      this.fileCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, value })
      return { exists: true, readable: true, value, error: '' }
    } catch (error) {
      this.fileCache.delete(filePath)
      if (error && error.code === 'ENOENT') {
        return { exists: false, readable: true, value: undefined, error: '' }
      }
      return {
        exists: true,
        readable: false,
        value: undefined,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Ensure directory tree exists without deleting existing data. */
  async ensureDirs() {
    await Promise.all([
      mkdir(this.rootDir, { recursive: true }),
      mkdir(this.workflowsDir, { recursive: true }),
      mkdir(this.packsDir, { recursive: true }),
      mkdir(this.capsulesDir, { recursive: true }),
      mkdir(this.apprenticeshipsDir, { recursive: true }),
      mkdir(this.archivesDir, { recursive: true }),
      mkdir(this.quarantineDir, { recursive: true }),
    ])
  }

  /** Serialize mutations through one FIFO queue to prevent interleaved renames. */
  enqueue(task) {
    const run = this.writeQueue.then(() => task())
    this.writeQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Describe active storage paths for diagnostics and Settings UI. */
  paths() {
    return {
      rootDir: this.rootDir,
      configPath: this.configPath,
      workflowsDir: this.workflowsDir,
      packsDir: this.packsDir,
      capsulesDir: this.capsulesDir,
      activationsPath: this.activationsPath,
      archivesDir: this.archivesDir,
      quarantineDir: this.quarantineDir,
      auditPath: this.auditPath,
    }
  }

  /** Read user preferences, falling back cleanly to defaults if missing or corrupt. */
  async readPreferences() {
    if (this.prefCache !== undefined) return this.prefCache
    const res = await readJsonSafe(this.configPath)
    const prefs = normalizePreferences(res.value, DEFAULT_PREFERENCES)
    this.prefCache = prefs
    return prefs
  }

  /** Update user preferences atomically. */
  async updatePreferences(patch) {
    return this.enqueue(async () => {
      const current = await this.readPreferences()
      const next = normalizePreferences({ ...current, ...(patch || {}) }, current)
      await writeFileAtomic(this.configPath, `${JSON.stringify(next, null, 2)}\n`)
      this.prefCache = next
      return next
    })
  }

  /* ───────────────────────────── workflows ───────────────────────────── */

  workflowFilePath(workflowId) {
    return join(this.workflowsDir, `${safeCollectionId(workflowId, 'wf')}.json`)
  }

  /** Read one persisted workflow by id. */
  async readWorkflow(workflowId) {
    const res = await readJsonSafe(this.workflowFilePath(workflowId))
    return res.readable && res.value && typeof res.value === 'object' ? res.value : undefined
  }

  /** Persist a workflow atomically. */
  async saveWorkflow(workflow) {
    const safeId = safeCollectionId(workflow?.workflowId, 'wf')
    const targetPath = this.workflowFilePath(safeId)
    return this.enqueue(async () => {
      await mkdir(this.workflowsDir, { recursive: true })
      await writeFileAtomic(targetPath, `${JSON.stringify(workflow, null, 2)}\n`)
      this.fileCache.delete(targetPath)
      this.workflowsCache = undefined
      return workflow
    })
  }

  /** Remove a workflow by id. */
  async deleteWorkflow(workflowId) {
    const targetPath = this.workflowFilePath(workflowId)
    return this.enqueue(async () => {
      try {
        await rm(targetPath, { force: true })
        this.fileCache.delete(targetPath)
        this.workflowsCache = undefined
        return true
      } catch {
        return false
      }
    })
  }

  /** List all persisted workflows sorted by updatedAt descending. */
  async listWorkflows({ bypassCache = false } = {}) {
    if (!bypassCache && this.workflowsCache !== undefined) return this.workflowsCache
    try {
      const entries = await readdir(this.workflowsDir, { withFileTypes: true })
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'))
      const reads = await Promise.all(files.map(e => this.readJsonCached(join(this.workflowsDir, e.name), bypassCache)))
      const items = []
      for (const res of reads) {
        if (res.readable && res.value && typeof res.value === 'object' && res.value.workflowId) {
          items.push(res.value)
        }
      }
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      this.workflowsCache = items
      return items
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
  }

  /* ───────────────────────────── memory packs ───────────────────────────── */

  packFilePath(packId) {
    return join(this.packsDir, `${safeCollectionId(packId, 'pack')}.json`)
  }

  /** Read one memory pack by id (returns `{ exists, readable, pack, error }`). */
  async readPack(packId) {
    const res = await readJsonSafe(this.packFilePath(packId))
    return {
      exists: res.exists,
      readable: res.readable,
      pack: res.readable && res.value && typeof res.value === 'object' ? res.value : undefined,
      error: res.error,
    }
  }

  /** Persist a validated memory pack atomically. */
  async savePack(pack) {
    const safeId = safeCollectionId(pack?.packId, 'pack')
    const targetPath = this.packFilePath(safeId)
    return this.enqueue(async () => {
      await mkdir(this.packsDir, { recursive: true })
      await writeFileAtomic(targetPath, `${JSON.stringify(pack, null, 2)}\n`)
      this.fileCache.delete(targetPath)
      this.packsCache = undefined
      return pack
    })
  }

  /** Remove a memory pack by id. */
  async deletePack(packId) {
    const targetPath = this.packFilePath(packId)
    return this.enqueue(async () => {
      try {
        await rm(targetPath, { force: true })
        this.fileCache.delete(targetPath)
        this.packsCache = undefined
        return true
      } catch {
        return false
      }
    })
  }

  /** List all stored memory packs plus any unreadable filenames found on disk. */
  async listPacks({ bypassCache = false } = {}) {
    if (!bypassCache && this.packsCache !== undefined) return this.packsCache
    try {
      const entries = await readdir(this.packsDir, { withFileTypes: true })
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'))
      const reads = await Promise.all(files.map(async (e) => {
        const filePath = join(this.packsDir, e.name)
        return { name: e.name, filePath, res: await this.readJsonCached(filePath, bypassCache) }
      }))
      const packs = []
      const corrupt = []
      for (const { name, filePath, res } of reads) {
        if (!res.readable || !res.value || typeof res.value !== 'object' || !res.value.packId) {
          corrupt.push({ file: name, path: filePath, error: res.error || 'Malformed pack object' })
          continue
        }
        packs.push(res.value)
      }
      packs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      const result = { packs, corrupt }
      if (!bypassCache) this.packsCache = result
      return result
    } catch (error) {
      if (error && error.code === 'ENOENT') return { packs: [], corrupt: [] }
      throw error
    }
  }

  /** Save an immutable sealed `.dshpack.json` snapshot (and optional `.md` companion) to `archives/`. */
  async writeArchiveSnapshot(pack, markdownCompanion) {
    const safeId = safeCollectionId(pack?.packId, 'pack')
    const ver = clampInt(pack?.version, 1, 1_000_000, 1)
    const jsonName = `${safeId}-v${ver}.dshpack.json`
    const jsonPath = join(this.archivesDir, jsonName)
    const mdName = `${safeId}-v${ver}.flowpack.md`
    const mdPath = join(this.archivesDir, mdName)
    return this.enqueue(async () => {
      await mkdir(this.archivesDir, { recursive: true })
      await writeFileAtomic(jsonPath, `${JSON.stringify(pack, null, 2)}\n`)
      if (typeof markdownCompanion === 'string' && markdownCompanion.length > 0) {
        await writeFileAtomic(mdPath, markdownCompanion)
      }
      return { jsonPath, mdPath: typeof markdownCompanion === 'string' ? mdPath : undefined }
    })
  }

  /** Read all archived revision snapshots for a pack (sorted newest version first). */
  async listPackArchives(packId) {
    const safeId = safeCollectionId(packId, 'pack')
    const prefix = `${safeId}-v`
    try {
      const entries = await readdir(this.archivesDir, { withFileTypes: true })
      const files = entries.filter(e => e.isFile() && e.name.startsWith(prefix) && e.name.endsWith('.dshpack.json'))
      const reads = await Promise.all(files.map(e => this.readJsonCached(join(this.archivesDir, e.name))))
      const snapshots = []
      for (const res of reads) {
        if (res.readable && res.value && typeof res.value === 'object') {
          snapshots.push(res.value)
        }
      }
      snapshots.sort((a, b) => (b.version || 0) - (a.version || 0))
      return snapshots
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Quarantine a tampered or corrupted memory pack out of the active `packs/` directory. */
  async quarantinePack(pack, reason, details = {}) {
    const safeId = safeCollectionId(pack?.packId, 'corrupt-pack')
    const stamp = Date.now()
    const target = join(this.quarantineDir, `${safeId}-${stamp}.quarantine.json`)
    return this.enqueue(async () => {
      await mkdir(this.quarantineDir, { recursive: true })
      await writeFileAtomic(target, `${JSON.stringify({
        quarantinedAt: stamp,
        reason,
        details,
        pack,
      }, null, 2)}\n`)
      try {
        const currentFile = this.packFilePath(safeId)
        await stat(currentFile)
        await rm(currentFile, { force: true })
        this.fileCache.delete(currentFile)
      } catch {
        // Original pack might already have been moved or imported cleanly.
      }
      this.packsCache = undefined
      return target
    })
  }

  /** List quarantined records (most recent first). */
  async listQuarantined(limit = 30) {
    try {
      const entries = await readdir(this.quarantineDir, { withFileTypes: true })
      const items = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const res = await readJsonSafe(join(this.quarantineDir, entry.name))
        if (res.readable && res.value) {
          items.push({ file: entry.name, ...res.value })
        }
      }
      items.sort((a, b) => (b.quarantinedAt || 0) - (a.quarantinedAt || 0))
      return items.slice(0, clampInt(limit, 1, 200, 30))
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
  }

  /* ─────────────────────── experience capsules & activations ─────────────────────── */

  capsuleFilePath(capsuleId) {
    return join(this.capsulesDir, `${safeCollectionId(capsuleId, 'cap')}.json`)
  }

  /** Read one experience capsule by id. */
  async readCapsule(capsuleId) {
    const res = await readJsonSafe(this.capsuleFilePath(capsuleId))
    return res.readable && res.value && typeof res.value === 'object' ? res.value : undefined
  }

  /** Persist an experience capsule atomically. */
  async saveCapsule(capsule) {
    const safeId = safeCollectionId(capsule?.capsuleId, 'cap')
    const targetPath = this.capsuleFilePath(safeId)
    return this.enqueue(async () => {
      await mkdir(this.capsulesDir, { recursive: true })
      await writeFileAtomic(targetPath, `${JSON.stringify(capsule, null, 2)}\n`)
      this.fileCache.delete(targetPath)
      this.capsulesCache = undefined
      return capsule
    })
  }

  /** Delete an experience capsule by id. */
  async deleteCapsule(capsuleId) {
    const targetPath = this.capsuleFilePath(capsuleId)
    return this.enqueue(async () => {
      try {
        await rm(targetPath, { force: true })
        this.fileCache.delete(targetPath)
        this.capsulesCache = undefined
        return true
      } catch {
        return false
      }
    })
  }

  /** List all persisted experience capsules sorted by crystallization + updatedAt. */
  async listCapsules({ bypassCache = false } = {}) {
    if (!bypassCache && this.capsulesCache !== undefined) return this.capsulesCache
    try {
      const entries = await readdir(this.capsulesDir, { withFileTypes: true })
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'))
      const reads = await Promise.all(files.map(async (e) => {
        const filePath = join(this.capsulesDir, e.name)
        return { name: e.name, filePath, res: await this.readJsonCached(filePath, bypassCache) }
      }))
      const capsules = []
      const corrupt = []
      for (const { name, filePath, res } of reads) {
        if (!res.readable || !res.value || typeof res.value !== 'object' || !res.value.capsuleId) {
          corrupt.push({ file: name, path: filePath, error: res.error || 'Malformed capsule object' })
          continue
        }
        capsules.push(res.value)
      }
      const rank = { crystallized: 0, emerging: 1, exploring: 2 }
      capsules.sort((a, b) => {
        const ra = rank[a.maturity] ?? 3
        const rb = rank[b.maturity] ?? 3
        if (ra !== rb) return ra - rb
        return (b.updatedAt || 0) - (a.updatedAt || 0)
      })
      const result = { capsules, corrupt }
      if (!bypassCache) this.capsulesCache = result
      return result
    } catch (error) {
      if (error && error.code === 'ENOENT') return { capsules: [], corrupt: [] }
      throw error
    }
  }

  /* ───────────────────────────── apprenticeships (Watch & Train) ───────────────────────────── */

  apprenticeshipPath(trainId) {
    return join(this.apprenticeshipsDir, `${safeCollectionId(trainId, 'train')}.json`)
  }

  apprenticeshipFramesDir(trainId) {
    return join(this.apprenticeshipsDir, safeCollectionId(trainId, 'train'), 'frames')
  }

  async saveApprenticeship(item) {
    if (!item || typeof item !== 'object' || !item.trainId) {
      throw new Error('Cannot save apprenticeship without trainId.')
    }
    return this.enqueue(async () => {
      await mkdir(this.apprenticeshipsDir, { recursive: true })
      const targetPath = this.apprenticeshipPath(item.trainId)
      await writeFileAtomic(targetPath, `${JSON.stringify(item, null, 2)}\n`)
      this.fileCache.delete(targetPath)
      this.apprenticeshipsCache = undefined
      return item
    })
  }

  async readApprenticeship(trainId) {
    const res = await this.readJsonCached(this.apprenticeshipPath(trainId))
    return res.readable ? res.value : undefined
  }

  async deleteApprenticeship(trainId) {
    return this.enqueue(async () => {
      try {
        const targetPath = this.apprenticeshipPath(trainId)
        await rm(targetPath, { force: true })
        await rm(join(this.apprenticeshipsDir, safeCollectionId(trainId, 'train')), { recursive: true, force: true }).catch(() => {})
        this.fileCache.delete(targetPath)
        this.apprenticeshipsCache = undefined
        return true
      } catch {
        return false
      }
    })
  }

  async listApprenticeships({ bypassCache = false } = {}) {
    if (!bypassCache && this.apprenticeshipsCache !== undefined) return this.apprenticeshipsCache
    try {
      const entries = await readdir(this.apprenticeshipsDir, { withFileTypes: true })
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'))
      const reads = await Promise.all(files.map(async (e) => {
        const filePath = join(this.apprenticeshipsDir, e.name)
        return { res: await this.readJsonCached(filePath, bypassCache) }
      }))
      const items = reads
        .map(r => r.res?.readable ? r.res.value : undefined)
        .filter(x => x && typeof x === 'object' && x.trainId)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      if (!bypassCache) this.apprenticeshipsCache = items
      return items
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Read activation bindings across global, workspace, and session scopes. */
  async readActivations() {
    if (this.activationsCache !== undefined) return this.activationsCache
    const res = await readJsonSafe(this.activationsPath)
    const raw = typeof res.value === 'object' && res.value !== null ? res.value : {}
    const normalizeList = (list) => (Array.isArray(list) ? list : [])
      .filter(x => x && typeof x.capsuleId === 'string' && x.capsuleId.trim().length > 0)
      .map(x => ({
        capsuleId: x.capsuleId.trim(),
        activatedAt: typeof x.activatedAt === 'number' ? x.activatedAt : Date.now(),
        preset: x.preset === 'assist' ? 'assist' : 'direct',
        inheritSubagents: x.inheritSubagents !== false,
        ...(typeof x.cwd === 'string' && x.cwd ? { cwd: x.cwd } : {}),
      }))
    const normalizeMap = (obj) => {
      const out = {}
      if (!obj || typeof obj !== 'object') return out
      for (const [k, v] of Object.entries(obj)) {
        const cleaned = normalizeList(v)
        if (cleaned.length > 0) out[k] = cleaned
      }
      return out
    }
    const normalized = {
      version: 1,
      global: normalizeList(raw.global),
      workspaces: normalizeMap(raw.workspaces),
      sessions: normalizeMap(raw.sessions),
    }
    this.activationsCache = normalized
    return normalized
  }

  /** Atomically mutate capsule activation bindings across scopes. */
  async updateActivations(mutator) {
    return this.enqueue(async () => {
      const current = await this.readActivations()
      const clone = structuredClone(current)
      const mutated = (await mutator(clone, { pathKey })) || clone
      // Prune empty workspace/session keys
      for (const mapName of ['workspaces', 'sessions']) {
        const m = mutated[mapName] || {}
        for (const [k, list] of Object.entries(m)) {
          if (!Array.isArray(list) || list.length === 0) delete m[k]
        }
        mutated[mapName] = m
      }
      mutated.version = 1
      await mkdir(this.rootDir, { recursive: true })
      await writeFileAtomic(this.activationsPath, `${JSON.stringify(mutated, null, 2)}\n`)
      this.activationsCache = mutated
      return mutated
    })
  }

  /* ───────────────────────────── audit log ───────────────────────────── */

  /** Append one bounded audit entry (`distill`, `optimize`, `seal`, `verify-fail`, `compact-survive`). */
  async recordAudit(event) {
    return this.enqueue(async () => {
      const res = await readJsonSafe(this.auditPath)
      const list = Array.isArray(res.value) ? res.value : []
      list.unshift({
        id: randomUUID().slice(0, 12),
        at: Date.now(),
        ...event,
      })
      const bounded = list.slice(0, 120)
      await writeFileAtomic(this.auditPath, `${JSON.stringify(bounded, null, 2)}\n`)
      return bounded[0]
    })
  }

  /** Read recent audit events. */
  async readAudit(limit = 40) {
    const res = await readJsonSafe(this.auditPath)
    const list = Array.isArray(res.value) ? res.value : []
    return list.slice(0, clampInt(limit, 1, 120, 40))
  }
}
