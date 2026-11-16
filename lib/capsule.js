/**
 * Selectable Experience Capsule Engine (`dsh-flowpack` v2.0).
 *
 * Bridges human-like progressive learning (`exploring` -> `emerging` -> `crystallized`),
 * immutable non-forgetting workflow genealogy, runtime self-healing rules, SHA-256 integrity,
 * cross-conversation + subagent activation bindings, and cross-platform portability exports.
 */

import { basename } from 'node:path'
import { emptySections, MEMORY_SECTIONS } from './memory-pack.js'
import { isSystemNoiseMessage } from './session-trace.js'
import { applyOptimizationPass, buildMacroStages, renderSkillMarkdown, renderWorkflowScript, restoreWorkflowGeneration, summarizeGenealogy } from './workflow.js'
import { canonicalJson, clampInt, isSameWorkspace, normalizeWorkspaceRoot, pathKey, redactSecrets, scanSecrets, sha256Hex, slugifyId, truncateText } from './util.js'

export const CAPSULE_SCHEMA_VERSION = 'dsh-experience-capsule/v2'

const MATURITY_META = {
  exploring: { icon: '🌱', labelZh: '初次摸索', labelEn: 'Exploring' },
  emerging: { icon: '🌿', labelZh: '逐渐成型', labelEn: 'Emerging' },
  crystallized: { icon: '⚡', labelZh: '已结晶胶囊', labelEn: 'Crystallized' },
}

function normalizeMaturity(value) {
  if (value === 'crystallized' || value === 'emerging') return value
  return 'exploring'
}

/** Build deterministic self-healing lookup rules from a workflow's problemFixes, guardrails, and memory pitfalls. */
export function buildSelfHealingRules(workflow, pack) {
  const rules = []
  const seen = new Set()
  const firstGen = Array.isArray(workflow?.genealogy) && workflow.genealogy.length > 0 ? workflow.genealogy[0].gen : 1

  const addRule = (candidate) => {
    const key = `${String(candidate.tool || '*').toLowerCase()}::${String(candidate.symptomPattern || '').toLowerCase()}`
    if (!candidate.symptomPattern || seen.has(key)) return
    seen.add(key)
    rules.push({
      ruleId: candidate.ruleId || `heal-${sha256Hex(key).slice(0, 10)}`,
      tool: String(candidate.tool || '*'),
      targetHint: truncateText(candidate.targetHint || '', 100),
      symptomPattern: truncateText(candidate.symptomPattern, 140),
      diagnosis: truncateText(candidate.diagnosis || candidate.symptomPattern, 200),
      fixSteps: truncateText(candidate.fixSteps, 320),
      fallbackGen: typeof candidate.fallbackGen === 'number' ? candidate.fallbackGen : firstGen,
      confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.9,
      occurrences: clampInt(candidate.occurrences, 1, 1000, 1),
      sourceSessionId: candidate.sourceSessionId || '',
    })
  }

  for (const fix of workflow?.observations?.problemFixes || []) {
    addRule({
      ruleId: fix.fixId,
      tool: fix.tool || '*',
      targetHint: fix.target || '',
      symptomPattern: fix.symptom,
      diagnosis: `${fix.tool} 此前出现错误: ${fix.symptom}`,
      fixSteps: fix.resolutionNote || `改用 ${fix.resolutionTool || fix.tool} 并调整参数/路径`,
      fallbackGen: firstGen,
      confidence: 0.96,
      occurrences: fix.occurrences || 1,
      sourceSessionId: fix.sourceSessionId || '',
    })
  }

  for (const g of workflow?.optimized?.guardrails || []) {
    const ruleText = String(g?.rule || '').trim()
    if (!ruleText) continue
    addRule({
      ruleId: g.id ? `heal-${slugifyId(g.id, 'g')}` : undefined,
      tool: g.tool || '*',
      targetHint: g.target || '',
      symptomPattern: g.target ? `${g.tool} ${g.target}` : ruleText.slice(0, 80),
      diagnosis: ruleText,
      fixSteps: `按护栏约束处理: ${ruleText}`,
      fallbackGen: firstGen,
      confidence: g.manual ? 0.98 : 0.88,
      occurrences: 1,
    })
  }

  for (const pit of pack?.entries?.pitfalls || []) {
    const text = String(pit?.text || '').trim()
    if (!text) continue
    addRule({
      tool: '*',
      symptomPattern: text.slice(0, 90),
      diagnosis: text,
      fixSteps: `避坑规则: ${text}`,
      fallbackGen: firstGen,
      confidence: pit.confidence ?? 0.9,
      occurrences: 1,
    })
  }

  return rules.slice(0, 40)
}

