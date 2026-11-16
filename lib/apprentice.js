/**
 * Watch-and-Train Apprenticeship Engine (`dsh-flowpack`).
 *
 * Lifecycle:
 *   1. Watch (`watching`): human demonstrates naturally across Windows apps while AI/driver
 *      captures meaningful actions (window switch, clicks, UIA control names, hotkeys, typing)
 *      and compressed JPEG screenshots, raising real-time clarifying questions along the way.
 *   2. Practice & Coach (`ready_for_training` / `training`): AI executes 1..N training rounds
 *      (encouraged to use faster/better alternative tools/scripts when available!), while the
 *      human reviews each round, annotates corrections, and triggers follow-up drills.
 *   3. Graduate (`graduated`): once human approves the final result, atomically mints BOTH:
 *      - A crystallized Experience Capsule (Gen 1 human demo baseline preserved + Gen 2 optimal
 *        execution + self-healing rules from every human clarification & round annotation), and
 *      - A SHA-256 sealed Memory Pack with provenance linking back to the training session.
 */

import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { buildCapsuleFromArtifacts, CAPSULE_SCHEMA_VERSION, sealCapsule } from './capsule.js'
import { buildMemorySummary, emptySections, sealPack, MEMORY_SCHEMA_VERSION } from './memory-pack.js'
import { readSessionSnapshot, normalizeSessionTrace } from './session-trace.js'
import { buildMacroStages, distillWorkflowFromTrace, applyOptimizationPass, renderSkillMarkdown, renderWorkflowScript } from './workflow.js'
import { clampInt, normalizeWorkspaceRoot, redactSecrets, sha256Hex, slugifyId, truncateText } from './util.js'

export const APPRENTICE_SCHEMA_VERSION = 'dsh-apprentice/v1'

const APP_FRIENDLY_NAMES = {
  'excel.exe': 'Excel',
  'et.exe': 'WPS 表格',
  'winword.exe': 'Word',
  'wps.exe': 'WPS 文字',
  'powerpnt.exe': 'PowerPoint',
  'wpp.exe': 'WPS 演示',
  'chrome.exe': 'Chrome 浏览器',
  'msedge.exe': 'Edge 浏览器',
  'firefox.exe': 'Firefox',
  'explorer.exe': '文件资源管理器',
  'notepad.exe': '记事本',
  'code.exe': 'VS Code',
  'windowsterminal.exe': '终端',
  'powershell.exe': 'PowerShell',
  'pwsh.exe': 'PowerShell',
  'weixin.exe': '微信',
  'wechat.exe': '微信',
  'qq.exe': 'QQ',
  'dingtalk.exe': '钉钉',
  'feishu.exe': '飞书',
  'lark.exe': '飞书',
}

export function friendlyAppName(exe = '') {
  const clean = String(exe || '').trim().toLowerCase()
  if (!clean) return '桌面窗口'
  return APP_FRIENDLY_NAMES[clean] || clean.replace(/\.exe$/i, '')
}

/** Generate a clear plain-language description of one captured human action. */
export function formatHumanStepSummary(step = {}) {
  const app = friendlyAppName(step.exe)
  const titlePart = step.windowTitle ? `「${truncateText(step.windowTitle, 32)}」` : ''
  const target = step.controlName
    ? `「${truncateText(step.controlName, 36)}」`
    : (step.controlType ? `${step.controlType} (${step.relX ?? step.x ?? 0}, ${step.relY ?? step.y ?? 0})` : `坐标 (${step.relX ?? step.x ?? 0}, ${step.relY ?? step.y ?? 0})`)

  switch (step.actionType) {
    case 'watch_started':
      return `开始观察「${app}」${titlePart}`
    case 'switch_window':
      return `切换到「${app}」${titlePart}`
    case 'double_click':
      return `在「${app}」双击 ${target}`
    case 'right_click':
      return `在「${app}」右键点击 ${target}`
    case 'left_click':
      return `在「${app}」点击 ${target}`
    case 'hotkey':
      return `在「${app}」按下快捷键 ${step.keySummary || '组合键'}${step.controlName ? `（${truncateText(step.controlName, 24)}）` : ''}`
    case 'key':
      return `在「${app}」按下 ${step.keySummary || '按键'}`
    case 'type':
      return `在「${app}」${step.controlName ? `「${truncateText(step.controlName, 24)}」` : ''}输入：${truncateText(step.valueSnippet || step.keySummary || '文本', 60)}`
    case 'manual_capture':
      return `手动抓取「${app}」${titlePart}`
    default:
      return step.semanticSummary || `在「${app}」执行 ${step.actionType || '操作'}`
  }
}

/** Detect natural clarifying questions while watching a human operate the computer. */
export function detectAmbiguityQuestion(prevStep, currStep, existingQuestions = []) {
  if (!currStep || currStep.actionType === 'watch_started') return null
  const askedTopics = new Set(existingQuestions.map(q => q.topicKey).filter(Boolean))
  const app = friendlyAppName(currStep.exe)

  // 1. Cross-application context switch
  if (
    prevStep
    && prevStep.exe
    && currStep.exe
    && prevStep.exe.toLowerCase() !== currStep.exe.toLowerCase()
    && currStep.actionType === 'switch_window'
  ) {
    const topicKey = `handoff:${prevStep.exe.toLowerCase()}->${currStep.exe.toLowerCase()}`
    if (!askedTopics.has(topicKey)) {
      return {
        topicKey,
        stepSeq: currStep.seq,
        askedBy: 'heuristic',
        reason: '发现跨软件切换上下文',
        question: `看你从「${friendlyAppName(prevStep.exe)}」切到了「${app}」，这里需要把哪部分数据/文件带过来，或有固定筛选条件吗？`,
      }
    }
  }

  // 2. Save / overwrite / export / delete confirmation
  const actionSignal = `${currStep.controlName || ''} ${currStep.keySummary || ''}`
  if (/(Ctrl\+S|保存|另存为|导出|覆盖|删除|提交|发送|Export|Save|Delete)/i.test(actionSignal)) {
    const topicKey = 'boundary:save_or_export'
    if (!askedTopics.has(topicKey)) {
      return {
        topicKey,
        stepSeq: currStep.seq,
        askedBy: 'heuristic',
        reason: '涉及文件保存/导出/修改边界',
        question: `第 ${currStep.seq} 步涉及「${truncateText(currStep.controlName || currStep.keySummary, 24)}」：以后我自动执行时，是直接覆盖原文件，还是另存为带日期的新文件？`,
      }
    }
  }

  // 3. Unnamed coordinate click without accessibility label
  if (
    (currStep.actionType === 'left_click' || currStep.actionType === 'double_click')
    && (!currStep.controlName || currStep.controlName === currStep.controlType)
    && (currStep.seq >= 2)
  ) {
    const topicKey = `unnamed:${currStep.exe}:${Math.round((currStep.relX ?? currStep.x ?? 0) / 80)}x${Math.round((currStep.relY ?? currStep.y ?? 0) / 80)}`
    if (!askedTopics.has(topicKey) && existingQuestions.filter(q => String(q.topicKey || '').startsWith('unnamed:')).length < 2) {
      return {
        topicKey,
        stepSeq: currStep.seq,
        askedBy: 'heuristic',
        reason: '控件缺少可读名称（依赖坐标定位）',
        question: `第 ${currStep.seq} 步你在「${app}」点了一个没有文字标签的区域，这里具体想触发什么操作？（方便我换窗口大小也能找准）`,
      }
    }
  }

  // 4. Repetitive manual clicks -> ask whether AI may optimize with faster tools/scripts
  if ((currStep.seq >= 6) && !askedTopics.has('method:allow_faster')) {
    return {
      topicKey: 'method:allow_faster',
      stepSeq: currStep.seq,
      askedBy: 'heuristic',
      reason: '步骤较多，评估是否允许 AI 找更快办法',
      question: `看你在「${app}」连续执行了 ${currStep.seq} 步操作，如果我训练时发现可以用脚本/快捷键/插件工具一步搞定（最终效果一样），可以优先用更快的办法吗？`,
    }
  }

  return null
}

