import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin from '../index.js'
import { FlowPackStore } from '../lib/store.js'
import { WorkflowService } from '../lib/workflow.js'
import { MemoryPackService, verifyPack } from '../lib/memory-pack.js'
import { CapsuleService } from '../lib/capsule.js'
import { ApprenticeService } from '../lib/apprentice.js'
import { ensureWatchHelperExe } from '../lib/watch-driver.js'

function createFakeWatchDriver() {
  let actionHandler = null
  const calls = []
  return {
    calls,
    isSupported: () => true,
    onAction(fn) {
      actionHandler = fn
      return () => { actionHandler = null }
    },
    emitAction(evt) {
      return actionHandler?.(evt)
    },
    async start(opts) {
      calls.push({ op: 'start', opts })
      return { ok: true, pid: 43210, framesDir: opts.framesDir }
    },
    async captureNow() {
      calls.push({ op: 'captureNow' })
      return { ok: true, actionType: 'manual_capture' }
    },
    async stop() {
      calls.push({ op: 'stop' })
      return { ok: true }
    },
    dispose() {
      calls.push({ op: 'dispose' })
    },
  }
}

function createServiceHarness(dir, sessionFixture) {
  const registeredSkills = new Map()
  let llmAttachmentSaved = 0
  const llmRequests = []

  const services = {
    skills: {
      register(def) {
        registeredSkills.set(def.name, def)
        return () => registeredSkills.delete(def.name)
      },
    },
    sessionQuery: {
      async listSessions() {
        return sessionFixture ? [{ header: sessionFixture.header, live: false }] : []
      },
      async observeSession(id) {
        if (!sessionFixture || id !== sessionFixture.header.id) throw new Error(`Unknown session: ${id}`)
        return {
          header: sessionFixture.header,
          events: sessionFixture.events,
          [Symbol.dispose]() {},
        }
      },
      async readTitleSnapshots() { return [] },
    },
    attachments: {
      async saveImage(img) {
        llmAttachmentSaved += 1
        return { attachmentId: `att-${llmAttachmentSaved}`, filename: img?.name || 'frame.jpg' }
      },
    },
    llm: {
      async resolveModelInfo() {
        return { input: { image: true } }
      },
      async *stream(req) {
        llmRequests.push(req)
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            understanding: '人类正在 Excel 中人工逐行筛选 2026 年销售额大于 0 的记录并另存为报表',
            betterIdea: '改用 Python 脚本批量读取源表、按年份过滤并生成带格式的 xlsx 文件，速度更快且可自动校验总和',
            question: '最终生成的汇总表需要按地区分多个 Sheet，还是合并在同一个 Sheet？',
          }),
        }
      },
    },
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    get(name) { return services[name] },
  }

  const store = new FlowPackStore(dir)
  const workflowService = new WorkflowService(ctx, store)
  const memoryService = new MemoryPackService(ctx, store)
  const capsuleService = new CapsuleService(ctx, store, workflowService, memoryService)
  const watchDriver = createFakeWatchDriver()
  const apprenticeService = new ApprenticeService(ctx, store, {
    workflowService,
    memoryService,
    capsuleService,
    watchDriver,
    getLastModelRoute: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  })

  return {
    ctx,
    store,
    workflowService,
    memoryService,
    capsuleService,
    watchDriver,
    apprenticeService,
    registeredSkills,
    getLlmAttachmentSaved: () => llmAttachmentSaved,
    llmRequests,
  }
}

test('WatchHelper.cs compiles cleanly on Windows into a real .exe watcher', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 watcher binary only applies on Windows')
    return
  }
  const exePath = await ensureWatchHelperExe()
  assert.ok(exePath && existsSync(exePath), `expected compiled exe at ${exePath}`)
})