/** Extract sanitized high-value memory snapshot stored inside the portable capsule. */
function buildCapsuleMemorySnapshot(pack, redactMode = 'mask') {
  const snapshot = emptySections()
  for (const section of MEMORY_SECTIONS) {
    const items = Array.isArray(pack?.entries?.[section]) ? pack.entries[section] : []
    for (const item of items.slice(0, 10)) {
      if (!item?.text) continue
      const safeText = redactMode === 'off' ? item.text : redactSecrets(item.text).text
      snapshot[section].push({
        id: item.id || `m-${sha256Hex(`${section}:${safeText}`).slice(0, 8)}`,
        text: truncateText(safeText, 380),
        priority: item.priority || 'high',
        pinned: Boolean(item.pinned),
        provenance: item.provenance || { sourceType: 'workflow', ref: pack?.packId || 'capsule' },
      })
    }
  }
  return snapshot
}

/** Canonical payload hashed for tamper-evident capsule sealing. */
export function canonicalCapsulePayload(capsule) {
  return {
    schemaVersion: capsule.schemaVersion,
    capsuleId: capsule.capsuleId,
    slug: capsule.slug,
    title: capsule.title,
    description: capsule.description,
    version: capsule.version,
    maturity: capsule.maturity,
    attempts: capsule.attempts,
    successes: capsule.successes,
    crystallizeThreshold: capsule.crystallizeThreshold,
    workspaceRoot: capsule.workspaceRoot || '',
    familyKey: capsule.familyKey || '',
    sourceSessionIds: [...(capsule.sourceSessionIds || [])],
    installedPluginHints: [...(capsule.installedPluginHints || [])],
    workflow: capsule.workflow,
    memory: capsule.memory,
    selfHealing: capsule.selfHealing,
    executionPreset: capsule.executionPreset,
    ...(capsule.learnedSummary ? { learnedSummary: capsule.learnedSummary } : {}),
  }
}

/** Cryptographically seal an experience capsule with SHA-256. */
export function sealCapsule(inputCapsule) {
  const now = Date.now()
  const base = {
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    capsuleId: inputCapsule.capsuleId,
    slug: slugifyId(inputCapsule.slug || inputCapsule.title, 'capsule'),
    title: truncateText(inputCapsule.title || 'Untitled Experience Capsule', 80),
    description: truncateText(inputCapsule.description || '', 240),
    version: clampInt(inputCapsule.version, 1, 1_000_000, 1),
    maturity: normalizeMaturity(inputCapsule.maturity),
    icon: MATURITY_META[normalizeMaturity(inputCapsule.maturity)].icon,
    attempts: clampInt(inputCapsule.attempts, 1, 100_000, 1),
    successes: clampInt(inputCapsule.successes, 0, 100_000, 0),
    crystallizeThreshold: clampInt(inputCapsule.crystallizeThreshold, 1, 10, 3),
    confidence: Number(Math.min(1, Math.max(0.2, inputCapsule.confidence ?? 0.6)).toFixed(2)),
    workspaceRoot: normalizeWorkspaceRoot(inputCapsule.workspaceRoot || ''),
    familyKey: inputCapsule.familyKey || '',
    sourceSessionIds: [...new Set((inputCapsule.sourceSessionIds || []).filter(Boolean))],
    installedPluginHints: [...new Set((inputCapsule.installedPluginHints || []).filter(Boolean))],
    workflow: inputCapsule.workflow,
    memory: inputCapsule.memory || emptySections(),
    selfHealing: inputCapsule.selfHealing || { rules: [], fallbackNote: '' },
    executionPreset: inputCapsule.executionPreset || { mode: 'direct', starterPrompt: '' },
    ...(inputCapsule.learnedSummary ? { learnedSummary: inputCapsule.learnedSummary } : {}),
    createdAt: inputCapsule.createdAt || now,
    updatedAt: inputCapsule.updatedAt || now,
    sealState: 'sealed',
  }

  const canonicalText = canonicalJson(canonicalCapsulePayload(base))
  const sha256 = sha256Hex(canonicalText)
  return {
    ...base,
    integrity: {
      algorithm: 'sha256',
      sha256,
      canonicalBytes: Buffer.byteLength(canonicalText, 'utf8'),
      sealedAt: now,
    },
  }
}

