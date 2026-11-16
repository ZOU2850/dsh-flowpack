import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../index.js'
import { discoverPluginCapabilities } from '../lib/self-heal.js'

function createSelfHealHarness() {
  const registeredTools = new Map()
  const registeredCommands = new Map()
  const registeredContexts = new Map()
  const registeredRoutes = new Map()
  const listeners = new Map()
  const effects = []
  const cwd = 'D:\\projects\\self-heal-demo'

  const sessionFixture = {
    header: { id: 'main-sess-01', cwd, createdAt: 1700000500000, title: 'Fix Word Export Style' },
    events: [
      { seq: 1, time: 1700000501000, type: 'user/message', data: { content: [{ type: 'text', text: '修复导出 Word 样式错乱并验证结果' }] } },
      { seq: 2, time: 1700000502000, type: 'tool/call', data: { turn: 1, step: 1, callId: 'w1', name: 'office_edit', arguments: JSON.stringify({ path: `${cwd}\\out.docx` }) } },
      { seq: 3, time: 1700000502100, type: 'tool/result', data: { message: { toolCallId: 'w1', isError: true, content: [{ type: 'text', text: 'COM RPC_E_SERVERCALL_RETRYLATER busy' }] } } },
      { seq: 4, time: 1700000502200, type: 'tool/call', data: { turn: 1, step: 2, callId: 'w2', name: 'office_save', arguments: JSON.stringify({ path: `${cwd}\\out.docx` }) } },
      { seq: 5, time: 1700000502300, type: 'tool/result', data: { message: { toolCallId: 'w2', isError: false, content: [{ type: 'text', text: 'saved cleanly' }] } } },
    ],
  }

  // Mock tools from installed plugins in DSH desktop profile
  const externalPluginTools = [
    { name: 'office_open', description: 'Open Word/PPT' },
    { name: 'office_edit', description: 'Edit office XML' },
    { name: 'office_save', description: 'Save office document' },
    { name: 'excel_create', description: 'Create workbook' },
    { name: 'computer', description: 'Desktop GUI control' },
    { name: 'codebuddy_ask', description: 'Ask WorkBuddy' },
    { name: 'file_launcher', description: 'Launch file preview' },
  ]

  const services = {
    tools: {
      register(def) {
        registeredTools.set(def.name, def)
        return () => registeredTools.delete(def.name)
      },
      definitions() {
        return [...externalPluginTools, ...registeredTools.values()]
      },
    },
    systemPrompt: {
      section() { return () => {} },
      context(def) { registeredContexts.set(def.name, def); return () => registeredContexts.delete(def.name) },
    },
    sessionQuery: {
      async listSessions() { return [{ header: sessionFixture.header, live: false }] },
      async observeSession(id) {
        return { header: sessionFixture.header, events: sessionFixture.events, [Symbol.dispose]() {} }
      },
    },
    commands: {
      register(def) { registeredCommands.set(def.name, def); return () => registeredCommands.delete(def.name) },
    },
    connection: {
      fetch: {
        register(route) { registeredRoutes.set(route.path, route); return () => registeredRoutes.delete(route.path) },
      },
    },
    workingDirectory: {
      async ensure(agent) { return agent?.session?.header?.cwd || cwd },
    },
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    get(n) { return services[n] },
    effect(fn) { const d = fn(); if (typeof d === 'function') effects.push(d); return d || (() => {}) },
    inject(deps, cb) { if (deps.every(d => services[d])) { const d = cb(ctx); if (typeof d === 'function') effects.push(d); return d } return () => {} },
    on(event, cb) {
      const arr = listeners.get(event) || []
      arr.push(cb)
      listeners.set(event, arr)
      return () => {}
    },
    async waterfall(event, ...args) {
      const list = listeners.get(event) || []
      let idx = 0
      const run = () => {
        if (idx >= list.length) {
          if (event === 'tools/post-execute') return { decision: 'accept', additionalContexts: [] }
          return { kind: 'enter', messages: args[0]?.messages || [] }
        }
        const fn = list[idx++]
        return fn(...args, run)
      }
      return run()
    },
    disposeAll() { for (const d of effects.splice(0).reverse()) d() },
  }

  return { ctx, cwd, registeredTools, registeredCommands, registeredContexts, registeredRoutes }
}

