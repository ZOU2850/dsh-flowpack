import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../index.js'

function createMockHostHarness(sessionFixture) {
  const registeredTools = new Map()
  const registeredSections = new Map()
  const registeredContexts = new Map()
  const registeredCommands = new Map()
  const registeredSkills = new Map()
  const registeredRoutes = new Map()
  const listeners = new Map()
  const effects = []

  const services = {
    tools: {
      register(def) {
        if (!def.output || typeof def.output !== 'object' || typeof def.output.render !== 'function' || !def.output.schema) {
          throw new TypeError(`tool "${def.name}" must declare output { schema, render, presentationMeta? }`)
        }
        registeredTools.set(def.name, def)
        return () => registeredTools.delete(def.name)
      },
    },
    systemPrompt: {
      section(def) {
        registeredSections.set(def.name, def)
        return () => registeredSections.delete(def.name)
      },
      context(def) {
        registeredContexts.set(def.name, def)
        return () => registeredContexts.delete(def.name)
      },
    },
    sessionQuery: {
      async listSessions() {
        return [{ header: sessionFixture.header, live: false }]
      },
      async observeSession(id) {
        if (id !== sessionFixture.header.id) throw new Error(`Unknown session: ${id}`)
        return {
          header: sessionFixture.header,
          events: sessionFixture.events,
          [Symbol.dispose]() {},
        }
      },
      async readTitleSnapshots() {
        return []
      },
    },
    commands: {
      register(def) {
        registeredCommands.set(def.name, def)
        return () => registeredCommands.delete(def.name)
      },
    },
    skills: {
      register(def) {
        registeredSkills.set(def.name, def)
        return () => registeredSkills.delete(def.name)
      },
    },
    connection: {
      fetch: {
        register(route) {
          registeredRoutes.set(route.path, route)
          return () => registeredRoutes.delete(route.path)
        },
      },
    },
    workingDirectory: {
      async ensure(agent) {
        return agent?.session?.header?.cwd || sessionFixture.header.cwd
      },
    },
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    get(name) { return services[name] },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose)
      return dispose || (() => {})
    },
    inject(deps, cb) {
      if (deps.every(d => services[d] !== undefined)) {
        const d = cb(ctx)
        if (typeof d === 'function') effects.push(d)
        return d
      }
      return () => {}
    },
    on(eventName, cb) {
      const list = listeners.get(eventName) || []
      list.push(cb)
      listeners.set(eventName, list)
      return () => {}
    },
    emit(eventName, payload) {
      for (const cb of listeners.get(eventName) || []) cb(payload)
    },
    disposeAll() {
      for (const d of effects.splice(0).reverse()) d()
    },
  }

  return {
    ctx,
    registeredTools,
    registeredSections,
    registeredContexts,
    registeredCommands,
    registeredSkills,
    registeredRoutes,
  }
}