/** Auto-generate a clean human title from observed apps & steps. */
export function inferTrainingTitle(steps = [], fallbackGoal = '') {
  if (fallbackGoal && fallbackGoal.trim().length > 0) {
    return truncateText(fallbackGoal.trim(), 56)
  }
  const apps = []
  const seen = new Set()
  for (const s of steps) {
    const a = friendlyAppName(s.exe)
    if (a && a !== '桌面窗口' && !seen.has(a)) {
      seen.add(a)
      apps.push(a)
    }
  }
  const targets = steps
    .map(s => s.controlName)
    .filter(n => n && n.length >= 2 && n.length <= 20 && !/^\[/.test(n))
    .slice(0, 2)
  if (apps.length > 0) {
    const appPart = apps.slice(0, 2).join(' → ')
    return targets.length > 0 ? `${appPart} · ${targets.join('/')}` : `${appPart} 操作示教`
  }
  return '新桌面示教训练'
}

/** Summarize an apprenticeship item cleanly for the list view (no heavy frame lists). */
export function compactApprenticeshipSummary(item) {
  if (!item || typeof item !== 'object') return item
  const questions = Array.isArray(item.questions) ? item.questions : []
  const rounds = Array.isArray(item.rounds) ? item.rounds : []
  const steps = Array.isArray(item.demoSteps) ? item.demoSteps : []
  const pendingQuestions = questions.filter(q => q.status === 'pending').length
  const betterMethodCount = rounds.filter(r => r.approach === 'better_alternative').length
  const apps = [...new Set(steps.map(s => friendlyAppName(s.exe)).filter(a => a && a !== '桌面窗口'))].slice(0, 3)

  return {
    trainId: item.trainId,
    title: item.title,
    goal: item.goal,
    status: item.status,
    cwd: item.cwd,
    autoQuestion: item.autoQuestion !== false,
    stepCount: steps.length,
    pendingQuestions,
    questionCount: questions.length,
    roundCount: rounds.length,
    betterMethodCount,
    apps,
    aiLiveSummary: item.aiLiveSummary || '',
    betterMethodProposal: item.betterMethodProposal || '',
    resultCapsuleId: item.resultCapsuleId || '',
    resultPackId: item.resultPackId || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

/** Coordinate human demo recording, live Q&A, multi-round coaching, and graduation. */
export class ApprenticeService {
  constructor(ctx, store, { workflowService, memoryService, capsuleService, watchDriver, getLastModelRoute } = {}) {
    this.ctx = ctx
    this.store = store
    this.workflowService = workflowService
    this.memoryService = memoryService
    this.capsuleService = capsuleService
    this.watchDriver = watchDriver
    this.getLastModelRoute = getLastModelRoute
    this.activeWatchTrainId = ''
    this.linkedSessions = new Map() // sessionId -> { trainId, roundNo, baselineEventCount, recorded }
    this.lastLlmReviewAt = new Map() // trainId -> ts
    this.disposeListener = undefined

    if (this.watchDriver && typeof this.watchDriver.onAction === 'function') {
      this.disposeListener = this.watchDriver.onAction((evt) => {
        void this.handleDriverEvent(evt).catch(() => {})
      })
    }
  }

  dispose() {
    try { this.disposeListener?.() } catch { /* ignore */ }
    this.disposeListener = undefined
    if (this.activeWatchTrainId && this.watchDriver?.stop) {
      void this.watchDriver.stop().catch(() => {})
    }
    this.activeWatchTrainId = ''
  }

  getLinkedSessionInfo(sessionId) {
    if (!sessionId) return undefined
    return this.linkedSessions.get(sessionId)
  }

  clearLinkedSession(sessionId) {
    if (sessionId) this.linkedSessions.delete(sessionId)
  }

  /** Start a new human screen-watching demonstration session (or resume watching an existing one). */
  async startWatch({ trainId, title = '', goal = '', cwd = '', sessionId = '', autoQuestion = true } = {}) {
    await this.store.ensureDirs()

    if (this.activeWatchTrainId && this.activeWatchTrainId !== trainId) {
      await this.stopWatch(this.activeWatchTrainId).catch(() => {})
    }

    let training = trainId ? await this.store.readApprenticeship(trainId) : undefined
    const now = Date.now()
    if (!training) {
      const id = `train-${randomUUID().slice(0, 8)}`
      training = {
        schemaVersion: APPRENTICE_SCHEMA_VERSION,
        trainId: id,
        title: truncateText(title.trim() || goal.trim() || '正在观察你的屏幕操作…', 60),
        goal: truncateText(goal.trim(), 240),
        cwd: normalizeWorkspaceRoot(cwd),
        sourceSessionId: sessionId || '',
        status: 'watching',
        autoQuestion: autoQuestion !== false,
        aiLiveSummary: '',
        betterMethodProposal: '',
        demoSteps: [],
        questions: [],
        rounds: [],
        coachingRules: [],
        resultCapsuleId: '',
        resultPackId: '',
        createdAt: now,
        updatedAt: now,
      }
    } else {
      training.status = 'watching'
      if (title.trim()) training.title = truncateText(title.trim(), 60)
      if (goal.trim()) training.goal = truncateText(goal.trim(), 240)
      training.updatedAt = now
    }

    await this.store.saveApprenticeship(training)

    let driverStarted = false
    let driverWarning = ''
    if (this.watchDriver && typeof this.watchDriver.start === 'function') {
      try {
        const framesDir = this.store.apprenticeshipFramesDir(training.trainId)
        await this.watchDriver.start({
          trainId: training.trainId,
          outDir: framesDir,
          intervalMs: 130,
          maxLongEdge: 1280,
          quality: 65,
        })
        this.activeWatchTrainId = training.trainId
        driverStarted = true
      } catch (error) {
        driverWarning = error instanceof Error ? error.message : String(error)
        this.ctx?.logger?.warn?.(`[dsh-flowpack] WatchDriver start fallback: ${driverWarning}`)
      }
    } else {
      this.activeWatchTrainId = training.trainId
    }

    return { training, driverStarted, driverWarning }
  }

  /** Capture a manual snapshot step right now during watch mode. */
  async captureNow(trainId) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    if (!this.watchDriver || typeof this.watchDriver.captureNow !== 'function') {
      throw new Error('Screen watch driver is unavailable in this environment.')
    }
    const raw = await this.watchDriver.captureNow('manual_capture')
    if (!raw) return { training, step: null }
    return this.ingestDemoStep(trainId, raw)
  }

  /** Stop watching human screen actions and summarize the demonstration for AI training. */
  async stopWatch(trainId) {
    const id = trainId || this.activeWatchTrainId
    if (!id) return null
    if (this.activeWatchTrainId === id) {
      this.activeWatchTrainId = ''
      await this.watchDriver?.stop?.().catch(() => {})
    }
    const training = await this.store.readApprenticeship(id)
    if (!training) return null

    if (training.status === 'watching') {
      training.status = 'ready_for_training'
    }
    if (!training.title || training.title === '正在观察你的屏幕操作…' || training.title === '新桌面示教训练') {
      training.title = inferTrainingTitle(training.demoSteps, training.goal)
    }
    training.updatedAt = Date.now()
    await this.store.saveApprenticeship(training)
    return training
  }

  async handleDriverEvent(evt) {
    const trainId = evt?.trainId || this.activeWatchTrainId
    if (!trainId) return null
    return this.ingestDemoStep(trainId, evt)
  }

  /** Ingest one captured human action + optional screenshot, synthesize meaning, and trigger smart Q&A. */
  async ingestDemoStep(trainId, rawEvent = {}) {
    const rawExe = String(rawEvent.exe || '').trim().toLowerCase()
    const rawWin = String(rawEvent.windowTitle || '').trim().toLowerCase()
    if (/^(deepseek harness|1password|bitwarden|keepass|keepassxc|lastpass|dashlane|enpass|nordpass|proton pass|consent|lockapp|fp-watch|cu-helper)(\.exe)?$/i.test(rawExe)
      || rawWin === 'deepseek harness') {
      return { ignored: true, reason: 'excluded_app' }
    }
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)

    const steps = Array.isArray(training.demoSteps) ? training.demoSteps : []
    const lastStep = steps[steps.length - 1]
    const nextSeq = steps.length + 1
    const cleanVal = rawEvent.isPassword
      ? '[密码输入已脱敏]'
      : redactSecrets(String(rawEvent.valueSnippet || ''), 'mask').text
    const cleanKey = rawEvent.isPassword
      ? '[密码已脱敏]'
      : String(rawEvent.keySummary || '')

    const framesDir = this.store.apprenticeshipFramesDir(training.trainId)
    const shotFile = rawEvent.screenshotFile ? basename(String(rawEvent.screenshotFile)) : ''
    const screenshotPath = shotFile ? join(framesDir, shotFile) : (rawEvent.screenshotPath || '')

    const step = {
      stepId: `dstep-${nextSeq}-${randomUUID().slice(0, 6)}`,
      seq: nextSeq,
      timestamp: typeof rawEvent.timestamp === 'number' ? rawEvent.timestamp : Date.now(),
      actionType: String(rawEvent.actionType || 'action'),
      exe: String(rawEvent.exe || ''),
      windowTitle: truncateText(String(rawEvent.windowTitle || ''), 120),
      x: Number.isFinite(rawEvent.x) ? rawEvent.x : 0,
      y: Number.isFinite(rawEvent.y) ? rawEvent.y : 0,
      relX: Number.isFinite(rawEvent.relX) ? rawEvent.relX : (Number.isFinite(rawEvent.x) ? rawEvent.x : 0),
      relY: Number.isFinite(rawEvent.relY) ? rawEvent.relY : (Number.isFinite(rawEvent.y) ? rawEvent.y : 0),
      screenWidth: Number.isFinite(rawEvent.screenWidth) ? rawEvent.screenWidth : 0,
      screenHeight: Number.isFinite(rawEvent.screenHeight) ? rawEvent.screenHeight : 0,
      controlType: truncateText(String(rawEvent.controlType || ''), 48),
      controlName: rawEvent.isPassword ? '[密码框]' : truncateText(String(rawEvent.controlName || ''), 90),
      valueSnippet: truncateText(cleanVal, 120),
      keySummary: truncateText(cleanKey, 60),
      isPassword: Boolean(rawEvent.isPassword),
      screenshotFile: shotFile,
      screenshotPath,
      humanNote: rawEvent.humanNote ? truncateText(String(rawEvent.humanNote), 240) : '',
      semanticSummary: '',
    }
    step.semanticSummary = rawEvent.semanticSummary
      ? truncateText(String(rawEvent.semanticSummary), 160)
      : formatHumanStepSummary(step)

    // Collapse redundant duplicate watch_started/switch_window bursts on identical window within 1.5s
    if (
      lastStep
      && lastStep.actionType === 'switch_window'
      && step.actionType === 'switch_window'
      && lastStep.exe === step.exe
      && lastStep.windowTitle === step.windowTitle
      && (step.timestamp - lastStep.timestamp) < 1500
    ) {
      return { training, step: lastStep }
    }

    steps.push(step)
    training.demoSteps = steps.slice(-160)
    if (!training.title || training.title === '正在观察你的屏幕操作…') {
      const candidateTitle = inferTrainingTitle(training.demoSteps, training.goal)
      if (candidateTitle && candidateTitle !== '新桌面示教训练') {
        training.title = candidateTitle
      }
    }

    // Real-time ambiguity Q&A check
    let raisedQuestion = null
    if (training.autoQuestion !== false) {
      const qSpec = detectAmbiguityQuestion(lastStep, step, training.questions)
      if (qSpec) {
        raisedQuestion = {
          qId: `q-${randomUUID().slice(0, 8)}`,
          stepSeq: qSpec.stepSeq,
          topicKey: qSpec.topicKey,
          askedBy: qSpec.askedBy,
          reason: qSpec.reason,
          question: qSpec.question,
          answer: '',
          status: 'pending',
          createdAt: Date.now(),
        }
        training.questions = [...(training.questions || []), raisedQuestion]
      }
    }

    training.updatedAt = Date.now()
    await this.store.saveApprenticeship(training)

    // Non-blocking background multimodal LLM review every 4 steps (if active route supports it)
    if (training.autoQuestion !== false && training.demoSteps.length % 4 === 0) {
      void this.reviewWithLlm(training.trainId, { force: false }).catch(() => {})
    }

    return { training, step, raisedQuestion }
  }

  /** Add a manual step note or synthetic demo step (useful when demonstrating non-click actions or offline). */
  async addManualStep(trainId, { summary, app = '', target = '', note = '' } = {}) {
    if (!summary || !String(summary).trim()) throw new Error('Step summary is required.')
    return this.ingestDemoStep(trainId, {
      actionType: 'manual_note',
      exe: app,
      controlName: target,
      semanticSummary: String(summary).trim(),
      humanNote: note,
    })
  }

  async deleteDemoStep(trainId, stepSeq) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    training.demoSteps = (training.demoSteps || [])
      .filter(s => s.seq !== Number(stepSeq))
      .map((s, idx) => ({ ...s, seq: idx + 1 }))
    training.updatedAt = Date.now()
    return this.store.saveApprenticeship(training)
  }

  async annotateDemoStep(trainId, stepSeq, note) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    training.demoSteps = (training.demoSteps || []).map(s =>
      s.seq === Number(stepSeq) ? { ...s, humanNote: truncateText(String(note || ''), 280) } : s,
    )
    training.updatedAt = Date.now()
    return this.store.saveApprenticeship(training)
  }

  /** Raise an explicit question during watch/train mode (called by LLM observer or `flowpack_train` tool). */
  async askQuestion(trainId, { question, stepSeq = 0, reason = '', askedBy = 'agent' } = {}) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    const qText = truncateText(String(question || '').trim(), 280)
    if (!qText) throw new Error('Question text is required.')
    const existing = (training.questions || []).find(q => q.question === qText)
    if (existing) return { training, question: existing }

    const item = {
      qId: `q-${randomUUID().slice(0, 8)}`,
      stepSeq: Number(stepSeq) || 0,
      topicKey: `custom:${sha256Hex(qText).slice(0, 8)}`,
      askedBy,
      reason: truncateText(String(reason || 'AI 实时确认业务规则'), 120),
      question: qText,
      answer: '',
      status: 'pending',
      createdAt: Date.now(),
    }
    training.questions = [...(training.questions || []), item]
    training.updatedAt = Date.now()
    await this.store.saveApprenticeship(training)
    return { training, question: item }
  }

  /** Human answers (or skips) an AI clarifying question while watching or training. */
  async answerQuestion(trainId, qId, answer, { skip = false } = {}) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    let updatedQ = null
    training.questions = (training.questions || []).map((q) => {
      if (q.qId !== qId) return q
      updatedQ = {
        ...q,
        answer: skip ? '' : truncateText(redactSecrets(String(answer || '').trim(), 'mask').text, 360),
        status: skip ? 'skipped' : 'answered',
        answeredAt: Date.now(),
      }
      return updatedQ
    })
    if (!updatedQ) throw new Error(`Question "${qId}" not found.`)
    training.updatedAt = Date.now()
    await this.store.saveApprenticeship(training)
    return { training, question: updatedQ }
  }

  /** Call active DSH LLM (multimodal if image supported) to summarize understanding & ask smart live questions. */
  async reviewWithLlm(trainId, { force = true } = {}) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)

    const now = Date.now()
    if (!force && (now - (this.lastLlmReviewAt.get(trainId) || 0)) < 8000) {
      return { ok: false, skipped: true, reason: 'throttled', training }
    }

    const llm = this.ctx?.get?.('llm')
    const route = this.getLastModelRoute?.()
    if (!llm || typeof llm.stream !== 'function' || !route?.provider || !route?.model) {
      return { ok: false, reason: 'no_active_llm_route', training }
    }

    this.lastLlmReviewAt.set(trainId, now)
    const recentSteps = (training.demoSteps || []).slice(-6)
    const stepLines = recentSteps.map(s =>
      `${s.seq}. [${s.actionType}] ${s.semanticSummary}`
      + `${s.humanNote ? `（人类备注：${s.humanNote}）` : ''}`,
    ).join('\n')
    const answeredLines = (training.questions || [])
      .filter(q => q.status === 'answered')
      .map(q => `- 问：${q.question}\n  答：${q.answer}`)
      .join('\n')

    const contentParts = [{
      type: 'text',
      text:
        '你正在后台实时观察人类操作电脑并学习这个工作流。\n'
        + `任务名称：${training.title}\n`
        + `任务目标：${training.goal || '待总结'}\n\n`
        + `最近观察到的人类操作步骤：\n${stepLines || '（刚起步，尚无具体动作）'}\n\n`
        + (answeredLines ? `已澄清规则：\n${answeredLines}\n\n` : '')
        + '请严格输出一段 JSON（不要多余解释），格式如下：\n'
        + '{"understanding":"用1句通俗中文总结你现在看懂了什么","question":"如果有1个必须问人类的关键问题就写在这里，没有就留空字符串","betterIdea":"如果你发现有比手动点击更快更好的替代方案，写1句话建议，否则留空"}',
    }]

    // Attach latest 2 screenshots if `ctx.attachments` & vision model are supported
    const attachments = this.ctx?.get?.('attachments')
    if (attachments && typeof attachments.saveImage === 'function') {
      let supportsImage = true
      try {
        if (typeof llm.resolveModelInfo === 'function') {
          const info = await llm.resolveModelInfo(route.provider, route.model)
          supportsImage = info?.inputModalities === void 0 || info.inputModalities.includes('image')
        }
      } catch { /* assume supported */ }

      if (supportsImage) {
        const { readFile } = await import('node:fs/promises')
        const frameSteps = recentSteps.filter(s => s.screenshotPath).slice(-2)
        for (const fsStep of frameSteps) {
          try {
            const buf = await readFile(fsStep.screenshotPath)
            const ref = await attachments.saveImage({
              data: buf.toString('base64'),
              mediaType: 'image/jpeg',
              name: fsStep.screenshotFile || `step-${fsStep.seq}.jpg`,
            })
            contentParts.push({ type: 'image', image: ref })
          } catch { /* ignore unreadable frame */ }
        }
      }
    }

    let fullText = ''
    try {
      const stream = llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: contentParts }],
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          fullText += chunk.text
        } else if (typeof chunk?.delta === 'string') {
          fullText += chunk.delta
        } else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
          return { ok: false, reason: chunk.reason?.failure?.message || 'llm_error', training }
        }
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error), training }
    }

    const match = fullText.match(/\{[\s\S]*\}/)
    if (!match) {
      if (fullText.trim()) {
        training.aiLiveSummary = truncateText(fullText.trim(), 220)
        training.updatedAt = Date.now()
        await this.store.saveApprenticeship(training)
      }
      return { ok: true, parsed: false, training }
    }

    try {
      const parsed = JSON.parse(match[0])
      if (parsed.understanding) {
        training.aiLiveSummary = truncateText(String(parsed.understanding).trim(), 220)
      }
      if (parsed.betterIdea && String(parsed.betterIdea).trim()) {
        training.betterMethodProposal = truncateText(String(parsed.betterIdea).trim(), 280)
      }
      training.updatedAt = Date.now()
      await this.store.saveApprenticeship(training)
      if (parsed.question && String(parsed.question).trim()) {
        await this.askQuestion(trainId, {
          question: String(parsed.question).trim(),
          stepSeq: recentSteps[recentSteps.length - 1]?.seq || 0,
          reason: 'AI 实时看屏学习提出的问题',
          askedBy: 'llm',
        })
      }
      const updated = await this.store.readApprenticeship(trainId)
      return { ok: true, parsed: true, training: updated }
    } catch {
      return { ok: true, parsed: false, training }
    }
  }

  /** Freeze demo / build clean Training Mission Prompt for the AI agent & link current session. */
  async prepareTrainingRound(trainId, { sessionId = '', cwd = '', feedbackNote = '', mode = 'practice' } = {}) {
    if (this.activeWatchTrainId === trainId) {
      await this.stopWatch(trainId)
    }
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)

    if (!training.title || training.title === '正在观察你的屏幕操作…' || training.title === '新桌面示教训练') {
      training.title = inferTrainingTitle(training.demoSteps, training.goal)
    }
    if (cwd && !training.cwd) training.cwd = normalizeWorkspaceRoot(cwd)
    training.status = 'training'

    const nextRoundNo = (training.rounds?.length || 0) + 1
    const cleanSteps = (training.demoSteps || []).map(s =>
      `  ${s.seq}. ${s.semanticSummary}`
      + `${s.controlName ? ` [控件:${s.controlType || 'UI'} "${s.controlName}"]` : ''}`
      + `${s.humanNote ? `（人类提示：${s.humanNote}）` : ''}`
      + `${s.screenshotPath ? ` [截图: ${s.screenshotPath}]` : ''}`,
    )

    const qaLines = (training.questions || [])
      .filter(q => q.status === 'answered' && q.answer)
      .map(q => `  - 问：${q.question}\n    人类回答：${q.answer}`)

    const priorNotes = []
    for (const r of training.rounds || []) {
      if (r.humanNote) priorNotes.push(`  - 第 ${r.roundNo} 轮人类批注（${r.verdict === 'needs_fix' ? '需修正' : '巩固'}）：${r.humanNote}`)
    }
    if (feedbackNote && String(feedbackNote).trim()) {
      priorNotes.push(`  - 本轮重点批注要求：${String(feedbackNote).trim()}`)
    }

    const prompt = [
      `[FLOWPACK_TRAIN:${training.trainId}] 人类示教实战训练 · 第 ${nextRoundNo} 轮 (${mode === 'fix' ? '按人类批注纠偏重练' : '实操与优化探索'})`,
      `任务名称：${training.title}`,
      `验收目标：${training.goal || `完整复现并高质量完成「${training.title}」任务，最后呈交结果由人类查收验收。`}`,
      '',
      '一、人类示范操作过程（如需查看具体画面细节，可用文件读取/识图查看截图路径）：',
      ...(cleanSteps.length > 0 ? cleanSteps : ['  （人类未录制屏幕动作，请根据任务目标与下方说明探索执行）']),
      '',
      ...(qaLines.length > 0 ? ['二、人类已回答的规则与边界条件：', ...qaLines, ''] : []),
      ...(priorNotes.length > 0 ? ['三、人类批注与必须修正的问题（请务必严格落实）：', ...priorNotes, ''] : []),
      training.betterMethodProposal ? `四、备选优化思路提示：${training.betterMethodProposal}\n` : '',
      '执行要求：',
      '1. 如果你在学习示教过程时发现还有不确定细节，可随时调用 `flowpack_train(action: "ask_question", trainId: "' + training.trainId + '", question: "...")` 向人类提问；',
      '2. 【鼓励更优解法】既可以按人类演示路径用桌面控制逐步完成，也可以改用更快、更稳、更自动化的好方法（例如 Python 脚本、批处理、Office/Excel 工具、快捷键组合等）——只要最终达成同样甚至更好的任务结果并请人类查收正确即可；若采用了更优方法，请用 `flowpack_train(action: "propose_better_method", ...)` 说明对比理由；',
      '3. 本轮完成后，调用 `flowpack_train(action: "record_round", trainId: "' + training.trainId + '", approach: "followed_demo" | "better_alternative", summary: "...", deliverables: [...])` 上报结果，并把关键交付物或检查点列出来请人类查收批注！',
    ].filter(Boolean).join('\n')

    if (sessionId) {
      let baselineEventCount = 0
      const sq = this.ctx?.get?.('sessionQuery')
      if (sq) {
        try {
          const snap = await readSessionSnapshot(sq, sessionId)
          baselineEventCount = snap?.events?.length || 0
        } catch { /* ignore */ }
      }
      this.linkedSessions.set(sessionId, {
        trainId: training.trainId,
        roundNo: nextRoundNo,
        baselineEventCount,
        recorded: false,
      })
    }

    training.updatedAt = Date.now()
    await this.store.saveApprenticeship(training)
    return { training, roundNo: nextRoundNo, prompt }
  }

  /** Record one completed AI practice round (explicitly via tool/API or automatically on agent idle). */
  async recordRound(trainId, {
    sessionId = '',
    approach,
    approachReason = '',
    summary = '',
    toolsUsed = [],
    stepsCount = 0,
    traceSteps = [],
    errorsRecovered = [],
    deliverables = [],
  } = {}) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)

    const rounds = Array.isArray(training.rounds) ? [...training.rounds] : []
    const cleanTools = [...new Set((toolsUsed || []).map(String).filter(Boolean))]
    const usesProgrammaticBetterTools = cleanTools.some(t =>
      /^(bash|powershell|pwsh|run_command|write_file|edit_file|python|excel|office)/i.test(t),
    ) && (training.demoSteps || []).some(s => /click|hotkey|switch_window/.test(s.actionType))

    const resolvedApproach = approach === 'better_alternative' || approach === 'followed_demo'
      ? approach
      : (usesProgrammaticBetterTools ? 'better_alternative' : 'followed_demo')

    const roundNo = rounds.length + 1
    const round = {
      roundNo,
      roundId: `round-${roundNo}-${randomUUID().slice(0, 6)}`,
      sessionId: sessionId || training.sourceSessionId || '',
      approach: resolvedApproach,
      approachReason: truncateText(
        approachReason || (resolvedApproach === 'better_alternative'
          ? `改用 ${cleanTools.slice(0, 4).join(' + ')} 自动化工具完成，避免易错的重复鼠标点击`
          : '按人类示教顺序复现完成'),
        280,
      ),
      summary: truncateText(
        summary || `第 ${roundNo} 轮训练完成：调用 ${stepsCount || traceSteps.length || cleanTools.length} 步 (${cleanTools.slice(0, 4).join('、') || '综合工具'})`,
        400,
      ),
      toolsUsed: cleanTools.slice(0, 16),
      stepsCount: Number(stepsCount) || traceSteps.length || 0,
      traceSteps: Array.isArray(traceSteps) ? traceSteps.slice(-60) : [],
      errorsRecovered: Array.isArray(errorsRecovered) ? errorsRecovered.slice(0, 8) : [],
      deliverables: Array.isArray(deliverables) ? deliverables.slice(0, 10) : [],
      verdict: 'pending_review',
      humanNote: '',
      createdAt: Date.now(),
      annotatedAt: 0,
    }

    rounds.push(round)
    training.rounds = rounds
    if (training.status === 'watching' || training.status === 'ready_for_training') {
      training.status = 'training'
    }
    if (resolvedApproach === 'better_alternative' && round.approachReason) {
      training.betterMethodProposal = round.approachReason
    }
    training.updatedAt = Date.now()

    if (sessionId && this.linkedSessions.has(sessionId)) {
      const link = this.linkedSessions.get(sessionId)
      if (link.trainId === trainId) link.recorded = true
    }

    await this.store.saveApprenticeship(training)
    return { training, round }
  }

  /** Automatically capture a training round from a live DSH chat trace delta when an agent finishes a turn. */
  async recordRoundFromSession(trainId, { sessionId, baselineEventCount = 0 } = {}) {
    const sq = this.ctx?.get?.('sessionQuery')
    if (!sq || !sessionId) return null
    const snapshot = await readSessionSnapshot(sq, sessionId)
    const sliceEvents = Array.isArray(snapshot.events)
      ? snapshot.events.slice(Math.max(0, baselineEventCount))
      : []
    const trace = normalizeSessionTrace({ header: snapshot.header, events: sliceEvents }, { sessionId })
    if ((trace.steps || []).length === 0 && (trace.deliverables || []).length === 0) {
      return null
    }

    // If AI already called `flowpack_train record_round` in this slice, skip duplicate auto-record
    const alreadyExplicit = (trace.steps || []).some(s =>
      s.tool === 'flowpack_train' && String(s.args?.action || '').toLowerCase() === 'record_round',
    )
    if (alreadyExplicit) return null

    const usefulSteps = (trace.steps || []).filter(s => s.tool !== 'flowpack_train')
    const toolsUsed = [...new Set(usefulSteps.map(s => s.tool).filter(Boolean))]
    const deliverables = (trace.deliverables || []).map(d => d.path).filter(Boolean)
    const errorsRecovered = (trace.failures || []).map(f => ({
      tool: f.tool,
      error: truncateText(f.errorMessage || '', 120),
    }))

    return this.recordRound(trainId, {
      sessionId,
      toolsUsed,
      stepsCount: usefulSteps.length,
      traceSteps: usefulSteps,
      errorsRecovered,
      deliverables,
      summary: `AI 实际执行了 ${usefulSteps.length} 步工具操作（${toolsUsed.slice(0, 4).join(' → ')}）${deliverables.length > 0 ? `，产出 ${deliverables.map(p => basename(p)).join('、')}` : ''}`,
    })
  }

  /** Record AI's explicit proposal of a better/faster method during watching or training. */
  async proposeBetterMethod(trainId, { proposal, reason = '' } = {}) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    const text = truncateText(String(proposal || '').trim(), 280)
    if (!text) throw new Error('Proposal text is required.')
    training.betterMethodProposal = reason ? `${text}（理由：${truncateText(reason, 120)}）` : text
    training.updatedAt = Date.now()
    return this.store.saveApprenticeship(training)
  }

  /** Human annotates one AI training round with feedback (`needs_fix`, `ok_practice_more`, `accepted`). */
  async annotateRound(trainId, roundNo, { verdict = 'needs_fix', note = '' } = {}) {
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)
    const cleanVerdict = ['needs_fix', 'ok_practice_more', 'accepted'].includes(verdict)
      ? verdict
      : 'needs_fix'
    const cleanNote = truncateText(redactSecrets(String(note || '').trim(), 'mask').text, 360)

    let targetRound = null
    training.rounds = (training.rounds || []).map((r) => {
      if (Number(r.roundNo) !== Number(roundNo)) return r
      targetRound = {
        ...r,
        verdict: cleanVerdict,
        humanNote: cleanNote || r.humanNote,
        annotatedAt: Date.now(),
      }
      return targetRound
    })
    if (!targetRound) throw new Error(`Round ${roundNo} not found in training "${trainId}".`)

    if (cleanNote && cleanVerdict === 'needs_fix') {
      const rules = new Set(training.coachingRules || [])
      rules.add(cleanNote)
      training.coachingRules = [...rules].slice(0, 20)
    }
    training.updatedAt = Date.now()
    await this.store.saveApprenticeship(training)
    return { training, round: targetRound }
  }

  /**
   * Graduate a verified apprenticeship into BOTH:
   *   1. A crystallized Experience Capsule (Gen 1 human demo baseline + Gen 2 accepted AI route + self-healing rules), AND
   *   2. A SHA-256 sealed Memory Pack capturing human clarifications, coaching rules, verified deliverables & facts.
   */
  async graduateTraining(trainId, { title, scope = 'workspace', inheritSubagents = true } = {}) {
    if (this.activeWatchTrainId === trainId) {
      await this.stopWatch(trainId)
    }
    const training = await this.store.readApprenticeship(trainId)
    if (!training) throw new Error(`Training session "${trainId}" not found.`)

    const prefs = await this.store.readPreferences()
    const finalTitle = truncateText((title || training.title || inferTrainingTitle(training.demoSteps, training.goal)).trim(), 80)
    const targetScope = scope === 'global' || scope === 'session' ? scope : (training.cwd ? 'workspace' : 'global')
    const now = Date.now()

    // Collect human clarifications + coaching rules + errors as permanent guardrails & self-healing rules
    const answeredQs = (training.questions || []).filter(q => q.status === 'answered' && q.answer)
    const humanAnnotations = (training.rounds || []).filter(r => r.humanNote).map(r => ({
      roundNo: r.roundNo,
      verdict: r.verdict,
      note: r.humanNote,
    }))
    const guardrails = [
      ...answeredQs.map(q => `[人类澄清] ${truncateText(q.question, 60)} -> ${q.answer}`),
      ...humanAnnotations.map(a => `[第${a.roundNo}轮批注] ${a.note}`),
      ...(training.coachingRules || []).map(r => `[训练红线] ${r}`),
    ]
    const uniqueGuardrailTexts = [...new Set(guardrails)].slice(0, 18)
    const guardrailObjects = uniqueGuardrailTexts.map((text, idx) => ({
      id: `tr-g-${idx + 1}`,
      tool: '*',
      target: finalTitle,
      rule: text,
      manual: true,
    }))

    const problemFixes = humanAnnotations
      .filter(a => a.verdict === 'needs_fix')
      .map((a, idx) => ({
        fixId: `tr-fix-${idx + 1}`,
        tool: '*',
        target: finalTitle,
        symptom: truncateText(a.note, 100),
        resolutionNote: `按人类第 ${a.roundNo} 轮批注要求修正：${a.note}`,
        occurrences: 1,
      }))

    for (const r of training.rounds || []) {
      for (const err of r.errorsRecovered || []) {
        problemFixes.push({
          fixId: `tr-err-${r.roundNo}-${problemFixes.length + 1}`,
          tool: err.tool || '*',
          target: finalTitle,
          symptom: err.error || '训练执行报错',
          resolutionNote: `第 ${r.roundNo} 轮遇错已自我纠正：参考人类批注与验收方案重试`,
          occurrences: 1,
        })
      }
    }

    // 1. Build strict SHA-256 Memory Pack first so capsule also mirrors key constraints
    const memEntries = emptySections()
    const prov = { sourceType: 'human-apprenticeship', ref: `apprenticeship:${training.trainId}` }
    for (const q of answeredQs) {
      memEntries.decisions.push({
        text: `${truncateText(q.question, 70)} → ${q.answer}`,
        priority: 'high',
        provenance: prov,
      })
    }
    for (const a of humanAnnotations) {
      if (a.verdict === 'needs_fix') {
        memEntries.constraints.push({
          text: `[训练批注红线] ${a.note}`,
          priority: 'critical',
          provenance: prov,
        })
        memEntries.pitfalls.push({
          text: `[第${a.roundNo}轮纠偏避坑] ${a.note}`,
          priority: 'high',
          provenance: prov,
        })
      } else {
        memEntries.facts.push({
          text: `[第${a.roundNo}轮验收补充] ${a.note}`,
          priority: 'high',
          provenance: prov,
        })
      }
    }
    const acceptedRound = [...(training.rounds || [])].reverse().find(r => r.verdict === 'accepted')
      || (training.rounds || [])[(training.rounds || []).length - 1]

    if (acceptedRound?.approach === 'better_alternative' && acceptedRound.approachReason) {
      memEntries.decisions.push({
        text: `经人类验收采用更优执行方式：${acceptedRound.approachReason}`,
        priority: 'high',
        provenance: prov,
      })
    }
    const usedApps = [...new Set((training.demoSteps || []).map(s => friendlyAppName(s.exe)).filter(a => a && a !== '桌面窗口'))]
    if (usedApps.length > 0) {
      memEntries.facts.push({
        text: `示教涉及应用：${usedApps.join('、')}（共示教 ${training.demoSteps?.length || 0} 步，训练 ${training.rounds?.length || 0} 轮后验收通过）`,
        priority: 'normal',
        provenance: prov,
      })
    }
    for (const d of (acceptedRound?.deliverables || []).slice(0, 5)) {
      memEntries.facts.push({
        text: `验收产出文件/目标：${d}`,
        priority: 'normal',
        provenance: prov,
      })
    }
    memEntries.workflows.push({
      text: `关联验收经验按键「${finalTitle}」，来源人类示教 ${training.trainId}`,
      priority: 'normal',
      provenance: prov,
    })

    const { pack: sealedPack } = sealPack({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      packId: `pack-train-${slugifyId(training.trainId, 'tr')}`,
      title: `「${truncateText(finalTitle, 28)}」示教验收记忆`,
      version: 1,
      scope: targetScope,
      workspaceRoot: targetScope === 'workspace' ? training.cwd : '',
      sourceSessionIds: [training.sourceSessionId, ...(acceptedRound?.sessionId ? [acceptedRound.sessionId] : [])].filter(Boolean),
      compactionSurvival: true,
      entries: memEntries,
    }, prefs)
    await this.store.savePack(sealedPack)
    const memorySummary = buildMemorySummary(sealedPack)

    // 2. Build Non-Forgetting Experience Capsule (Gen 1 = Human Demo Baseline; Gen 2 = Accepted Optimal Execution)
    const demoTrace = {
      sessionId: `demo-${training.trainId}`,
      cwd: training.cwd,
      title: finalTitle,
      userMessages: [{ text: training.goal || `学会并高质量执行：${finalTitle}` }],
      steps: (training.demoSteps || []).map((ds, idx) => ({
        index: idx + 1,
        seq: ds.seq || idx + 1,
        tool: ds.actionType === 'manual_note' ? 'human_demo_step' : `gui:${ds.actionType}`,
        kind: /click|hotkey|switch/.test(ds.actionType) ? 'gui' : 'other',
        role: 'human_demo',
        target: `${friendlyAppName(ds.exe)}${ds.controlName ? ` -> ${ds.controlName}` : ''}`,
        args: { exe: ds.exe, controlName: ds.controlName, controlType: ds.controlType },
        status: 'ok',
        isError: false,
      })),
      failures: [],
      touchedFiles: (acceptedRound?.deliverables || []).map(p => ({ path: p, reads: 0, writes: 1 })),
      verificationCommands: [],
      deliverables: (acceptedRound?.deliverables || []).map(p => ({ path: p, seq: 999 })),
    }
    if (demoTrace.steps.length === 0) {
      demoTrace.steps.push({
        index: 1,
        seq: 1,
        tool: 'human_demo_goal',
        kind: 'other',
        role: 'human_demo',
        target: finalTitle,
        status: 'ok',
        isError: false,
      })
    }

    const workflowSlug = slugifyId(finalTitle, 'trained-flow')
    const workflowId = `wf-train-${sha256Hex(`${training.trainId}:${finalTitle}`).slice(0, 8)}`
    const gen1Opt = distillWorkflowFromTrace(demoTrace)
    let workflow = {
      schemaVersion: '2.0.0',
      workflowId,
      name: workflowSlug,
      title: finalTitle,
      description: truncateText(training.goal || `由人类屏幕示教 + ${training.rounds?.length || 0} 轮训练验收沉淀的工作流`, 200),
      version: 1,
      maturity: 'crystallized',
      promotedAsSkill: false,
      workspaceRoot: training.cwd || '',
      family: {
        familyKey: `train:${training.trainId}`,
        intentSignature: finalTitle,
      },
      sourceSessionIds: [training.sourceSessionId].filter(Boolean),
      inputs: [],
      rawStats: {
        turns: Math.max(1, training.rounds?.length || 1),
        rawSteps: training.demoSteps?.length || demoTrace.steps.length,
        toolBreakdown: {},
        deliverablesCount: acceptedRound?.deliverables?.length || 0,
      },
      observations: {
        attempts: Math.max(1, training.rounds?.length || 1),
        successes: Math.max(1, training.rounds?.length || 1),
        crystallizeThreshold: 1,
        problemFixes,
      },
      optimized: {
        ...gen1Opt,
        guardrails: [...(gen1Opt.guardrails || []), ...guardrailObjects].slice(0, 20),
      },
      genealogy: [{
        gen: 1,
        version: 1,
        createdAt: training.createdAt || now,
        action: 'init',
        maturity: 'exploring',
        reason: `人类示教原版路线（共 ${training.demoSteps?.length || 0} 步示范操作）`,
        metrics: { ...gen1Opt.metrics },
        stagesSnapshot: structuredClone(gen1Opt.stages),
        guardrailsSnapshot: structuredClone([...(gen1Opt.guardrails || []), ...guardrailObjects]),
        problemFixesSnapshot: structuredClone(problemFixes),
      }],
      artifacts: {},
      createdAt: training.createdAt || now,
      updatedAt: now,
    }

    // If AI executed an accepted/better practice round with trace steps, add Gen 2 while preserving Gen 1 Human Demo!
    if (acceptedRound && (acceptedRound.traceSteps?.length > 0 || acceptedRound.approach === 'better_alternative')) {
      const roundTrace = {
        sessionId: acceptedRound.sessionId || workflowId,
        cwd: training.cwd,
        title: finalTitle,
        userMessages: [{ text: training.goal || finalTitle }],
        steps: (acceptedRound.traceSteps?.length > 0
          ? acceptedRound.traceSteps
          : (acceptedRound.toolsUsed || ['automation']).map((tl, idx) => ({
            index: idx + 1,
            seq: idx + 1,
            tool: tl,
            kind: 'exec',
            role: 'ai_round',
            target: finalTitle,
            status: 'ok',
            isError: false,
          }))),
        failures: [],
        touchedFiles: (acceptedRound.deliverables || []).map(p => ({ path: p, reads: 0, writes: 1 })),
        verificationCommands: [],
        deliverables: (acceptedRound.deliverables || []).map(p => ({ path: p, seq: 999 })),
      }
      const gen2Opt = distillWorkflowFromTrace(roundTrace)
      const optReason = acceptedRound.approach === 'better_alternative'
        ? `第 ${acceptedRound.roundNo} 轮经人类验收采用 AI 更优方法：${acceptedRound.approachReason}`
        : `第 ${acceptedRound.roundNo} 轮 AI 实操训练验收通过`

      workflow.version = 2
      workflow.optimized = {
        ...gen2Opt,
        guardrails: [...(gen2Opt.guardrails || []), ...guardrailObjects].slice(0, 20),
      }
      workflow.genealogy.push({
        gen: 2,
        version: 2,
        createdAt: now,
        action: 'optimize',
        maturity: 'crystallized',
        reason: optReason,
        metrics: { ...gen2Opt.metrics },
        stagesSnapshot: structuredClone(gen2Opt.stages),
        guardrailsSnapshot: structuredClone(workflow.optimized.guardrails),
        problemFixesSnapshot: structuredClone(problemFixes),
      })
    } else if (uniqueGuardrailTexts.length > 0) {
      workflow = applyOptimizationPass(workflow, {
        reason: '融入人类问答澄清与训练批注规则后封存',
        guardrailNote: uniqueGuardrailTexts[0],
      })
    }

    workflow.artifacts = {
      skillMarkdown: renderSkillMarkdown(workflow),
      workflowScript: renderWorkflowScript(workflow),
    }
    await this.store.saveWorkflow(workflow)

    const capsule = buildCapsuleFromArtifacts({
      workflow,
      pack: sealedPack,
      trace: demoTrace,
      crystallize: true,
      detectedPluginHints: acceptedRound?.toolsUsed || [],
      starterPrompt:
        `使用经人类示教与多轮训练验收通过的经验「${finalTitle}」：`
        + `${acceptedRound?.approach === 'better_alternative' && acceptedRound.approachReason ? `优先采用已验证的更优方案（${acceptedRound.approachReason}）；` : ''}`
        + `严格遵守已沉淀的 ${uniqueGuardrailTexts.length} 条人类批注红线与 ${problemFixes.length} 条纠偏规则，遇到异常可随时对照第 1 版人类示教原版路线兜底！`,
    })
    await this.store.saveCapsule(capsule)

    if (this.capsuleService?.activateCapsule) {
      await this.capsuleService.activateCapsule({
        capsuleId: capsule.capsuleId,
        scope: targetScope,
        sessionId: training.sourceSessionId || '',
        cwd: training.cwd || '',
        inheritSubagents: inheritSubagents !== false,
      }).catch(() => {})
    }

    // Update round & apprenticeship graduation metadata
    if (acceptedRound) {
      training.rounds = (training.rounds || []).map(r =>
        r.roundNo === acceptedRound.roundNo
          ? { ...r, verdict: 'accepted', annotatedAt: r.annotatedAt || now }
          : r,
      )
    }
    training.title = finalTitle
    training.status = 'graduated'
    training.resultCapsuleId = capsule.capsuleId
    training.resultPackId = sealedPack.packId
    training.graduatedAt = now
    training.updatedAt = now
    await this.store.saveApprenticeship(training)

    await this.store.recordAudit({
      kind: 'apprenticeship-graduated',
      trainId: training.trainId,
      capsuleId: capsule.capsuleId,
      packId: sealedPack.packId,
      roundsCount: training.rounds?.length || 0,
      betterMethodAdopted: acceptedRound?.approach === 'better_alternative',
    }).catch(() => {})

    return {
      training,
      capsule,
      pack: sealedPack,
      memorySummary,
      workflow,
    }
  }
}