test('runtime tools/post-execute self-healing injects learned solutions onto subagents, discovers cross-plugin tools, and absorbs new live fixes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-heal-'))
  const h = createSelfHealHarness()
  const runtime = plugin.apply(h.ctx, { storageDir: dir })

  try {
    await new Promise(r => setTimeout(r, 40))

    // 1. Discover cross-plugin tools dynamically
    const caps = discoverPluginCapabilities(h.ctx)
    assert.equal(caps.available, true)
    assert.ok(caps.groups.some(g => g.id === 'office'))
    assert.ok(caps.groups.some(g => g.id === 'excel'))
    assert.ok(caps.groups.some(g => g.id === 'gui'))
    assert.ok(caps.groups.some(g => g.id === 'workbuddy'))
    assert.ok(caps.groups.some(g => g.id === 'fileLauncher'))

    // 2. Crystallize & globally activate a capsule button using `/flow-capsule` slash command
    const capCmd = h.registeredCommands.get('flow-capsule')
    assert.ok(capCmd, '/flow-capsule command must be registered')
    const mainAgent = { session: { id: 'main-sess-01', header: { id: 'main-sess-01', cwd: h.cwd } } }
    const cmdOut = await capCmd.handler({ agent: mainAgent, rawInput: 'crystallize Word样式胶囊', signal: new AbortController().signal })
    assert.equal(cmdOut.kind, 'success')
    assert.match(cmdOut.text, /⚡/)

    // Make capsule globally active so ANY conversation and ANY spawned subagent receives it!
    const capTool = h.registeredTools.get('flowpack_capsule')
    assert.ok(capTool)
    const { capsules } = await runtime.store.listCapsules()
    const capId = capsules[0].capsuleId
    await capTool.execute({ action: 'activate', capsuleId: capId, scope: 'global' }, { agent: mainAgent })
    await runtime.refreshCache()

    // 3. Verify spawned subagent receives active capsule in systemPrompt automatically!
    const subagent = {
      session: {
        id: 'subagent-worker-7',
        header: { id: 'subagent-worker-7', cwd: h.cwd, parentSession: 'main-sess-01', origin: 'subagent' },
      },
    }
    const ctxProvider = h.registeredContexts.get('flowpack:strict-memory')
    const subPrompt = ctxProvider.text({ agent: subagent })
    assert.match(subPrompt, /当前为子 Agent 会话/)
    assert.match(subPrompt, /Word样式胶囊/)
    assert.match(subPrompt, /recall_generation/)

    // 4. Simulate runtime tool error inside subagent hitting known COM RPC error -> tools/post-execute injects self-healing nudge!
    const postExecRes = await h.ctx.waterfall(
      'tools/post-execute',
      { name: 'office_edit', arguments: { path: `${h.cwd}\\out.docx` }, agent: subagent, callId: 'call-1' },
      { isError: true, error: { message: 'COM RPC_E_SERVERCALL_RETRYLATER busy' }, content: [{ type: 'text', text: 'COM RPC_E_SERVERCALL_RETRYLATER busy' }] },
    )
    assert.ok(Array.isArray(postExecRes.additionalContexts) && postExecRes.additionalContexts.length === 1)
    assert.equal(postExecRes.additionalContexts[0].role, 'user')
    assert.equal(postExecRes.additionalContexts[0].source.kind, 'flowpack-self-heal')
    assert.match(postExecRes.additionalContexts[0].content[0].text, /已从过往经验胶囊匹配到历史解法/)
    assert.match(postExecRes.additionalContexts[0].content[0].text, /office_save/)

    // 5. Simulate subagent trying another tool `codebuddy_ask` twice with failure, then succeeding -> auto-absorbs new live fix!
    await h.ctx.waterfall(
      'tools/post-execute',
      { name: 'codebuddy_ask', arguments: { prompt: 'check' }, agent: subagent, callId: 'call-2' },
      { isError: true, error: { message: 'WorkBuddy socket timeout on first ping' }, content: [{ type: 'text', text: 'WorkBuddy socket timeout on first ping' }] },
    )
    const repeatRes = await h.ctx.waterfall(
      'tools/post-execute',
      { name: 'codebuddy_ask', arguments: { prompt: 'check' }, agent: subagent, callId: 'call-3' },
      { isError: true, error: { message: 'WorkBuddy socket timeout on first ping' }, content: [{ type: 'text', text: 'WorkBuddy socket timeout on first ping' }] },
    )
    assert.equal(repeatRes.additionalContexts.length, 1, 'consecutive unknown errors >= 2 must also trigger generic self-correction nudge')

    // Now succeed cleanly -> triggers auto-learn of resolution onto active capsule!
    await h.ctx.waterfall(
      'tools/post-execute',
      { name: 'codebuddy_ask', arguments: { prompt: 'check', timeoutMs: 10000 }, agent: subagent, callId: 'call-4' },
      { isError: false, value: { ok: true }, content: [{ type: 'text', text: 'ok' }] },
    )
    await new Promise(r => setTimeout(r, 80))

    const updatedCap = await runtime.store.readCapsule(capId)
    assert.ok(updatedCap.selfHealing.rules.some(r => r.tool === 'codebuddy_ask'), 'successful recovery after error must enrich active capsule self-healing rules')
    assert.ok(updatedCap.workflow.genealogy.length >= 2, 'auto-learned fix must preserve prior workflow generation in genealogy')

    // 6. Check HTTP endpoints (`/api/flowpack.capabilities` + `/api/flowpack.activate`)
    const capRoute = h.registeredRoutes.get('/api/flowpack.capabilities')
    const capResp = await (await capRoute.fetch(new Request('http://127.0.0.1/api/flowpack.capabilities'))).json()
    assert.equal(capResp.ok, true)
    assert.ok(capResp.capabilities.totalTools >= 7)
    assert.ok(capResp.healEvents.length >= 2)
  } finally {
    h.ctx.disposeAll()
    rmSync(dir, { recursive: true, force: true })
  }
})