test('full DSH host lifecycle: tools, commands, routes, runtime skills, and compaction survival', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-host-'))
  const sessionFixture = {
    header: { id: 'sess-live-1', cwd: 'D:\\projects\\demo-repo', createdAt: 1700000000000, title: 'Optimize CI Pipeline' },
    events: [
      { seq: 1, time: 1700000001000, type: 'user/message', data: { content: [{ type: 'text', text: '严格禁止跳过单元测试，保留现有配置文件格式。' }] } },
      { seq: 2, time: 1700000002000, type: 'tool/call', data: { turn: 1, step: 1, callId: 't1', name: 'read_file', arguments: '{"path":"D:\\\\projects\\\\demo-repo\\\\package.json"}' } },
      { seq: 3, time: 1700000002200, type: 'tool/result', data: { message: { toolCallId: 't1', isError: false, content: [{ type: 'text', text: '{}' }] } } },
      { seq: 4, time: 1700000003000, type: 'tool/call', data: { turn: 1, step: 2, callId: 't2', name: 'read_file', arguments: '{"path":"D:\\\\projects\\\\demo-repo\\\\package.json"}' } },
      { seq: 5, time: 1700000003200, type: 'tool/result', data: { message: { toolCallId: 't2', isError: false, content: [{ type: 'text', text: '{}' }] } } },
      { seq: 6, time: 1700000004000, type: 'tool/call', data: { turn: 2, step: 1, callId: 't3', name: 'run_command', arguments: '{"CommandLine":"node --test"}' } },
      { seq: 7, time: 1700000004200, type: 'tool/result', data: { message: { toolCallId: 't3', isError: false, content: [{ type: 'text', text: 'pass 5' }] } } },
    ],
  }

  const harness = createMockHostHarness(sessionFixture)
  const runtime = plugin.apply(harness.ctx, { storageDir: dir })

  try {
    await new Promise(r => setTimeout(r, 40))

    assert.ok(harness.registeredTools.has('flowpack_workflow'))
    assert.ok(harness.registeredTools.has('flowpack_memory'))
    assert.ok(harness.registeredTools.has('flowpack_capsule'))
    assert.ok(harness.registeredTools.has('flowpack_train'))
    assert.ok(harness.registeredCommands.has('flow-distill'))
    assert.ok(harness.registeredCommands.has('flow-pack'))
    assert.ok(harness.registeredCommands.has('flow-verify'))
    assert.ok(harness.registeredRoutes.has('/api/flowpack.health'))
    assert.ok(harness.registeredContexts.has('flowpack:strict-memory'))

    const execCtx = {
      agent: { session: { id: sessionFixture.header.id, ...sessionFixture } },
      signal: new AbortController().signal,
    }

    // 1. Distill + promote skill via flowpack_workflow tool
    const wfTool = harness.registeredTools.get('flowpack_workflow')
    const distillRes = await wfTool.execute({ action: 'distill', promote: true }, execCtx)
    assert.match(distillRes.text, /Distilled & optimized workflow/)
    assert.ok(harness.registeredSkills.size === 1, 'promoted workflow must register into ctx.skills')

    // 2. Pack strict memory via slash command /flow-pack
    const packCmd = harness.registeredCommands.get('flow-pack')
    const cmdRes = await packCmd.handler({ agent: execCtx.agent, rawInput: 'CI Pipeline Memory', signal: execCtx.signal })
    assert.equal(cmdRes.kind, 'success')
    assert.match(cmdRes.text, /SHA-256: [a-f0-9]{64}/)

    // 3. Simulate compaction event and confirm strict memory context survives synchronously
    harness.ctx.emit('agent/created', { agent: execCtx.agent, source: 'compact' })
    await new Promise(r => setTimeout(r, 60))

    const ctxProvider = harness.registeredContexts.get('flowpack:strict-memory')
    const injectedPrompt = ctxProvider.text({ agent: execCtx.agent })
    assert.match(injectedPrompt, /严格禁止跳过单元测试/)
    assert.match(injectedPrompt, /SEALED:/)

    // Scope isolation guard at prompt assembly level
    const otherWorkspacePrompt = ctxProvider.text({
      agent: { session: { id: 'sess-other', header: { id: 'sess-other', cwd: 'D:\\projects\\unrelated' } } },
    })
    assert.equal(otherWorkspacePrompt.includes('严格禁止跳过单元测试'), false, 'workspace memory must NOT leak to unrelated workspace')

    // 4. Exercise HTTP route parity
    const healthRoute = harness.registeredRoutes.get('/api/flowpack.health')
    const resp = await healthRoute.fetch(new Request('http://127.0.0.1/api/flowpack.health', { method: 'GET' }))
    const healthJson = await resp.json()
    assert.equal(healthJson.ok, true)
    assert.equal(healthJson.counts.workflows, 1)
    assert.equal(healthJson.counts.sealedPacks >= 1, true)
  } finally {
    harness.ctx.disposeAll()
    await runtime.store.readAudit().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})