/** Verify an Experience Capsule's schema and SHA-256 integrity seal. */
export function verifyCapsule(capsule) {
  if (!capsule || typeof capsule !== 'object') {
    return { ok: false, tampered: true, validIntegrity: false, errors: ['Capsule object is missing or malformed.'] }
  }
  const errors = []
  if (capsule.schemaVersion !== CAPSULE_SCHEMA_VERSION) {
    errors.push(`Unsupported capsule schemaVersion "${capsule.schemaVersion}".`)
  }
  if (!capsule.capsuleId || !capsule.title || !capsule.workflow) {
    errors.push('Capsule is missing required fields (capsuleId/title/workflow).')
  }
  let secretHits = 0
  for (const section of MEMORY_SECTIONS) {
    for (const item of capsule.memory?.[section] || []) {
      if (scanSecrets(item?.text || '').length > 0) secretHits += 1
    }
  }
  if (secretHits > 0) {
    errors.push(`Capsule memory contains ${secretHits} unredacted secret pattern(s).`)
  }

  let tampered = false
  let validIntegrity = null
  let computedSha256 = sha256Hex(canonicalJson(canonicalCapsulePayload(capsule)))
  const expectedSha256 = capsule.integrity?.sha256 || ''
  if (capsule.sealState === 'sealed') {
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      tampered = true
      validIntegrity = false
      errors.push('Sealed capsule is missing a valid 64-char SHA-256 digest.')
    } else if (expectedSha256.toLowerCase() !== computedSha256) {
      tampered = true
      validIntegrity = false
      errors.push(`Capsule SHA-256 mismatch (expected ${expectedSha256}, got ${computedSha256}).`)
    } else {
      validIntegrity = true
    }
  }

  return {
    ok: errors.length === 0 && !tampered,
    capsuleId: capsule.capsuleId,
    tampered,
    validIntegrity,
    expectedSha256,
    computedSha256,
    errors,
  }
}

/** Build a concise, user-facing confirmation summary telling the user exactly what FlowPack learned. */
export function buildLearnedSummary({ title, workflow, trace, selfHealingRules = [], macroStages = [] }) {
  const cleanTitle = truncateText(title || workflow?.title || '自动化经验流程', 60)
  const rawGoals = (trace?.userMessages || [])
    .map(m => String(m?.text || '').replace(/\s+/g, ' ').trim())
    .filter(s => s && !isSystemNoiseMessage(s))
  const goal = rawGoals[0]
    ? truncateText(rawGoals[0], 110)
    : cleanTitle

  const stepsList = Array.isArray(macroStages) && macroStages.length > 0
    ? macroStages
    : buildMacroStages(workflow?.optimized?.stages || [], trace)

  const keyFixes = selfHealingRules.slice(0, 4).map(r => ({
    tool: r.tool || '*',
    problem: truncateText(r.symptomPattern || '', 80),
    solution: truncateText(r.fixSteps || '', 120),
  }))

  const deliverables = [...new Set(
    (trace?.deliverables || []).map(d => basename(String(d.path || ''))).filter(Boolean),
  )].slice(0, 4)

  const stepPart = stepsList.length > 0
    ? `分 ${stepsList.length} 大步完成（${stepsList.map(s => s.title).slice(0, 3).join(' → ')}${stepsList.length > 3 ? ' 等' : ''}）`
    : '已保存核心执行规范'
  const fixPart = keyFixes.length > 0 ? `，记住了 ${keyFixes.length} 条遇错解决办法人话卡` : ''
  const delivPart = deliverables.length > 0 ? `，产出如 ${deliverables.slice(0, 2).join('、')}` : ''

  const headline = `已学会「${cleanTitle}」：${stepPart}${fixPart}${delivPart}。`
  const recapLines = [
    `目标任务：${goal}`,
    ...stepsList.map(s => `步骤 ${s.stepNo}：${s.title} — ${s.summary}`),
    ...(keyFixes.length > 0
      ? [`避坑解法：${keyFixes.map(f => `${f.problem} → ${f.solution}`).join('；')}`]
      : []),
    ...(deliverables.length > 0 ? [`交付成果：${deliverables.join('、')}`] : []),
  ]

  return {
    headline: truncateText(headline, 220),
    goal,
    macroSteps: stepsList,
    keyFixes,
    deliverables,
    recapLines,
    understoodAt: Date.now(),
  }
}

