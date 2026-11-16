import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapsuleService, exportCapsuleBundle, resolveActiveCapsules, verifyCapsule } from '../lib/capsule.js'
import { MemoryPackService } from '../lib/memory-pack.js'
import { FlowPackStore } from '../lib/store.js'
import { WorkflowService } from '../lib/workflow.js'

function createMultiSessionFixture() {
  const cwd = 'D:\\projects\\report-automation'
  const sessions = {
    'run-1-explore': {
      header: { id: 'run-1-explore', cwd, createdAt: 1700000001000, title: 'Generate Weekly Excel Summary' },
      events: [
        { seq: 1, time: 1700000001000, type: 'user/message', data: { content: [{ type: 'text', text: '生成本周财务汇总 Excel 报表并检查格式，不许改动模板公式' }] } },
        // Initial exploratory failure + recovery
        { seq: 2, time: 1700000001100, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'excel_read', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx` }) } },
        { seq: 3, time: 1700000001200, type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'File locked by Excel COM handle' }] } } },
        { seq: 4, time: 1700000001300, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'office_status', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx` }) } },
        { seq: 5, time: 1700000001400, type: 'tool/result', data: { message: { toolCallId: 'c2', isError: false, content: [{ type: 'text', text: 'ready read-only snapshot' }] } } },
        { seq: 6, time: 1700000001500, type: 'tool/call', data: { turn: 1, step: 3, callId: 'c3', name: 'excel_read', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx`, readOnly: true }) } },
        { seq: 7, time: 1700000001600, type: 'tool/result', data: { message: { toolCallId: 'c3', isError: false, content: [{ type: 'text', text: 'rows=42' }] } } },
        { seq: 8, time: 1700000001700, type: 'tool/call', data: { turn: 2, step: 1, callId: 'c4', name: 'excel_create', arguments: JSON.stringify({ path: `${cwd}\\summary.xlsx` }) } },
        { seq: 9, time: 1700000001800, type: 'tool/result', data: { message: { toolCallId: 'c4', isError: false, content: [{ type: 'text', text: 'created' }] } } },
        { seq: 10, time: 1700000001900, type: 'deliverables/presented', data: { files: [{ path: `${cwd}\\summary.xlsx` }] } },
      ],
    },
    'run-2-repeat': {
      header: { id: 'run-2-repeat', cwd, createdAt: 1700000100000, title: 'Generate Weekly Excel Summary' },
      events: [
        { seq: 1, time: 1700000100000, type: 'user/message', data: { content: [{ type: 'text', text: '生成本周财务汇总 Excel 报表并检查格式，不许改动模板公式' }] } },
        { seq: 2, time: 1700000101000, type: 'tool/call', data: { turn: 1, step: 1, callId: 'r1', name: 'office_status', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx` }) } },
        { seq: 3, time: 1700000101100, type: 'tool/result', data: { message: { toolCallId: 'r1', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
        { seq: 4, time: 1700000101200, type: 'tool/call', data: { turn: 1, step: 2, callId: 'r2', name: 'excel_read', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx`, readOnly: true }) } },
        { seq: 5, time: 1700000101300, type: 'tool/result', data: { message: { toolCallId: 'r2', isError: false, content: [{ type: 'text', text: 'rows=42' }] } } },
        { seq: 6, time: 1700000101400, type: 'tool/call', data: { turn: 2, step: 1, callId: 'r3', name: 'excel_create', arguments: JSON.stringify({ path: `${cwd}\\summary.xlsx` }) } },
        { seq: 7, time: 1700000101500, type: 'tool/result', data: { message: { toolCallId: 'r3', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
        { seq: 8, time: 1700000101600, type: 'tool/call', data: { turn: 2, step: 2, callId: 'r4', name: 'run_command', arguments: JSON.stringify({ CommandLine: 'node verify-excel.mjs' }) } },
        { seq: 9, time: 1700000101700, type: 'tool/result', data: { message: { toolCallId: 'r4', isError: false, content: [{ type: 'text', text: 'All 6 formulas valid' }] } } },
      ],
    },
    'run-3-crystallize': {
      header: { id: 'run-3-crystallize', cwd, createdAt: 1700000200000, title: 'Generate Weekly Excel Summary' },
      events: [
        { seq: 1, time: 1700000200000, type: 'user/message', data: { content: [{ type: 'text', text: '生成本周财务汇总 Excel 报表并检查格式，不许改动模板公式' }] } },
        { seq: 2, time: 1700000201000, type: 'tool/call', data: { turn: 1, step: 1, callId: 't1', name: 'office_status', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx` }) } },
        { seq: 3, time: 1700000201100, type: 'tool/result', data: { message: { toolCallId: 't1', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
        { seq: 4, time: 1700000201200, type: 'tool/call', data: { turn: 1, step: 2, callId: 't2', name: 'excel_read', arguments: JSON.stringify({ path: `${cwd}\\raw.xlsx`, readOnly: true }) } },
        { seq: 5, time: 1700000201300, type: 'tool/result', data: { message: { toolCallId: 't2', isError: false, content: [{ type: 'text', text: 'rows=42' }] } } },
        { seq: 6, time: 1700000201400, type: 'tool/call', data: { turn: 2, step: 1, callId: 't3', name: 'excel_create', arguments: JSON.stringify({ path: `${cwd}\\summary.xlsx` }) } },
        { seq: 7, time: 1700000201500, type: 'tool/result', data: { message: { toolCallId: 't3', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
        { seq: 8, time: 1700000201600, type: 'tool/call', data: { turn: 2, step: 2, callId: 't4', name: 'run_command', arguments: JSON.stringify({ CommandLine: 'node verify-excel.mjs' }) } },
        { seq: 9, time: 1700000201700, type: 'tool/result', data: { message: { toolCallId: 't4', isError: false, content: [{ type: 'text', text: 'passed' }] } } },
      ],
    },
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    get(name) {
      if (name === 'sessionQuery') {
        return {
          async listSessions() {
            return Object.values(sessions).map(s => ({ header: s.header, live: false }))
          },
          async observeSession(id) {
            if (!sessions[id]) throw new Error(`Missing session: ${id}`)
            return { header: sessions[id].header, events: sessions[id].events, [Symbol.dispose]() {} }
          },
        }
      }
      return undefined
    },
  }
  return { ctx, cwd }
}

test('progressive learning consolidates 3 runs into a crystallized Selectable Experience Capsule with non-forgetting genealogy & subagent inheritance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-capsule-'))
  try {
    const store = new FlowPackStore(dir)
    await store.ensureDirs()
    const { ctx, cwd } = createMultiSessionFixture()
    const workflowService = new WorkflowService(ctx, store)
    const memoryService = new MemoryPackService(ctx, store, workflowService)
    const capsuleService = new CapsuleService(
      ctx, store, workflowService, memoryService,
      async () => ({ tools: [{ name: 'excel_read' }, { name: 'excel_create' }, { name: 'office_status' }] }),
    )

    // Run 1: Initial exploratory trial (learns File locked -> office_status + readOnly recovery!)
    const r1 = await capsuleService.learnFromSession({ sessionId: 'run-1-explore', crystallizeThreshold: 3 })
    assert.equal(r1.capsule.attempts, 1)
    assert.equal(r1.capsule.maturity, 'emerging') // succeeded via deliverable after error recovery
    assert.ok(r1.capsule.selfHealing.rules.some(r => r.symptomPattern.includes('locked')), 'must extract self-healing rule from recovered error')
    assert.equal(r1.capsule.workflow.genealogy.length, 1)

    // Run 2: Same task family recognized automatically across a brand-new sessionId!
    const r2 = await capsuleService.learnFromSession({ sessionId: 'run-2-repeat', crystallizeThreshold: 3 })
    assert.equal(r2.capsule.capsuleId, r1.capsule.capsuleId, 'similar session must consolidate into the SAME Experience Capsule family')
    assert.equal(r2.capsule.attempts, 2)
    assert.equal(r2.capsule.workflow.genealogy.length, 2, 'must keep Gen 1 AND Gen 2')

    // Run 3: Reaches crystallizeThreshold=3 -> auto-crystallizes & auto-activates as Experience Capsule button!
    const r3 = await capsuleService.learnFromSession({ sessionId: 'run-3-crystallize', crystallizeThreshold: 3 })
    assert.equal(r3.capsule.capsuleId, r1.capsule.capsuleId)
    assert.equal(r3.capsule.maturity, 'crystallized')
    assert.equal(r3.capsule.icon, '⚡')
    assert.equal(r3.capsule.workflow.genealogy.length, 3)
    assert.equal(verifyCapsule(r3.capsule).ok, true)

    // Record an extra problem fix after crystallization -> Gen 4 created WITHOUT forgetting Gen 1..3
    const fixed = await capsuleService.learnProblemFix({
      capsuleId: r3.capsule.capsuleId,
      tool: 'excel_create',
      symptom: 'Sheet name exceeds 31 chars',
      resolution: '生成前先截断工作表名至 <=31 字符并过滤非法符号 : \\ / ? * [ ]',
    })
    assert.equal(fixed.capsule.workflow.genealogy.length, 4)
    assert.equal(fixed.capsule.workflow.genealogy[0].gen, 1, 'Gen 1 exploration must NEVER be overwritten')

    // Forward-restore Gen 1 while still keeping Gen 1..4 intact -> becomes Gen 5
    const restored = await capsuleService.restoreGeneration({ capsuleId: r3.capsule.capsuleId, gen: 1 })
    assert.equal(restored.capsule.workflow.genealogy.length, 5)

    // Test Cross-Conversation & Spawned Subagent inheritance!
    await capsuleService.activateCapsule({
      capsuleId: r3.capsule.capsuleId,
      scope: 'session',
      sessionId: 'parent-chat-99',
      inheritSubagents: true,
    })

    const activations = await store.readActivations()
    const { capsules } = await store.listCapsules()

    // Spawned subagent of parent-chat-99 MUST inherit automatically
    const subagentResolved = resolveActiveCapsules({
      activations,
      capsules,
      sessionId: 'child-subagent-1',
      parentSessionId: 'parent-chat-99',
      isSubagent: true,
      cwd,
      subagentInheritance: true,
    })
    assert.ok(subagentResolved.resolved.some(x => x.capsule.capsuleId === r3.capsule.capsuleId))
    assert.ok(subagentResolved.resolved.some(x => x.activationScope === 'subagent-inherited' || x.activationScope === 'workspace'))

    // Unrelated workspace does NOT receive workspace-scoped activation from report-automation
    const otherWsResolved = resolveActiveCapsules({
      activations,
      capsules,
      sessionId: 'random-other-chat',
      cwd: 'D:\\projects\\completely-different',
    })
    assert.equal(otherWsResolved.resolved.length, 0)

    // Cross-platform exports + strict import rejection on tampering
    const skillExport = exportCapsuleBundle(restored.capsule, 'skill')
    const agentsExport = exportCapsuleBundle(restored.capsule, 'agents_md')
    const ptcExport = exportCapsuleBundle(restored.capsule, 'ptc')
    const jsonExport = exportCapsuleBundle(restored.capsule, 'dshcapsule')

    assert.match(skillExport, /Self-Healing Rules/)
    assert.match(skillExport, /Genealogy/)
    assert.match(agentsExport, /Experience Capsule:/)
    assert.match(ptcExport, /await phase\(/)
    assert.match(ptcExport, /agent\(\{/)

    const tampered = JSON.parse(jsonExport)
    tampered.title = 'Malicious Hijacked Capsule'
    await assert.rejects(
      () => capsuleService.importCapsuleBundle(tampered),
      /SHA-256 mismatch/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filters system noise notifications, compresses noisy GUI clicks into macroStages + learnedSummary, and re-seals on rename', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-noise-'))
  try {
    const store = new FlowPackStore(dir)
    await store.ensureDirs()
    const cwd = 'D:\\projects\\wechat-sync'

    const events = [
      { seq: 1, time: 1700000300000, type: 'user/message', data: { content: [{ type: 'text', text: 'The approval policy changed from "ask" to "never" (changed by the user).' }] } },
      { seq: 2, time: 1700000300100, type: 'user/message', data: { content: [{ type: 'text', text: '再审核一下链接是否都和表格内容一致' }] } },
      { seq: 3, time: 1700000300200, type: 'tool/call', data: { turn: 1, step: 1, callId: 'g1', name: 'request_access', arguments: JSON.stringify({ target: cwd }) } },
      { seq: 4, time: 1700000300250, type: 'tool/result', data: { message: { toolCallId: 'g1', isError: false, content: [{ type: 'text', text: 'granted' }] } } },
      { seq: 5, time: 1700000300300, type: 'tool/call', data: { turn: 1, step: 2, callId: 'g2', name: 'open_application', arguments: JSON.stringify({ app: 'WeChat' }) } },
      { seq: 6, time: 1700000300350, type: 'tool/result', data: { message: { toolCallId: 'g2', isError: false, content: [{ type: 'text', text: 'opened' }] } } },
    ]
    let seq = 7
    for (let i = 1; i <= 12; i += 1) {
      const cid = `clk_${i}`
      events.push(
        { seq: seq++, time: 1700000301000 + i * 20, type: 'tool/call', data: { turn: 1, step: 2 + i, callId: cid, name: 'computer', arguments: JSON.stringify({ action: 'left_click', x: 100 + i, y: 200 }) } },
        { seq: seq++, time: 1700000301010 + i * 20, type: 'tool/result', data: { message: { toolCallId: cid, isError: false, content: [{ type: 'text', text: 'clicked' }] } } },
      )
    }
    events.push(
      { seq: seq++, time: 1700000302000, type: 'tool/call', data: { turn: 2, step: 1, callId: 'ex1', name: 'excel_create', arguments: JSON.stringify({ path: `${cwd}\\链接审核报告.xlsx` }) } },
      { seq: seq++, time: 1700000302050, type: 'tool/result', data: { message: { toolCallId: 'ex1', isError: false, content: [{ type: 'text', text: 'saved' }] } } },
      { seq: seq++, time: 1700000302100, type: 'deliverables/presented', data: { files: [{ path: `${cwd}\\链接审核报告.xlsx` }] } },
    )

    const ctx = {
      logger: { warn() {}, info() {} },
      get(name) {
        if (name === 'sessionQuery') {
          return {
            async listSessions() {
              return [{ header: { id: 'noisy-gui-chat', cwd, createdAt: 1700000300000 }, live: false }]
            },
            async readTitleSnapshots(ids) {
              return Object.fromEntries(ids.map(id => [id, { title: '抓取信德海事公众号文章信息汇总' }]))
            },
            async observeSession() {
              return { header: { id: 'noisy-gui-chat', cwd, createdAt: 1700000300000 }, events, [Symbol.dispose]() {} }
            },
          }
        }
        return undefined
      },
    }

    const workflowService = new WorkflowService(ctx, store)
    const memoryService = new MemoryPackService(ctx, store, workflowService)
    const capsuleService = new CapsuleService(ctx, store, workflowService, memoryService)

    const res = await capsuleService.learnFromSession({
      sessionId: 'noisy-gui-chat',
      crystallize: true,
      activate: true,
    })

    assert.equal(res.capsule.title, '抓取信德海事公众号文章信息汇总')
    assert.ok(!/approval policy/i.test(res.capsule.title))
    assert.ok(!/approval policy/i.test(res.capsule.description))
    assert.ok(res.capsule.learnedSummary)
    assert.ok(res.capsule.learnedSummary.macroSteps.length >= 2 && res.capsule.learnedSummary.macroSteps.length <= 6)
    assert.ok(res.capsule.learnedSummary.recapLines.length >= 2)
    assert.equal(verifyCapsule(res.capsule).ok, true)

    const renamed = await capsuleService.renameCapsule({
      capsuleId: res.capsule.capsuleId,
      title: '信德海事文章抓取与链接核对',
    })
    assert.equal(renamed.title, '信德海事文章抓取与链接核对')
    assert.equal(verifyCapsule(renamed).ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