test('ApprenticeService full flow: screen watch, real-time AI questions, LLM review, multi-round better method & human acceptance graduation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-apprentice-'))
  const trainSessionFixture = {
    header: { id: 'sess-train-1', cwd: 'D:\\projects\\sales-report', createdAt: 1700000000000, title: '销售报表自动化练习' },
    events: [
      { seq: 1, time: 1700000001000, type: 'user/message', data: { content: [{ type: 'text', text: '按示范规则训练销售报表整理任务，可用更优方案' }] } },
      { seq: 2, time: 1700000002000, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"python build_sales.py --year 2026"}' } },
      { seq: 3, time: 1700000002500, type: 'tool/result', data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'Wrote sales_2026.xlsx (128 rows)' }] } } },
      { seq: 4, time: 1700000003000, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'write_file', arguments: '{"path":"D:\\\\projects\\\\sales-report\\\\sales_2026.xlsx"}' } },
      { seq: 5, time: 1700000003200, type: 'tool/result', data: { message: { toolCallId: 'c2', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
    ],
  }

  const h = createServiceHarness(dir, trainSessionFixture)
  try {
    // 1. Start watching human operations
    const started = await h.apprenticeService.startWatch({
      title: '销售明细清洗与导出',
      goal: '输出 2026 年有效订单汇总 xlsx 并核对总金额',
      cwd: 'D:\\projects\\sales-report',
      sessionId: 'sess-train-1',
      autoQuestion: true,
    })
    assert.equal(started.driverStarted, true)
    assert.equal(started.training.status, 'watching')
    const trainId = started.training.trainId

    // Create a valid sample JPEG buffer inside frames dir for frame inspection & multimodal LLM review
    const framesDir = h.store.apprenticeshipFramesDir(trainId)
    mkdirSync(framesDir, { recursive: true })
    writeFileSync(join(framesDir, 'step-001.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    // 2. Simulate incoming desktop actions (including excluded/password privacy guards + ambiguous click)
    const ignoredDsh = await h.apprenticeService.ingestDemoStep(trainId, {
      actionType: 'left_click',
      exe: 'DeepSeek Harness.exe',
      windowTitle: 'DeepSeek Harness',
      controlName: 'Send',
    })
    assert.equal(ignoredDsh.ignored, true)

    const pwdStep = await h.apprenticeService.ingestDemoStep(trainId, {
      actionType: 'typing_pause',
      exe: 'EXCEL.EXE',
      windowTitle: '登录弹窗',
      controlType: 'Edit',
      controlName: '密码',
      isPassword: true,
      valueSnippet: 'SuperSecret123!',
    })
    assert.equal(pwdStep.step.isPassword, true)
    assert.equal(pwdStep.step.valueSnippet.includes('SuperSecret123!'), false, 'password fields must never be recorded into training steps')
    assert.match(pwdStep.step.valueSnippet, /已脱敏/)

    const step1 = await h.apprenticeService.ingestDemoStep(trainId, {
      actionType: 'left_click',
      exe: 'EXCEL.EXE',
      windowTitle: '销售总表.xlsx - Excel',
      controlType: 'Button',
      controlName: '筛选',
      screenshotFile: 'step-001.jpg',
    })
    assert.ok(!step1.ignored)
    assert.equal(step1.step.screenshotFile, 'step-001.jpg')

    // Ambiguous unnamed Pane click triggers heuristic ambiguity question
    const step2 = await h.apprenticeService.ingestDemoStep(trainId, {
      actionType: 'left_click',
      exe: 'EXCEL.EXE',
      windowTitle: '导出设置',
      controlType: 'Pane',
      controlName: '',
      screenshotFile: 'step-001.jpg',
    })
    assert.ok(!step2.ignored)
    assert.ok(step2.raisedQuestion, 'unnamed click on dialog should raise real-time ambiguity question')

    // 3. Multimodal AI review attaches frame & poses question + better alternative
    const reviewed = await h.apprenticeService.reviewWithLlm(trainId, { force: true })
    assert.equal(reviewed.ok, true)
    assert.ok(h.getLlmAttachmentSaved() >= 1, 'must attach screenshot frame to LLM review')
    assert.match(reviewed.training.aiLiveSummary, /2026 年/)
    assert.match(reviewed.training.betterMethodProposal, /Python/)
    const pendingQuestions = reviewed.training.questions.filter(q => q.status === 'pending')
    assert.ok(pendingQuestions.length >= 2)

    // 4. Human answers AI's real-time questions & stops watching
    for (const q of pendingQuestions) {
      await h.apprenticeService.answerQuestion(
        trainId,
        q.qId,
        '所有地区放在同一个 Sheet，仅保留 2026 年金额大于 0 的行，表头必须加粗',
      )
    }
    const stopped = await h.apprenticeService.stopWatch(trainId)
    assert.equal(stopped.status, 'ready_for_training')

    // 5. Round 1 training prompt + session trace auto-classified as better_alternative
    const prep1 = await h.apprenticeService.prepareTrainingRound(trainId, {
      sessionId: 'sess-train-1',
      cwd: 'D:\\projects\\sales-report',
      feedbackNote: '注意最终数字需和人工筛选完全核对一致',
      mode: 'practice',
    })
    assert.equal(prep1.roundNo, 1)
    assert.match(prep1.prompt, /更优方法/)
    assert.match(prep1.prompt, /所有地区放在同一个 Sheet/)

    const round1 = await h.apprenticeService.recordRoundFromSession(trainId, {
      sessionId: 'sess-train-1',
      baselineEventCount: 0,
    })
    assert.equal(round1.round.roundNo, 1)
    assert.equal(round1.round.approach, 'better_alternative')

    // Human inspects Round 1 & requests improvement
    const ann1 = await h.apprenticeService.annotateRound(trainId, 1, {
      verdict: 'needs_fix',
      note: '数字正确，但表头没有加粗且日期要按降序排列',
    })
    assert.equal(ann1.round.verdict, 'needs_fix')
    assert.ok(ann1.training.coachingRules.some(r => /表头没有加粗/.test(r)))

    // 6. Round 2 AI fixes issue -> human accepts & graduates into Capsule + Sealed Memory Pack
    const round2 = await h.apprenticeService.recordRound(trainId, {
      sessionId: 'sess-train-1',
      approach: 'better_alternative',
      approachReason: '使用 openpyxl 写入并设置表头加粗及日期降序，同时核对汇总金额',
      summary: '第2轮完成：生成带加粗表头和降序排列的 sales_2026.xlsx',
      toolsUsed: ['bash', 'write_file'],
      deliverables: ['sales_2026.xlsx'],
    })
    assert.equal(round2.round.roundNo, 2)

    await h.apprenticeService.annotateRound(trainId, 2, {
      verdict: 'accepted',
      note: '格式与金额完全一致，查收正确！',
    })

    const graduated = await h.apprenticeService.graduateTraining(trainId, {
      scope: 'workspace',
      inheritSubagents: true,
    })

    assert.equal(graduated.training.status, 'graduated')
    assert.ok(graduated.capsule.capsuleId)
    assert.equal(graduated.capsule.maturity, 'crystallized')
    assert.ok(graduated.pack.packId)
    assert.ok(graduated.capsule.workflow.genealogy.length >= 2, 'Gen 1 human demo + Gen 2 AI accepted method preserved')
    assert.equal(graduated.capsule.workflow.genealogy[0].gen, 1)
    assert.ok(
      graduated.capsule.selfHealing.rules.some(r => /表头没有加粗|2026 年/.test(`${r.symptomPattern} ${r.fixSteps}`)),
      'clarifications & coaching notes must become self-healing rules',
    )

    const packCheck = verifyPack(graduated.pack)
    assert.equal(packCheck.ok, true, 'graduated MemoryPack must pass SHA-256 verification')
    assert.equal(packCheck.tampered, false)
    assert.ok(graduated.memorySummary.totalEntries >= 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Full DSH host integration: /api/flowpack.train routes, frame serving, flowpack_train tool & idle auto-capture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-train-host-'))
  const registeredTools = new Map()
  const registeredRoutes = new Map()
  const listeners = new Map()
  const effects = []

  const sessionFixture = {
    header: { id: 'sess-auto-99', cwd: 'D:\\projects\\demo-train', createdAt: 1700000000000, title: '自动采集练习' },
    events: [
      { seq: 1, time: 1700000001000, type: 'user/message', data: { content: [{ type: 'text', text: '运行第1轮示教训练' }] } },
      { seq: 2, time: 1700000002000, type: 'tool/call', data: { turn: 1, step: 1, callId: 'k1', name: 'bash', arguments: '{"command":"node export.mjs"}' } },
      { seq: 3, time: 1700000002200, type: 'tool/result', data: { message: { toolCallId: 'k1', isError: false, content: [{ type: 'text', text: 'exported 50 items' }] } } },
    ],
  }

  const services = {
    tools: {
      register(def) { registeredTools.set(def.name, def); return () => registeredTools.delete(def.name) },
    },
    systemPrompt: {
      section() { return () => {} },
      context() { return () => {} },
    },
    sessionQuery: {
      async listSessions() { return [{ header: sessionFixture.header, live: false }] },
      async observeSession(id) {
        if (id !== sessionFixture.header.id) throw new Error(`Unknown session: ${id}`)
        return { header: sessionFixture.header, events: sessionFixture.events, [Symbol.dispose]() {} }
      },
      async readTitleSnapshots() { return [] },
    },
    commands: { register() { return () => {} } },
    skills: { register() { return () => {} } },
    connection: {
      fetch: {
        register(route) { registeredRoutes.set(route.path, route); return () => registeredRoutes.delete(route.path) },
      },
    },
    workingDirectory: { async ensure() { return sessionFixture.header.cwd } },
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    get(n) { return services[n] },
    effect(fn) { const d = fn(); if (typeof d === 'function') effects.push(d); return d || (() => {}) },
    inject(deps, cb) { if (deps.every(x => services[x] !== undefined)) { const d = cb(ctx); if (typeof d === 'function') effects.push(d); return d } return () => {} },
    on(evt, cb) { const arr = listeners.get(evt) || []; arr.push(cb); listeners.set(evt, arr); return () => {} },
    emit(evt, payload) { for (const cb of listeners.get(evt) || []) cb(payload) },
  }

  const runtime = plugin.apply(ctx, { storageDir: dir })
  try {
    await new Promise(r => setTimeout(r, 30))
    const trainRoute = registeredRoutes.get('/api/flowpack.train')
    const trainTool = registeredTools.get('flowpack_train')
    assert.ok(trainRoute, '/api/flowpack.train route must be registered')
    assert.ok(trainTool, 'flowpack_train tool must be registered')

    const callTrainPost = async (body) => {
      const res = await trainRoute.fetch(new Request('http://127.0.0.1/api/flowpack.train', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
      return res.json()
    }

    // Create + immediately stop watch to keep host test platform-agnostic and fast
    const startRes = await callTrainPost({ action: 'start_watch', title: '网页抓取与校验', sessionId: 'sess-auto-99', cwd: sessionFixture.header.cwd })
    const trainId = startRes.training.trainId
    await callTrainPost({ action: 'stop_watch', trainId })

    // Add manual step & verify frame endpoint security + JPEG serving
    await callTrainPost({ action: 'add_step', trainId, summary: '打开控制台导出 JSON', app: 'Chrome' })
    const framesDir = runtime.store.apprenticeshipFramesDir(trainId)
    mkdirSync(framesDir, { recursive: true })
    writeFileSync(join(framesDir, 'step-001.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))

    const goodFrame = await trainRoute.fetch(new Request(`http://127.0.0.1/api/flowpack.train?frame=1&trainId=${trainId}&file=step-001.jpg`))
    assert.equal(goodFrame.status, 200)
    assert.equal(goodFrame.headers.get('content-type'), 'image/jpeg')

    const badFrame = await trainRoute.fetch(new Request(`http://127.0.0.1/api/flowpack.train?frame=1&trainId=${trainId}&file=../secret.txt`))
    assert.equal(badFrame.status, 400)

    // Tool interactions
    const execCtx = { agent: { session: { id: 'sess-auto-99', header: sessionFixture.header } } }
    const inspectOut = await trainTool.execute({ action: 'inspect_demo', trainId }, execCtx)
    assert.match(inspectOut.text, /打开控制台导出 JSON/)

    const askOut = await trainTool.execute({ action: 'ask_question', trainId, question: '是否忽略空行？', reason: '示例数据中有空白行' }, execCtx)
    assert.match(askOut.text, /已向人类提出实时问题/)

    const betterOut = await trainTool.execute({ action: 'propose_better_method', trainId, proposal: '直接用 Node 脚本请求接口并写 CSV', reason: '免点页面，稳定十倍' }, execCtx)
    assert.match(betterOut.text, /已记录你的更优方法建议/)

    // Prepare round & simulate AI running new actions after prepare_round baseline, then idle auto-capture
    await callTrainPost({ action: 'prepare_round', trainId, sessionId: 'sess-auto-99', cwd: sessionFixture.header.cwd })
    sessionFixture.events.push(
      { seq: 4, time: 1700000004000, type: 'tool/call', data: { turn: 2, step: 1, callId: 'k2', name: 'bash', arguments: '{"command":"node fetch_api.mjs --csv"}' } },
      { seq: 5, time: 1700000004200, type: 'tool/result', data: { message: { toolCallId: 'k2', isError: false, content: [{ type: 'text', text: 'wrote output.csv' }] } } },
    )
    ctx.emit('agent/status', { status: 'idle', agent: execCtx.agent })
    await new Promise(r => setTimeout(r, 80))

    const detailResp = await trainRoute.fetch(new Request(`http://127.0.0.1/api/flowpack.train?trainId=${trainId}`))
    const detailJson = await detailResp.json()
    assert.ok(detailJson.training.rounds.length >= 1, 'idle hook must auto-record round from linked session')

    // Accept & graduate via route
    const gradRes = await callTrainPost({ action: 'graduate', trainId })
    assert.equal(gradRes.training.status, 'graduated')
    assert.ok(gradRes.capsule.capsuleId)
    assert.ok(gradRes.pack.packId)

    // Delete training via route
    const delRes = await callTrainPost({ action: 'delete', trainId })
    assert.equal(delRes.deleted, true)
  } finally {
    for (const d of effects.splice(0).reverse()) d()
    await runtime.store.readAudit().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})