/** Compose & seal a complete Experience Capsule from a WorkflowRecord + optional strict MemoryPack. */
export function buildCapsuleFromArtifacts({
  workflow,
  pack,
  existingCapsule,
  trace,
  detectedPluginHints = [],
  crystallize = false,
  starterPrompt,
}) {
  if (!workflow) throw new Error('Workflow record is required to build an experience capsule.')
  const now = Date.now()
  const slug = existingCapsule?.slug || slugifyId(workflow.name || workflow.title, 'capsule')
  const capsuleId = existingCapsule?.capsuleId || `cap-${slug}-${sha256Hex(workflow.family?.familyKey || workflow.workflowId).slice(0, 6)}`
  const maturity = crystallize ? 'crystallized' : normalizeMaturity(workflow.maturity)
  const attempts = Math.max(existingCapsule?.attempts || 0, workflow.observations?.attempts || 1)
  const successes = Math.max(existingCapsule?.successes || 0, workflow.observations?.successes || (maturity === 'crystallized' ? 1 : 0))
  const threshold = workflow.observations?.crystallizeThreshold || existingCapsule?.crystallizeThreshold || 3
  const nextVersion = existingCapsule ? (existingCapsule.version || 1) + 1 : 1
  const genealogy = Array.isArray(workflow.genealogy) ? structuredClone(workflow.genealogy) : []
  const genealogySummary = summarizeGenealogy(workflow)
  const firstGen = genealogy[0]
  const selfHealingRules = buildSelfHealingRules(workflow, pack)
  const macroStages = Array.isArray(workflow.optimized?.macroStages) && workflow.optimized.macroStages.length > 0
    ? structuredClone(workflow.optimized.macroStages)
    : buildMacroStages(workflow.optimized?.stages || [], trace)

  const learnedSummary = buildLearnedSummary({
    title: workflow.title,
    workflow,
    trace,
    selfHealingRules,
    macroStages,
  })

  const usedTools = [...new Set([
    ...(existingCapsule?.installedPluginHints || []),
    ...detectedPluginHints,
    ...(workflow.optimized?.steps || []).map(s => s.tool).filter(Boolean),
  ])].slice(0, 20)

  const defaultStarter = starterPrompt
    || `使用已记住的经验「${workflow.title}」执行当前任务：`
    + `按总结好的 ${macroStages.length || 1} 步方法推进（${macroStages.map(s => s.title).slice(0, 3).join(' → ')}），`
    + `自动遵守已记录的 ${selfHealingRules.length} 条避坑与自我纠错方法，遇异常时对照历史初版基线修正。`

  const scoreConfidence = Math.min(0.99, Math.max(0.35, ((workflow.optimized?.metrics?.afterScore || 65) / 100) * 0.7 + Math.min(0.3, successes * 0.1)))

  return sealCapsule({
    capsuleId,
    slug,
    title: workflow.title,
    description: truncateText(learnedSummary.headline, 180),
    version: nextVersion,
    maturity,
    attempts,
    successes,
    crystallizeThreshold: threshold,
    confidence: scoreConfidence,
    workspaceRoot: workflow.workspaceRoot || pack?.workspaceRoot || existingCapsule?.workspaceRoot || '',
    familyKey: workflow.family?.familyKey || existingCapsule?.familyKey || '',
    sourceSessionIds: [...(existingCapsule?.sourceSessionIds || []), ...(workflow.sourceSessionIds || [])],
    installedPluginHints: usedTools,
    workflow: {
      workflowId: workflow.workflowId,
      name: workflow.name,
      version: workflow.version,
      inputs: workflow.inputs || [],
      stages: structuredClone(workflow.optimized?.stages || []),
      macroStages,
      guardrails: structuredClone(workflow.optimized?.guardrails || []),
      metrics: structuredClone(workflow.optimized?.metrics || {}),
      genealogy,
      genealogySummary,
      ptcScript: workflow.artifacts?.workflowScript || renderWorkflowScript(workflow),
      skillMarkdown: workflow.artifacts?.skillMarkdown || renderSkillMarkdown(workflow),
    },
    learnedSummary,
    memory: buildCapsuleMemorySnapshot(pack),
    selfHealing: {
      rules: selfHealingRules,
      fallbackNote: firstGen
        ? `保留第 ${firstGen.gen} 版初稿作为保底基线，新做法受阻时可随时参考或恢复`
        : '',
    },
    executionPreset: {
      mode: existingCapsule?.executionPreset?.mode || 'direct',
      starterPrompt: truncateText(defaultStarter, 360),
    },
    createdAt: existingCapsule?.createdAt || now,
    updatedAt: now,
  })
}

/**
 * Resolve ALL active Experience Capsules for a live conversation OR spawned subagent!
 * Priority / scope layers:
 *   1. `session` binding directly on `sessionId`
 *   2. `subagent-inherited` binding inherited from `parentSessionId` when `isSubagent && subagentInheritance`
 *   3. `workspace` binding matching `cwd` (shared across all conversations in that project)
 *   4. `global` binding (shared across all conversations & all agents platform-wide)
 */
export function resolveActiveCapsules({
  activations,
  capsules = [],
  sessionId = '',
  parentSessionId = '',
  isSubagent = false,
  cwd = '',
  subagentInheritance = true,
  requireSealed = false,
} = {}) {
  const byId = new Map(capsules.map(c => [c.capsuleId, c]))
  const act = activations || { global: [], workspaces: {}, sessions: {} }
  const normalizedCwd = normalizeWorkspaceRoot(cwd)
  const wsKey = normalizedCwd ? pathKey(normalizedCwd) : ''

  const candidates = []
  const pushScope = (list, scopeLabel, inheritedFrom = '') => {
    for (const binding of Array.isArray(list) ? list : []) {
      if (inheritedFrom && binding.inheritSubagents === false) continue
      candidates.push({ binding, scopeLabel, inheritedFrom })
    }
  }

  if (sessionId && act.sessions?.[sessionId]) {
    pushScope(act.sessions[sessionId], 'session')
  }
  if (isSubagent && subagentInheritance && parentSessionId && act.sessions?.[parentSessionId]) {
    pushScope(act.sessions[parentSessionId], 'subagent-inherited', parentSessionId)
  }
  if (wsKey && act.workspaces?.[wsKey]) {
    pushScope(act.workspaces[wsKey], 'workspace')
  }
  pushScope(act.global, 'global')

  const resolved = []
  const seenCapsuleIds = new Set()
  const quarantined = []

  for (const item of candidates) {
    const cap = byId.get(item.binding.capsuleId)
    if (!cap || seenCapsuleIds.has(cap.capsuleId)) continue
    seenCapsuleIds.add(cap.capsuleId)

    const ver = verifyCapsule(cap)
    if (!ver.ok) {
      quarantined.push({ capsuleId: cap.capsuleId, title: cap.title, errors: ver.errors })
      continue
    }
    if (requireSealed && cap.sealState !== 'sealed') continue

    resolved.push({
      capsule: cap,
      activationScope: item.scopeLabel,
      inheritedFrom: item.inheritedFrom || undefined,
      preset: item.binding.preset || 'direct',
      activatedAt: item.binding.activatedAt,
    })
  }

  return { resolved, quarantined }
}

/** Export a portable Experience Capsule bundle in multiple cross-platform formats. */
export function exportCapsuleBundle(capsule, format = 'skill') {
  if (!capsule) throw new Error('Capsule is required for export.')
  const fmt = String(format || 'skill').toLowerCase()
  const wf = capsule.workflow || {}
  const rules = capsule.selfHealing?.rules || []
  const genSummary = wf.genealogySummary || []

  if (fmt === 'dshcapsule' || fmt === 'json') {
    return `${JSON.stringify(capsule, null, 2)}\n`
  }

  if (fmt === 'ptc' || fmt === 'script') {
    return wf.ptcScript || '// No PTC script embedded\n'
  }

  if (fmt === 'agents_md' || fmt === 'agents') {
    const lines = [
      `## Experience Capsule: ${capsule.title} (${capsule.slug} · v${capsule.version})`,
      '',
      `- Maturity: ${capsule.maturity} (attempts=${capsule.attempts}, successes=${capsule.successes})`,
      `- Self-Healing Fallback: ${capsule.selfHealing?.fallbackNote || 'Consult Gen 1 baseline if optimized step fails'}`,
      '',
      '### Execution Stages',
      ...(wf.stages || []).map((st, idx) =>
        `${idx + 1}. [${String(st.executionMode || 'serial').toUpperCase()}] ${st.phaseLabel}: ${(st.steps || []).map(s => `${s.tool}(${s.target || '-'})`).join(' | ')}`,
      ),
      '',
      '### Self-Healing Rules & Guardrails',
      ...(rules.length > 0
        ? rules.slice(0, 12).map(r => `- If \`${r.tool}\` hits "${truncateText(r.symptomPattern, 70)}": ${r.fixSteps} (fallback: Gen ${r.fallbackGen})`)
        : ['- Follow verified workflow sequence strictly.']),
      '',
    ]
    return `${lines.join('\n').trimEnd()}\n`
  }

  if (fmt === 'markdown' || fmt === 'manual') {
    const lines = [
      `# ${capsule.icon || '⚡'} FlowPack 经验胶囊手册: ${capsule.title}`,
      '',
      `- **Capsule ID**: \`${capsule.capsuleId}\` (v${capsule.version} · ${capsule.maturity})`,
      `- **积累次数**: 执行 ${capsule.attempts} 次 / 成功 ${capsule.successes} 次 (结晶阈值 ${capsule.crystallizeThreshold})`,
      `- **SHA-256 封印**: \`${capsule.integrity?.sha256 || 'unsealed'}\``,
      `- **关联能力/插件**: ${(capsule.installedPluginHints || []).join(', ') || '通用工具'}`,
      '',
      '## 1. 优化工作流阶段',
      '',
      ...(wf.stages || []).map((st, idx) =>
        `### ${idx + 1}. ${st.phaseLabel} [${st.executionMode}]\n`
        + (st.steps || []).map(s => `- **${s.tool}**: ${s.goal}`).join('\n'),
      ),
      '',
      '## 2. 自我纠正与自愈规则 (Self-Healing Matrix)',
      '',
      ...(rules.length > 0
        ? rules.map(r => `- **[${r.tool}]** 症状: \`${r.symptomPattern}\` → 修正: ${r.fixSteps} *(保底回溯: Gen ${r.fallbackGen})*`)
        : ['- 暂无已捕获错误模式']),
      '',
      '## 3. 非遗忘演化谱系 (Genealogy Timeline)',
      '',
      '| 代次 | 版本 | 阶段/成熟度 | 步骤数 | 评分 | 演化原因与历史快照保留 |',
      '| --- | --- | --- | --- | --- | --- |',
      ...genSummary.map(g => `| Gen ${g.gen} | v${g.version} | ${g.maturity || g.action} | ${g.steps} | ${g.score} | ${truncateText(g.reason || '-', 90)} |`),
      '',
      '## 4. 一键复用提示词 (Starter Prompt)',
      '',
      '> ' + (capsule.executionPreset?.starterPrompt || ''),
      '',
    ]
    return `${lines.join('\n').trimEnd()}\n`
  }

  // Default: universal cross-platform `SKILL.md` (compatible with DSH, Antigravity, Codex, Claude Code, Cursor)
  const baseSkill = (wf.skillMarkdown || renderSkillMarkdown({
    workflowId: wf.workflowId || capsule.capsuleId,
    name: capsule.slug,
    title: capsule.title,
    description: capsule.description,
    version: wf.version || capsule.version,
    inputs: wf.inputs || [],
    optimized: { stages: wf.stages || [], guardrails: wf.guardrails || [], metrics: wf.metrics || {} },
  })).trimEnd()

  const extra = [
    '',
    '## 自愈排错指南 (Self-Healing Rules)',
    '',
    ...(rules.length > 0
      ? rules.slice(0, 15).map(r => `- **${r.tool}** 遇 "${truncateText(r.symptomPattern, 70)}" → ${r.fixSteps} (兜底参考 Gen ${r.fallbackGen})`)
      : ['- 如步骤报错，检查参数与权限后再重试，避免盲目循环调用。']),
    '',
    '## 演化谱系摘要 (Non-Forgetting Workflow Genealogy)',
    '',
    ...(genSummary.length > 0
      ? genSummary.map(g => `- **Gen ${g.gen} (v${g.version})**: ${g.steps} 步, 评分 ${g.score} — ${g.reason}`)
      : ['- Gen 1: Initial distilled baseline']),
    '',
  ]
  return `${baseSkill}\n${extra.join('\n').trimEnd()}\n`
}

/** High-level CapsuleService coordinating progressive learning, activation across scopes/subagents, and portability. */
export class CapsuleService {
  constructor(ctx, store, workflowService, memoryService, capabilityInspector) {
    this.ctx = ctx
    this.store = store
    this.workflowService = workflowService
    this.memoryService = memoryService
    this.capabilityInspector = capabilityInspector
  }

  /** Capture & evolve an Experience Capsule from a DSH session (trial -> emerging -> crystallized). */
  async learnFromSession({
    sessionId,
    capsuleId,
    workflowId,
    title,
    name,
    crystallize = false,
    crystallizeThreshold,
    scope,
    activate = false,
    activateScope,
    signal,
  } = {}) {
    const prefs = await this.store.readPreferences()
    const threshold = clampInt(crystallizeThreshold, 1, 10, prefs.crystallizeThreshold)

    let targetWorkflowId = workflowId
    let existingCapsule = capsuleId ? await this.store.readCapsule(capsuleId) : undefined
    if (existingCapsule && !targetWorkflowId) {
      targetWorkflowId = existingCapsule.workflow?.workflowId
    }

    const { workflow, trace } = await this.workflowService.distillFromSession({
      sessionId,
      workflowId: targetWorkflowId,
      title,
      name: existingCapsule?.slug || name,
      crystallize,
      crystallizeThreshold: threshold,
      signal,
    })

    // Locate any existing capsule linked to this workflow/family so consolidation accumulates cleanly
    if (!existingCapsule) {
      const { capsules } = await this.store.listCapsules()
      existingCapsule = capsules.find(c =>
        c.workflow?.workflowId === workflow.workflowId
        || (workflow.family?.familyKey && c.familyKey === workflow.family.familyKey),
      )
    }

    const packRes = await this.memoryService.packFromSession({
      sessionId,
      scope: scope || (existingCapsule?.workspaceRoot ? 'workspace' : 'workspace'),
      title: `${workflow.title} 伴生严格记忆`,
      seal: true,
      signal,
    }).catch(() => null)

    const capabilities = await this.capabilityInspector?.()?.catch?.(() => ({ tools: [] }))
    const activeToolNames = Array.isArray(capabilities?.tools) ? capabilities.tools.map(t => t.name) : []
    const usedTools = (workflow.optimized?.steps || []).map(s => s.tool).filter(Boolean)
    const relevantHints = [...new Set([...usedTools, ...activeToolNames.filter(n => /^(office_|excel_|computer|open_application|codebuddy_|file_launcher)/.test(n))])]

    const capsule = buildCapsuleFromArtifacts({
      workflow,
      pack: packRes?.pack,
      existingCapsule,
      trace,
      detectedPluginHints: relevantHints,
      crystallize,
    })

    await this.store.saveCapsule(capsule)
    await this.store.recordAudit({
      kind: 'capsule-learn',
      capsuleId: capsule.capsuleId,
      sessionId,
      version: capsule.version,
      maturity: capsule.maturity,
      attempts: capsule.attempts,
      successes: capsule.successes,
    })

    let activations
    if (activate || (capsule.maturity === 'crystallized' && activate !== false && existingCapsule?.maturity !== 'crystallized')) {
      activations = await this.activateCapsule({
        capsuleId: capsule.capsuleId,
        scope: activateScope || (capsule.workspaceRoot ? 'workspace' : 'global'),
        sessionId,
        cwd: capsule.workspaceRoot || trace?.cwd || '',
        inheritSubagents: prefs.subagentInheritance,
      })
    } else {
      activations = await this.store.readActivations()
    }

    return { capsule, workflow, pack: packRes?.pack || null, activations }
  }

  /** Record a newly solved bug/workaround into an existing capsule without forgetting earlier generations. */
  async learnProblemFix({
    capsuleId,
    tool = '*',
    target = '',
    symptom,
    resolution,
    sourceSessionId = '',
  } = {}) {
    if (!capsuleId) throw new Error('capsuleId is required to learn a problem fix.')
    if (!symptom || !resolution) throw new Error('Both symptom and resolution are required.')
    const existingCapsule = await this.store.readCapsule(capsuleId)
    if (!existingCapsule) throw new Error(`Experience capsule "${capsuleId}" not found.`)

    const wfId = existingCapsule.workflow?.workflowId
    let workflow = wfId ? await this.store.readWorkflow(wfId) : null
    if (!workflow) {
      throw new Error(`Linked workflow "${wfId || 'none'}" not found for capsule "${capsuleId}".`)
    }

    const updatedFixes = [
      ...(workflow.observations?.problemFixes || []),
      {
        fixId: `fix-${sha256Hex(`${tool}:${symptom}:${Date.now()}`).slice(0, 10)}`,
        tool,
        target,
        symptom: truncateText(symptom, 180),
        resolutionTool: tool,
        resolutionTarget: target,
        resolutionNote: truncateText(resolution, 240),
        occurrences: 1,
        sourceSessionId,
        lastSeenAt: Date.now(),
      },
    ]

    workflow = {
      ...workflow,
      observations: {
        ...(workflow.observations || {}),
        problemFixes: updatedFixes,
      },
    }
    const optimizedWf = applyOptimizationPass(workflow, {
      addGuardrail: `${tool}: 遇 "${truncateText(symptom, 60)}" → ${truncateText(resolution, 100)}`,
      action: 'self-heal-fix',
      reason: `实战遇到新问题并吸收解法（保留此前全部代数）: ${truncateText(resolution, 90)}`,
      sourceSessionId,
    })
    await this.store.saveWorkflow(optimizedWf)
    await this.workflowService.syncRuntimeSkills?.()

    const capsule = buildCapsuleFromArtifacts({
      workflow: optimizedWf,
      existingCapsule,
      crystallize: existingCapsule.maturity === 'crystallized',
    })
    await this.store.saveCapsule(capsule)
    await this.store.recordAudit({
      kind: 'capsule-self-heal-learned',
      capsuleId: capsule.capsuleId,
      version: capsule.version,
      tool,
      symptom: truncateText(symptom, 100),
    })
    return { capsule, workflow: optimizedWf }
  }

  /** Restore an earlier generation inside a capsule forward while keeping newer generations in genealogy. */
  async restoreGeneration({ capsuleId, gen } = {}) {
    const existingCapsule = await this.store.readCapsule(capsuleId)
    if (!existingCapsule) throw new Error(`Experience capsule "${capsuleId}" not found.`)
    const wfId = existingCapsule.workflow?.workflowId
    const restoredWf = await this.workflowService.restoreGeneration({ workflowId: wfId, gen })
    const capsule = buildCapsuleFromArtifacts({
      workflow: restoredWf,
      existingCapsule,
      crystallize: existingCapsule.maturity === 'crystallized',
    })
    await this.store.saveCapsule(capsule)
    return { capsule, workflow: restoredWf }
  }

  /** Activate a capsule button for session, workspace (all project chats), or global (all chats + all agents). */
  async activateCapsule({
    capsuleId,
    scope = 'workspace',
    sessionId = '',
    cwd = '',
    preset = 'direct',
    inheritSubagents = true,
  } = {}) {
    const capsule = await this.store.readCapsule(capsuleId)
    if (!capsule) throw new Error(`Experience capsule "${capsuleId}" was not found.`)
    const ver = verifyCapsule(capsule)
    if (!ver.ok) throw new Error(`Refusing to activate unverified/tampered capsule "${capsuleId}": ${ver.errors.join('; ')}`)

    const targetScope = scope === 'session' || scope === 'global' ? scope : 'workspace'
    if (targetScope === 'session' && !sessionId) {
      throw new Error('Activating a capsule for "session" scope requires an active sessionId.')
    }
    const resolvedCwd = normalizeWorkspaceRoot(cwd || capsule.workspaceRoot || '')
    if (targetScope === 'workspace' && !resolvedCwd) {
      // Gracefully fall back to global when no workspace directory is associated yet
      return this.activateCapsule({ capsuleId, scope: 'global', sessionId, cwd: '', preset, inheritSubagents })
    }

    const binding = {
      capsuleId,
      activatedAt: Date.now(),
      preset: preset === 'assist' ? 'assist' : 'direct',
      inheritSubagents: inheritSubagents !== false,
      ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
    }

    const activations = await this.store.updateActivations((state, { pathKey: pk }) => {
      if (targetScope === 'global') {
        state.global = [binding, ...state.global.filter(b => b.capsuleId !== capsuleId)]
      } else if (targetScope === 'workspace') {
        const key = pk(resolvedCwd)
        const list = state.workspaces[key] || []
        state.workspaces[key] = [binding, ...list.filter(b => b.capsuleId !== capsuleId)]
      } else {
        const list = state.sessions[sessionId] || []
        state.sessions[sessionId] = [binding, ...list.filter(b => b.capsuleId !== capsuleId)]
      }
      return state
    })

    await this.store.recordAudit({
      kind: 'capsule-activate',
      capsuleId,
      scope: targetScope,
      sessionId: sessionId || undefined,
      cwd: resolvedCwd || undefined,
      inheritSubagents: binding.inheritSubagents,
    })

    return activations
  }

  /** Deactivate a capsule button in the requested scope (or all scopes when `scope === 'all'`). */
  async deactivateCapsule({ capsuleId, scope = 'all', sessionId = '', cwd = '' } = {}) {
    const activations = await this.store.updateActivations((state, { pathKey: pk }) => {
      if (scope === 'global' || scope === 'all') {
        state.global = state.global.filter(b => b.capsuleId !== capsuleId)
      }
      if (scope === 'workspace' || scope === 'all') {
        if (cwd) {
          const key = pk(normalizeWorkspaceRoot(cwd))
          if (state.workspaces[key]) state.workspaces[key] = state.workspaces[key].filter(b => b.capsuleId !== capsuleId)
        } else if (scope === 'all') {
          for (const key of Object.keys(state.workspaces)) {
            state.workspaces[key] = state.workspaces[key].filter(b => b.capsuleId !== capsuleId)
          }
        }
      }
      if (scope === 'session' || scope === 'all') {
        if (sessionId && state.sessions[sessionId]) {
          state.sessions[sessionId] = state.sessions[sessionId].filter(b => b.capsuleId !== capsuleId)
        } else if (scope === 'all') {
          for (const sid of Object.keys(state.sessions)) {
            state.sessions[sid] = state.sessions[sid].filter(b => b.capsuleId !== capsuleId)
          }
        }
      }
      return state
    })
    return activations
  }

  /** Allow the user to give a friendlier custom name to an existing capsule and re-seal it. */
  async renameCapsule({ capsuleId, title } = {}) {
    const cleanTitle = truncateText(String(title || '').trim(), 64)
    if (!cleanTitle) throw new Error('A non-empty title is required.')
    const existing = await this.store.readCapsule(capsuleId)
    if (!existing) throw new Error(`Experience capsule "${capsuleId}" was not found.`)
    const macroSteps = existing.learnedSummary?.macroSteps || existing.workflow?.macroStages || []
    const rules = existing.selfHealing?.rules || []
    const updatedLearnedSummary = existing.learnedSummary
      ? {
        ...existing.learnedSummary,
        headline: truncateText(`已学会「${cleanTitle}」：按 ${macroSteps.length || 1} 步推进，含 ${rules.length} 条避坑解法。`, 220),
      }
      : undefined
    const renamed = sealCapsule({
      ...existing,
      title: cleanTitle,
      description: updatedLearnedSummary?.headline || existing.description,
      ...(updatedLearnedSummary ? { learnedSummary: updatedLearnedSummary } : {}),
      executionPreset: {
        ...(existing.executionPreset || { mode: 'direct' }),
        starterPrompt: `使用已记住的经验「${cleanTitle}」执行当前任务：优先按优化路线推进，并遵守 ${rules.length} 条避坑解法。`,
      },
      updatedAt: Date.now(),
    })
    await this.store.saveCapsule(renamed)
    await this.store.recordAudit({ kind: 'capsule-rename', capsuleId, title: cleanTitle })
    return renamed
  }

  /** Strictly verify & import an exported `.dshcapsule.json` bundle from another DSH instance or machine. */
  async importCapsuleBundle(rawBundle) {
    let parsed
    try {
      parsed = typeof rawBundle === 'string' ? JSON.parse(rawBundle) : rawBundle
    } catch {
      throw new Error('Capsule bundle must be valid JSON.')
    }
    const ver = verifyCapsule(parsed)
    if (!ver.ok) {
      throw new Error(`Strict capsule verification failed:\n- ${ver.errors.join('\n- ')}`)
    }
    await this.store.saveCapsule(parsed)
    await this.store.recordAudit({
      kind: 'capsule-import',
      capsuleId: parsed.capsuleId,
      version: parsed.version,
      sha256: parsed.integrity?.sha256,
    })
    return { capsule: parsed, verification: ver }
  }
}
