/**
 * AI Workflow Distillation & Optimization Engine for dsh-flowpack.
 *
 * Deterministically transforms raw DSH session traces into structured,
 * parameterized, parallel-batched, guardrail-hardened workflows, generating
 * ready-to-use `SKILL.md` definitions and DSH `workflow` JS orchestration scripts.
 */

import { basename } from 'node:path'
import { isSystemNoiseMessage, listSessionsWithTitles, normalizeSessionTrace, readSessionSnapshot } from './session-trace.js'
import { clampInt, normalizeWorkspaceRoot, pathKey, sha256Hex, slugifyId, truncateText } from './util.js'

const PHASE_META = {
  prepare: { label: '打开应用与权限准备', order: 1 },
  discover: { label: '读取与查找资料', order: 2 },
  automate: { label: '页面与桌面采集操作', order: 3 },
  edit: { label: '生成与加工内容', order: 4 },
  verify: { label: '脚本执行与核对验证', order: 5 },
  deliver: { label: '输出成果与交付汇报', order: 6 },
}

/** Synthesize a short, human-meaningful Chinese title from real chat goal & deliverables. */
export function smartDistillTitle(trace, explicitTitle) {
  const cleanLine = (raw, maxLen = 40) => {
    const s = String(raw ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[A-Za-z]:\\[^\s]+|\/(?:Users|home|var|tmp|opt)[^\s]+/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/^[#>*\-\d.\s]+/, '')
      .replace(/^(?:请帮我|帮我|麻烦|请|你去|再|继续|帮我再)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
    return s.length > 0 ? truncateText(s, maxLen) : ''
  }

  if (explicitTitle && !isSystemNoiseMessage(explicitTitle)) {
    const t = cleanLine(explicitTitle, 64)
    if (t) return t
  }

  const cwdBase = trace?.cwd ? basename(trace.cwd) : ''
  const rawTraceTitle = String(trace?.title || '').trim()
  const isUuidLike = /^[0-9a-f-]{16,}$/i.test(rawTraceTitle)
  if (rawTraceTitle
    && rawTraceTitle !== trace?.sessionId
    && rawTraceTitle !== cwdBase
    && rawTraceTitle !== 'unknown-session'
    && !isUuidLike
    && !isSystemNoiseMessage(rawTraceTitle)) {
    const nice = cleanLine(rawTraceTitle, 40)
    if (nice) return nice
  }

  const realMsgs = (trace?.userMessages || [])
    .map(m => cleanLine(m?.text, 44))
    .filter(text => text.length >= 4 && !/^(继续|好的|好|ok|yes|确定|明白|收到)$/i.test(text))
  if (realMsgs.length > 0) {
    return truncateText(realMsgs[0], 32)
  }

  const deliv = (trace?.deliverables || []).map(d => basename(d.path || '').replace(/\.[a-z0-9]+$/i, '')).filter(Boolean)
  if (deliv.length > 0) {
    return truncateText(`${deliv[0]}等自动化任务`, 32)
  }

  const tools = new Set((trace?.steps || []).map(s => String(s.tool || '').toLowerCase()))
  if ([...tools].some(n => n.startsWith('excel_'))) return 'Excel 表格整理与汇总流程'
  if ([...tools].some(n => n.startsWith('office_'))) return '文档排版与批量生成流程'
  if (tools.has('computer') || tools.has('open_application')) return '桌面与网页自动化采集流程'
  return '自动化经验工作流'
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'please', 'help', 'fix', 'make',
  '请', '帮我', '帮忙', '一下', '这个', '那个', '工作流', '任务', '需要', '进行', '完成',
])

/** Extract normalized tokens from a prompt/title for cross-session task family matching. */
function tokenizeGoal(text) {
  const raw = String(text ?? '').toLowerCase()
  const ascii = raw.match(/[a-z0-9_-]{2,}/g) || []
  const cjkChunks = raw.match(/[\u4e00-\u9fff]{2,}/g) || []
  const cjkBigrams = []
  for (const chunk of cjkChunks) {
    if (chunk.length <= 4) cjkBigrams.push(chunk)
    for (let i = 0; i <= chunk.length - 2 && cjkBigrams.length < 24; i += 2) {
      cjkBigrams.push(chunk.slice(i, i + 2))
    }
  }
  return [...new Set([...ascii, ...cjkBigrams].filter(t => !STOP_WORDS.has(t)))].slice(0, 18)
}

/**
 * Compute deterministic task-family fingerprint so repeated runs across different sessions
 * recognize they belong to the same evolving workflow/experience family.
 */
export function computeTaskFingerprint(trace) {
  const goalText = trace?.userMessages?.[0]?.text || trace?.title || ''
  const tokens = tokenizeGoal(goalText)
  const toolSet = [...new Set((trace?.steps || []).filter(s => !s.isError).map(s => String(s.tool || '').toLowerCase()).filter(Boolean))].sort()
  const phaseProfile = [...new Set((trace?.steps || []).map(inferPhase))].sort()
  const wsName = trace?.cwd ? basename(normalizeWorkspaceRoot(trace.cwd)).toLowerCase() : ''
  const canonicalSeed = {
    wsName,
    tokens: tokens.slice(0, 8).sort(),
    tools: toolSet.slice(0, 8),
    phases: phaseProfile,
  }
  return {
    familyKey: `fam-${sha256Hex(JSON.stringify(canonicalSeed)).slice(0, 12)}`,
    goalTokens: tokens,
    toolProfile: toolSet,
    phaseProfile,
    workspaceName: wsName,
  }
}

/** Score similarity (0..1) between a trace's fingerprint and an existing workflow's fingerprint. */
export function scoreFingerprintSimilarity(traceFp, existingWf) {
  if (!traceFp || !existingWf) return 0
  if (existingWf.family?.familyKey && existingWf.family.familyKey === traceFp.familyKey) return 1
  const existingTokens = new Set(existingWf.family?.goalTokens || tokenizeGoal(existingWf.title))
  const traceTokens = new Set(traceFp.goalTokens || [])
  const existingTools = new Set(existingWf.family?.toolProfile || [])
  const traceTools = new Set(traceFp.toolProfile || [])

  const jaccard = (a, b) => {
    if (a.size === 0 && b.size === 0) return 0
    let inter = 0
    for (const v of a) if (b.has(v)) inter += 1
    const union = a.size + b.size - inter
    return union === 0 ? 0 : inter / union
  }

  const tokenSim = jaccard(traceTokens, existingTokens)
  const toolSim = jaccard(traceTools, existingTools)
  const sameWs = traceFp.workspaceName && existingWf.workspaceRoot
    ? (basename(normalizeWorkspaceRoot(existingWf.workspaceRoot)).toLowerCase() === traceFp.workspaceName ? 0.15 : 0)
    : 0
  return Math.min(1, Number((tokenSim * 0.6 + toolSim * 0.25 + sameWs).toFixed(3)))
}

/** Pair observed tool errors with their subsequent successful resolution inside the trace. */
export function extractProblemFixes(trace) {
  const rawSteps = Array.isArray(trace?.steps) ? trace.steps : []
  const pendingFails = []
  const fixes = []
  const seen = new Map()

  for (const step of rawSteps) {
    if (step.isError) {
      pendingFails.push(step)
      continue
    }
    if (pendingFails.length === 0) continue

    const stepTargetKey = pathKey(step.target || '')
    for (let idx = pendingFails.length - 1; idx >= 0; idx -= 1) {
      const fail = pendingFails[idx]
      const failTargetKey = pathKey(fail.target || '')
      const sameTool = String(fail.tool).toLowerCase() === String(step.tool).toLowerCase()
      const sameTarget = failTargetKey.length > 0 && failTargetKey === stepTargetKey
      const samePhase = inferPhase(fail) === inferPhase(step)
      if (!sameTool && !sameTarget && !samePhase) continue

      pendingFails.splice(idx, 1)
      const symptom = truncateText(fail.errorMessage || 'Previous execution failed', 180)
      const resolutionTarget = step.target || fail.target || ''
      const resolutionNote = sameTool
        ? `重试修正 ${fail.tool}: 此前报错 "${truncateText(symptom, 80)}" → 调整参数/目标 (${truncateText(resolutionTarget || step.kind, 60)}) 后通过`
        : `替代方案修复: ${fail.tool} 报错 "${truncateText(symptom, 80)}" → 改用 ${step.tool}${resolutionTarget ? ` (${truncateText(resolutionTarget, 60)})` : ''} 成功`
      const key = `${String(fail.tool).toLowerCase()}::${symptom.toLowerCase().slice(0, 80)}`
      const prev = seen.get(key)
      if (prev) {
        prev.occurrences += 1
        prev.lastSeenAt = Date.now()
      } else {
        const entry = {
          fixId: `fix-${sha256Hex(key).slice(0, 10)}`,
          tool: fail.tool,
          target: fail.target || '',
          symptom,
          resolutionTool: step.tool,
          resolutionTarget,
          resolutionNote,
          occurrences: 1,
          sourceSessionId: trace.sessionId,
          lastSeenAt: Date.now(),
        }
        seen.set(key, entry)
        fixes.push(entry)
      }
    }
  }
  return fixes
}

/** Merge two arrays of problem-fix lessons deterministically without losing older fixes. */
export function mergeProblemFixes(base = [], incoming = []) {
  const map = new Map()
  for (const item of [...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!item || !item.tool || !item.symptom) continue
    const key = item.fixId || `fix-${sha256Hex(`${String(item.tool).toLowerCase()}::${String(item.symptom).toLowerCase().slice(0, 80)}`).slice(0, 10)}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...item, fixId: key, occurrences: item.occurrences || 1 })
    } else {
      map.set(key, {
        ...prev,
        ...item,
        fixId: key,
        occurrences: (prev.occurrences || 1) + (item.occurrences || 1),
        lastSeenAt: Math.max(prev.lastSeenAt || 0, item.lastSeenAt || 0),
      })
    }
  }
  return [...map.values()].slice(0, 40)
}

/** Determine workflow maturity stage from observation counts. */
export function resolveMaturity({ successes = 0, attempts = 1, crystallize = false, threshold = 3 } = {}) {
  const effectiveThreshold = clampInt(threshold, 1, 10, 3)
  if (crystallize || successes >= effectiveThreshold) return 'crystallized'
  if (attempts >= 2 || successes >= 1) return 'emerging'
  return 'exploring'
}

/** Capture an immutable complete snapshot of one workflow generation so earlier workflows are never forgotten. */
export function buildGenealogySnapshot({
  gen,
  version,
  action,
  reason,
  maturity,
  sourceSessionId,
  optimized,
  problemFixes = [],
  createdAt = Date.now(),
}) {
  const stagesSnapshot = structuredClone(optimized?.stages || [])
  const guardrailsSnapshot = structuredClone(optimized?.guardrails || [])
  const problemFixesSnapshot = structuredClone(problemFixes || [])
  const metrics = structuredClone(optimized?.metrics || {})
  return {
    gen,
    version,
    createdAt,
    action,
    reason: truncateText(reason || '', 220),
    maturity,
    sourceSessionId: sourceSessionId || '',
    metrics,
    stagesSnapshot,
    guardrailsSnapshot,
    problemFixesSnapshot,
    digest: sha256Hex({ gen, version, stagesSnapshot, guardrailsSnapshot }),
  }
}

/** Keep Gen 1 baseline permanently intact and retain recent generations (up to 30 total). */
function appendGenealogy(existingGenealogy = [], snapshot) {
  const list = Array.isArray(existingGenealogy) ? existingGenealogy.map(g => structuredClone(g)) : []
  const next = [...list, snapshot]
  if (next.length <= 30) return next
  return [next[0], ...next.slice(-29)]
}

/** Determine semantic workflow phase for one normalized trace step. */
function inferPhase(step) {
  if (step.role === 'permission' || step.role === 'launch') return 'prepare'
  if (step.kind === 'read') return 'discover'
  if (step.role === 'gui' || step.role === 'web') return 'automate'
  if (step.kind === 'write' || step.kind === 'orchestrate' || step.role === 'spreadsheet' || step.role === 'document') return 'edit'
  if (step.kind === 'exec' || step.role === 'verify') {
    const cmd = String(step.target || '')
    if (/^(?:ls|dir|find|rg|grep|which|where|git\s+(?:status|log|diff))\b/i.test(cmd)) return 'discover'
    return 'verify'
  }
  if (step.role === 'deliver' || step.tool === 'verify_deliverables') return 'deliver'
  return 'edit'
}

/** Decide whether two adjacent steps can safely share a parallel stage. */
function canBatchInParallel(prevStep, nextStep) {
  if (!prevStep || !nextStep) return false
  if (prevStep.phase !== nextStep.phase) return false
  // Reads on any targets (or non-mutating search tools) can run in parallel unless identical.
  if (prevStep.kind === 'read' && nextStep.kind === 'read') return true
  // Independent subagents explicitly targeting different scopes can run concurrently.
  if (prevStep.kind === 'orchestrate' && nextStep.kind === 'orchestrate') {
    return pathKey(prevStep.target) !== pathKey(nextStep.target)
  }
  return false
}

/** Infer reusable parameterized inputs from concrete targets in the session trace. */
function inferWorkflowInputs(trace) {
  const inputs = []
  const seen = new Set()
  const addInput = (key, type, description, example) => {
    if (seen.has(key)) return
    seen.add(key)
    inputs.push({ key, type, description, example })
  }

  if (trace.cwd) {
    addInput('workspaceRoot', 'directory', 'Target workspace directory root', trace.cwd)
  }
  const primaryWritten = trace.touchedFiles.filter(f => f.writes > 0).map(f => f.path)
  if (primaryWritten.length > 0) {
    addInput('targetFiles', 'string[]', 'Primary files created or modified by the workflow', primaryWritten.slice(0, 6))
  } else {
    const primaryRead = trace.touchedFiles.slice(0, 5).map(f => f.path)
    if (primaryRead.length > 0) {
      addInput('targetFiles', 'string[]', 'Primary files inspected by the workflow', primaryRead)
    }
  }
  const passedVerify = trace.verificationCommands.find(v => v.passed)
  if (passedVerify) {
    addInput('verifyCommand', 'command', 'Verification/test command that must pass before delivery', passedVerify.command)
  }
  return inputs
}

/** Compute heuristic efficiency score (0..100) from execution metrics. */
function computeEfficiencyScore({ totalSteps, duplicateCount, unresolvedFailures, retryLoops, parallelGroups, guardrails }) {
  if (totalSteps === 0) return 50
  const dupPenalty = Math.min(30, duplicateCount * 7)
  const retryPenalty = Math.min(25, retryLoops * 8)
  const failPenalty = Math.min(30, unresolvedFailures * 10)
  const parallelBonus = Math.min(14, parallelGroups * 4)
  const guardBonus = Math.min(10, guardrails * 3)
  return clampInt(Math.round(82 - dupPenalty - retryPenalty - failPenalty + parallelBonus + guardBonus), 10, 100, 75)
}

/**
 * Run deterministic multi-pass optimization over raw trace steps:
 *   Pass 1: Duplicate read/search elimination + failed-retry absorption
 *   Pass 2: Dependency-safe parallel stage grouping
 *   Pass 3: Guardrail & precondition synthesis from observed errors
 *   Pass 4: Efficiency score & before/after diff calculation
 */
export function optimizeTraceSteps(trace) {
  const rawSteps = Array.isArray(trace?.steps) ? trace.steps : []
  const cleaned = []
  const seenReadsSinceWrite = new Map() // targetKey -> cleaned step index
  const pendingErrorsByToolTarget = new Map()
  const guardrails = []
  let duplicatesRemoved = 0
  let retriesResolved = 0
  let unresolvedFailures = 0

  for (let i = 0; i < rawSteps.length; i += 1) {
    const step = rawSteps[i]
    const phase = inferPhase(step)
    const targetKey = `${step.tool.toLowerCase()}::${pathKey(step.target || step.signature)}`
    const toolTargetKey = `${step.tool.toLowerCase()}::${pathKey(step.target || '')}`

    // Any write/exec can invalidate cached read knowledge of workspace state
    if (step.kind === 'write' || step.kind === 'exec') {
      if (step.kind === 'write' && step.target) {
        for (const [k] of seenReadsSinceWrite) {
          if (k.endsWith(`::${pathKey(step.target)}`)) seenReadsSinceWrite.delete(k)
        }
      } else if (step.kind === 'exec') {
        seenReadsSinceWrite.clear()
      }
    }

    if (step.isError) {
      // Hold failed step briefly to see if a later step in the same tool/target succeeds
      const list = pendingErrorsByToolTarget.get(toolTargetKey) || []
      list.push(step)
      pendingErrorsByToolTarget.set(toolTargetKey, list)
      continue
    }

    // Deduplicate redundant unchanged reads/searches
    if (step.kind === 'read') {
      const sigKey = step.signature
      if (seenReadsSinceWrite.has(sigKey)) {
        duplicatesRemoved += 1
        continue
      }
      seenReadsSinceWrite.set(sigKey, true)
    }

    // Check if this successful step resolves prior failed retries on the same target/tool
    const priorFails = pendingErrorsByToolTarget.get(toolTargetKey)
    const stepGuards = []
    if (priorFails && priorFails.length > 0) {
      retriesResolved += priorFails.length
      pendingErrorsByToolTarget.delete(toolTargetKey)
      for (const fail of priorFails) {
        const reason = truncateText(fail.errorMessage || 'Previous attempt failed', 180)
        const rule = `避免 ${fail.tool}${fail.target ? ` (${truncateText(fail.target, 60)})` : ''} 重复失败: ${reason}`
        stepGuards.push(rule)
        guardrails.push({
          id: `guard-${guardrails.length + 1}`,
          tool: fail.tool,
          target: fail.target,
          rule,
          sourceSeq: fail.seq,
        })
      }
    }

    cleaned.push({
      id: `step-${cleaned.length + 1}`,
      phase,
      tool: step.tool,
      kind: step.kind,
      target: step.target,
      goal: describeStepIntent(step),
      sourceSeqs: [step.seq],
      guardrails: stepGuards,
      executionMode: 'serial',
    })
  }

  // Remaining errors never followed by a successful fix stay tracked as explicit warnings/guardrails
  for (const [, remainingFails] of pendingErrorsByToolTarget.entries()) {
    for (const fail of remainingFails) {
      unresolvedFailures += 1
      const rule = `前置检查 (${fail.tool}): ${truncateText(fail.errorMessage || '此前执行出错，运行前需确认权限/路径/参数', 180)}`
      guardrails.push({
        id: `guard-${guardrails.length + 1}`,
        tool: fail.tool,
        target: fail.target,
        rule,
        sourceSeq: fail.seq,
        unresolved: true,
      })
    }
  }

  // If deliverables exist cleanly, append explicit final verification/delivery reminder stage if missing
  if ((trace?.deliverables?.length || 0) > 0 && !cleaned.some(s => s.phase === 'deliver')) {
    cleaned.push({
      id: `step-${cleaned.length + 1}`,
      phase: 'deliver',
      tool: 'verify_deliverables',
      kind: 'other',
      target: trace.deliverables.map(d => d.path).slice(0, 3).join(', '),
      goal: `确认最终交付物可读并向用户汇报 (${trace.deliverables.length} 项)`,
      sourceSeqs: trace.deliverables.map(d => d.seq),
      guardrails: ['仅汇报经过实际读取/命令运行验证过的文件路径与测试结果'],
      executionMode: 'serial',
    })
  }

  // Pass 2: Group adjacent non-conflicting steps into parallel stages
  const stages = []
  for (const step of cleaned) {
    const prevStage = stages[stages.length - 1]
    const prevLast = prevStage ? prevStage.steps[prevStage.steps.length - 1] : undefined
    if (prevStage && canBatchInParallel(prevLast, step)) {
      step.executionMode = 'parallel'
      prevLast.executionMode = 'parallel'
      prevStage.executionMode = 'parallel'
      prevStage.steps.push(step)
    } else {
      stages.push({
        stageId: `stage-${stages.length + 1}`,
        phase: step.phase,
        phaseLabel: PHASE_META[step.phase]?.label || step.phase,
        executionMode: 'serial',
        steps: [step],
      })
    }
  }

  const parallelStagesCount = stages.filter(st => st.executionMode === 'parallel' && st.steps.length > 1).length
  const stepsSaved = Math.max(0, rawSteps.length - cleaned.length)
  const rawTurnsEstimate = Math.max(1, rawSteps.length)
  const optTurnsEstimate = Math.max(1, stages.length)
  const estimatedTurnReductionPct = rawSteps.length > 0
    ? Math.max(0, Math.round(((rawTurnsEstimate - optTurnsEstimate) / rawTurnsEstimate) * 100))
    : 0

  const beforeScore = computeEfficiencyScore({
    totalSteps: rawSteps.length,
    duplicateCount: duplicatesRemoved,
    unresolvedFailures: trace?.failures?.length || 0,
    retryLoops: retriesResolved,
    parallelGroups: 0,
    guardrails: 0,
  })
  const afterScore = computeEfficiencyScore({
    totalSteps: cleaned.length,
    duplicateCount: 0,
    unresolvedFailures,
    retryLoops: 0,
    parallelGroups: parallelStagesCount,
    guardrails: guardrails.length,
  })

  const macroStages = buildMacroStages(stages, trace)

  return {
    stages,
    macroStages,
    steps: cleaned,
    guardrails,
    metrics: {
      beforeSteps: rawSteps.length,
      afterSteps: cleaned.length,
      macroSteps: macroStages.length,
      stepsSaved,
      duplicatesRemoved,
      retriesResolved,
      unresolvedFailures,
      parallelStagesCount,
      guardrailsAdded: guardrails.length,
      estimatedTurnReductionPct,
      beforeScore,
      afterScore,
    },
    diff: {
      summary: rawSteps.length === 0
        ? '无工具调用记录，已生成基础模板骨架'
        : `浓缩为 ${macroStages.length} 大核心阶段（原 ${rawSteps.length} 步优化为 ${cleaned.length} 步，消重 ${duplicatesRemoved}，消解重试 ${retriesResolved}）`,
      digest: sha256Hex({ stages, guardrails }),
    },
  }
}

/** Collapse hundreds of noisy low-level UI/tool calls into 3~7 clear human-readable macro stages. */
export function buildMacroStages(stages = [], trace = {}) {
  if (!Array.isArray(stages) || stages.length === 0) return []
  const groups = []
  for (const st of stages) {
    const prev = groups[groups.length - 1]
    if (prev && prev.phase === st.phase) {
      prev.rawStages.push(st)
      prev.steps.push(...(st.steps || []))
    } else {
      groups.push({
        phase: st.phase,
        phaseLabel: PHASE_META[st.phase]?.label || st.phaseLabel || st.phase,
        rawStages: [st],
        steps: [...(st.steps || [])],
      })
    }
  }

  // If interleaved back-and-forth phases exceed 6 macro blocks, collapse repeated middle blocks smoothly
  while (groups.length > 6) {
    let bestIdx = 1
    let minLen = Number.MAX_SAFE_INTEGER
    for (let i = 1; i < groups.length - 1; i += 1) {
      if (groups[i].steps.length < minLen) {
        minLen = groups[i].steps.length
        bestIdx = i
      }
    }
    const absorbed = groups.splice(bestIdx, 1)[0]
    groups[bestIdx - 1].steps.push(...absorbed.steps)
  }

  const friendlyToolName = (tool) => {
    const low = String(tool || '').toLowerCase()
    if (low === 'computer') return '桌面鼠键操作'
    if (low === 'open_application') return '打开桌面应用'
    if (low === 'request_access') return '请求系统授权'
    if (low === 'verify_deliverables') return '交付成果核验'
    if (low.startsWith('excel_')) return 'Excel表格处理'
    if (low.startsWith('office_')) return 'Word文档处理'
    if (low.startsWith('browser_')) return '浏览器网页操作'
    if (['run_command', 'bash', 'powershell', 'pwsh'].includes(low)) return '命令/脚本执行'
    if (['read_file', 'view_file', 'read', 'grep', 'glob'].includes(low)) return '读取/检索文件'
    if (['write_file', 'edit_file', 'edit', 'write'].includes(low)) return '编写/修改文件'
    return tool
  }

  return groups.map((g, idx) => {
    const tools = [...new Set(g.steps.map(s => s.tool).filter(Boolean))]
    const friendlyTools = [...new Set(tools.map(friendlyToolName))].slice(0, 3)
    const sampleTargets = [...new Set(
      g.steps
        .map(s => s.target ? basename(String(s.target)) : '')
        .filter(t => t && !/^(left_click|right_click|move|type|screenshot|wait)$/i.test(t)),
    )].slice(0, 2)
    const count = g.steps.length
    const hasParallel = g.rawStages.some(rs => rs.executionMode === 'parallel' && (rs.steps?.length || 0) > 1)
    let summary = `${friendlyTools.join(' + ') || g.phaseLabel}`
    if (sampleTargets.length > 0) summary += `（涉及 ${sampleTargets.join('、')}）`
    if (count > 3) summary += ` · 已自动合并 ${count} 次连续操作`
    else if (count > 1) summary += ` · 共 ${count} 项操作`
    if (hasParallel) summary += ' · 支持并行加速'
    if (g.phase === 'deliver' && (trace?.deliverables?.length || 0) > 0) {
      const files = trace.deliverables.map(d => basename(d.path || '')).filter(Boolean).slice(0, 2)
      if (files.length > 0) summary = `整理并检查输出成果：${files.join('、')}`
    }
    return {
      stepNo: idx + 1,
      phase: g.phase,
      title: g.phaseLabel,
      summary,
      tools,
      friendlyTools,
      rawActions: count,
      sampleTargets,
      parallel: hasParallel,
    }
  })
}

/** Generate human-clear step intent description from a trace step. */
function describeStepIntent(step) {
  const targetShort = step.target ? truncateText(step.target, 72) : ''
  if (step.role === 'permission') return `请求操作权限${targetShort ? ` (${targetShort})` : ''}`
  if (step.role === 'launch') return `启动应用${targetShort ? ` ${targetShort}` : ''}`
  if (step.role === 'gui') return `桌面操作${targetShort ? ` (${targetShort})` : ''}`
  if (step.role === 'spreadsheet') return `处理表格${targetShort ? ` (${basename(targetShort)})` : ''}`
  if (step.role === 'document') return `处理文档${targetShort ? ` (${basename(targetShort)})` : ''}`
  if (step.role === 'web') return `网页访问/抓取${targetShort ? ` (${targetShort})` : ''}`
  if (step.kind === 'read') return targetShort ? `读取/检索 \`${basename(targetShort) || targetShort}\`` : `读取上下文`
  if (step.kind === 'write') return targetShort ? `写入/修改 \`${basename(targetShort) || targetShort}\`` : `写入文件`
  if (step.kind === 'exec') return targetShort ? `运行命令 \`${targetShort}\`` : `执行脚本`
  if (step.kind === 'orchestrate') return `委派子代理 (${step.tool})${targetShort ? `: ${targetShort}` : ''}`
  return `调用 ${step.tool}${targetShort ? `: ${targetShort}` : ''}`
}

/** Render reusable SKILL.md compatible with DSH `ctx.skills`. */
export function renderSkillMarkdown(workflow) {
  const opt = workflow.optimized || { stages: [], guardrails: [], metrics: {} }
  const lines = [
    '---',
    `name: ${workflow.name}`,
    `description: ${truncateText(workflow.description || workflow.title, 180)}`,
    '---',
    '',
    `# ${workflow.title}`,
    '',
    `- 工作流 ID: \`${workflow.workflowId}\` (v${workflow.version})`,
    `- 效率提升: 评分 ${opt.metrics?.beforeScore ?? '-'} → ${opt.metrics?.afterScore ?? '-'} (${opt.diff?.summary || ''})`,
    '',
  ]

  if (Array.isArray(workflow.inputs) && workflow.inputs.length > 0) {
    lines.push('## 输入参数 (Parameters)', '')
    for (const inp of workflow.inputs) {
      lines.push(`- \`${inp.key}\` (${inp.type}): ${inp.description}`)
    }
    lines.push('')
  }

  lines.push('## 优化执行步骤 (Optimized Execution Stages)', '')
  for (const stage of opt.stages || []) {
    const modeTag = stage.executionMode === 'parallel' && stage.steps.length > 1
      ? ` ⚡ [并行批次 · ${stage.steps.length} 步同发]`
      : ' → [顺序执行]'
    lines.push(`### ${stage.stageId}: ${stage.phaseLabel}${modeTag}`, '')
    for (const st of stage.steps || []) {
      lines.push(`1. **${st.tool}** — ${st.goal}`)
      for (const g of st.guardrails || []) {
        lines.push(`   - [护栏] ${g}`)
      }
    }
    lines.push('')
  }

  if (Array.isArray(opt.guardrails) && opt.guardrails.length > 0) {
    lines.push('## 防呆护栏与避坑清单 (Guardrails)', '')
    for (const g of opt.guardrails) {
      lines.push(`- ${g.rule}`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/** Render an executable DSH native PTC (`agent`/`parallel`/`phase`/`log`) JavaScript template matching the optimized DAG & genealogy fallback. */
export function renderWorkflowScript(workflow) {
  const opt = workflow.optimized || { stages: [], guardrails: [], metrics: {} }
  const firstGen = Array.isArray(workflow.genealogy) && workflow.genealogy.length > 0 ? workflow.genealogy[0] : null
  const lines = [
    `// Generated by dsh-flowpack v2.0.0 — Experience Workflow "${workflow.title}" (${workflow.workflowId} v${workflow.version}, maturity=${workflow.maturity || 'exploring'})`,
    `// Runs inside DSH native PTC workflow runtime (globals: agent, parallel, pipeline, phase, log)`,
    `// Metrics: steps ${opt.metrics?.beforeSteps ?? 0} -> ${opt.metrics?.afterSteps ?? 0}, parallel groups: ${opt.metrics?.parallelStagesCount ?? 0}, score: ${opt.metrics?.afterScore ?? '-'}`,
  ]
  if (firstGen) {
    lines.push(`// Genealogy: Gen 1 baseline retained (${firstGen.metrics?.afterSteps ?? '-'} steps, "${truncateText(firstGen.reason || 'baseline exploration', 80)}") — ${workflow.genealogy.length} generation(s) stored`)
  }
  lines.push('')
  lines.push(`log(${JSON.stringify(`[FlowPack] Start workflow "${workflow.title}" (v${workflow.version})`)})`)
  lines.push('')

  for (const stage of opt.stages || []) {
    lines.push(`await phase(${JSON.stringify(stage.stageId)}, async () => {`)
    const formatTask = (st) => {
      const guards = (st.guardrails || []).map(g => `- 避坑护栏: ${g}`).join('\n')
      return `使用工具 ${st.tool}${st.target ? ` 操作 ${st.target}` : ''} 完成：${st.goal}${guards ? `\n${guards}` : ''}`
    }
    if (stage.executionMode === 'parallel' && stage.steps.length > 1) {
      lines.push('  await parallel([')
      for (const st of stage.steps) {
        lines.push(`    () => agent({ role: ${JSON.stringify(`worker-${st.tool}`)}, task: ${JSON.stringify(formatTask(st))} }),`)
      }
      lines.push('  ])')
    } else {
      for (const st of stage.steps || []) {
        lines.push(`  // ${st.goal}`)
        for (const g of st.guardrails || []) {
          lines.push(`  // GUARDRAIL: ${g}`)
        }
        lines.push(`  await agent({ role: ${JSON.stringify(`step-${st.tool}`)}, task: ${JSON.stringify(formatTask(st))} })`)
      }
    }
    lines.push('})')
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Build a complete `WorkflowRecord` from a normalized DSH session trace with progressive learning & non-forgetting genealogy. */
export function distillWorkflowFromTrace(trace, options = {}) {
  const now = Date.now()
  const title = smartDistillTitle(trace, options.title)
  const slug = slugifyId(options.name || title, `workflow-${slugifyId(trace.sessionId, 'run').slice(0, 12)}`)
  const existing = options.existingWorkflow
  const workflowId = existing?.workflowId || options.workflowId || `wf-${slug}-${sha256Hex(trace.sessionId).slice(0, 6)}`

  const freshOptimized = optimizeTraceSteps(trace)
  const traceProblemFixes = extractProblemFixes(trace)
  const mergedProblemFixes = mergeProblemFixes(existing?.observations?.problemFixes || [], traceProblemFixes)
  const inputs = inferWorkflowInputs(trace)
  const family = computeTaskFingerprint(trace)

  const prevAttempts = existing?.observations?.attempts || 0
  const prevSuccesses = existing?.observations?.successes || 0
  const runSucceeded = (trace.verificationCommands || []).some(v => v.passed)
    || ((trace.failures?.length || 0) === 0 && (trace.steps?.length || 0) > 0)
    || ((trace.deliverables?.length || 0) > 0 && freshOptimized.metrics.unresolvedFailures === 0)
  const attempts = existing ? prevAttempts + 1 : 1
  const successes = existing ? prevSuccesses + (runSucceeded ? 1 : 0) : (runSucceeded ? 1 : 0)
  const threshold = clampInt(options.crystallizeThreshold, 1, 10, existing?.observations?.crystallizeThreshold || 3)
  const maturity = resolveMaturity({
    successes,
    attempts,
    crystallize: Boolean(options.crystallize) || existing?.maturity === 'crystallized',
    threshold,
  })

  // Keep already-cleaner optimized stages if this new run had unresolved noise, while still absorbing newly discovered guardrails/problemFixes
  const existingScore = existing?.optimized?.metrics?.afterScore ?? -1
  const useFreshDag = !existing
    || options.forceReplaceStages === true
    || freshOptimized.metrics.afterScore >= existingScore
    || freshOptimized.metrics.afterSteps <= (existing?.optimized?.metrics?.afterSteps ?? Number.MAX_SAFE_INTEGER)

  let chosenOptimized = freshOptimized
  if (!useFreshDag && existing?.optimized) {
    const existingGuardRules = new Set((existing.optimized.guardrails || []).map(g => g.rule))
    const mergedGuardrails = [...(existing.optimized.guardrails || []).map(g => ({ ...g }))]
    for (const g of freshOptimized.guardrails || []) {
      if (!existingGuardRules.has(g.rule)) {
        existingGuardRules.add(g.rule)
        mergedGuardrails.push({ ...g, id: `guard-${mergedGuardrails.length + 1}` })
      }
    }
    chosenOptimized = {
      ...structuredClone(existing.optimized),
      guardrails: mergedGuardrails,
      metrics: {
        ...existing.optimized.metrics,
        guardrailsAdded: mergedGuardrails.length,
      },
      diff: {
        summary: `融合新会话经验（保留历史更优步骤 ${existing.optimized.metrics.afterSteps} 步，新增防坑护栏 ${mergedGuardrails.length - (existing.optimized.guardrails?.length || 0)} 条）`,
        digest: sha256Hex({ stages: existing.optimized.stages, guardrails: mergedGuardrails }),
      },
    }
  }

  const nextVersion = existing ? (existing.version || 1) + 1 : 1
  const prevGenealogy = Array.isArray(existing?.genealogy) && existing.genealogy.length > 0
    ? existing.genealogy
    : (existing ? [buildGenealogySnapshot({
      gen: 1,
      version: existing.version || 1,
      action: 'distill',
      reason: '初次探索基线快照（历史兼容自动补建）',
      maturity: existing.maturity || 'exploring',
      sourceSessionId: existing.sourceSessionIds?.[0] || '',
      optimized: existing.optimized,
      problemFixes: existing.observations?.problemFixes || [],
      createdAt: existing.createdAt || now,
    })] : [])
  const nextGen = prevGenealogy.length > 0 ? prevGenealogy[prevGenealogy.length - 1].gen + 1 : 1
  const genReason = existing
    ? `第 ${attempts} 次执行沉淀 (${runSucceeded ? '成功' : '含试错修复'}): ${chosenOptimized.diff.summary}`
    : `初次摸索基线 (${trace.steps.length} 步原始探索 → ${chosenOptimized.steps.length} 步): ${chosenOptimized.diff.summary}`

  const genealogy = appendGenealogy(prevGenealogy, buildGenealogySnapshot({
    gen: nextGen,
    version: nextVersion,
    action: existing ? 'consolidate' : 'distill',
    reason: genReason,
    maturity,
    sourceSessionId: trace.sessionId,
    optimized: chosenOptimized,
    problemFixes: mergedProblemFixes,
    createdAt: now,
  }))

  const macroLen = chosenOptimized.macroStages?.length || chosenOptimized.stages?.length || 1
  const description = truncateText(
    options.description
    || `共提炼为 ${macroLen} 大关键步骤，记录 ${mergedProblemFixes.length} 条避坑解法（原始 ${trace.steps.length} 次操作）`,
    180,
  )

  const cleanExistingTitle = existing?.title && !isSystemNoiseMessage(existing.title) ? existing.title : ''
  const rawRecord = {
    schemaVersion: '2.0.0',
    workflowId,
    name: existing?.name || slug,
    title: options.title ? title : (cleanExistingTitle || title),
    description,
    version: nextVersion,
    maturity,
    family,
    observations: {
      attempts,
      successes,
      failures: (existing?.observations?.failures || 0) + (runSucceeded ? 0 : 1),
      crystallizeThreshold: threshold,
      bestScore: Math.max(existing?.observations?.bestScore || 0, chosenOptimized.metrics.afterScore || 0),
      lastOutcome: runSucceeded ? 'success' : 'recovered-or-partial',
      lastSessionId: trace.sessionId,
      problemFixes: mergedProblemFixes,
    },
    workspaceRoot: normalizeWorkspaceRoot(trace.cwd || existing?.workspaceRoot || ''),
    sourceSessionIds: [...new Set([...(existing?.sourceSessionIds || []), trace.sessionId])],
    promotedAsSkill: typeof options.promote === 'boolean' ? options.promote : Boolean(existing?.promotedAsSkill),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    inputs,
    rawStats: {
      turns: trace.turns,
      eventCount: trace.eventCount,
      totalCalls: trace.steps.length,
      failedCalls: trace.failures.length,
      compactionCount: trace.compactionCount,
      deliverablesCount: trace.deliverables.length,
    },
    optimized: chosenOptimized,
    genealogy,
    revisions: [
      ...(Array.isArray(existing?.revisions) ? existing.revisions : []).slice(-19),
      {
        version: nextVersion,
        gen: nextGen,
        updatedAt: now,
        action: existing ? 'consolidate' : 'distill',
        maturity,
        sourceSessionId: trace.sessionId,
        beforeSteps: chosenOptimized.metrics.beforeSteps,
        afterSteps: chosenOptimized.metrics.afterSteps,
        beforeScore: chosenOptimized.metrics.beforeScore,
        afterScore: chosenOptimized.metrics.afterScore,
        parallelStagesCount: chosenOptimized.metrics.parallelStagesCount,
        guardrailsAdded: chosenOptimized.metrics.guardrailsAdded,
        summary: chosenOptimized.diff.summary,
        digest: chosenOptimized.diff.digest,
      },
    ],
  }

  rawRecord.artifacts = {
    skillMarkdown: renderSkillMarkdown(rawRecord),
    workflowScript: renderWorkflowScript(rawRecord),
  }
  return rawRecord
}

/** Apply an extra manual/rule-based refinement pass onto an already saved workflow. */
export function applyOptimizationPass(workflow, options = {}) {
  const now = Date.now()
  const nextVersion = (workflow.version || 1) + 1
  const currentSteps = Array.isArray(workflow.optimized?.steps) ? workflow.optimized.steps.map(s => ({ ...s, guardrails: [...(s.guardrails || [])] })) : []
  const currentGuardrails = Array.isArray(workflow.optimized?.guardrails) ? workflow.optimized.guardrails.map(g => ({ ...g })) : []

  // Additional user guardrails or verification requirement injection
  if (typeof options.addGuardrail === 'string' && options.addGuardrail.trim().length > 0) {
    const rule = truncateText(options.addGuardrail, 220)
    currentGuardrails.push({
      id: `guard-${currentGuardrails.length + 1}`,
      tool: 'policy',
      target: '',
      rule,
      manual: true,
    })
  }

  // Merge consecutive duplicate step goals/tools even across non-adjacent reads when requested
  const merged = []
  const seenKeys = new Set()
  let extraMerged = 0
  for (const st of currentSteps) {
    const key = `${st.tool}::${pathKey(st.target || st.goal)}`
    if (st.kind === 'read' && seenKeys.has(key)) {
      extraMerged += 1
      continue
    }
    if (st.kind === 'read') seenKeys.add(key)
    merged.push(st)
  }

  // Re-group parallel stages cleanly
  const stages = []
  for (const st of merged) {
    const stepCopy = { ...st, executionMode: 'serial' }
    const prevStage = stages[stages.length - 1]
    const prevLast = prevStage ? prevStage.steps[prevStage.steps.length - 1] : undefined
    if (prevStage && canBatchInParallel(prevLast, stepCopy)) {
      stepCopy.executionMode = 'parallel'
      prevLast.executionMode = 'parallel'
      prevStage.executionMode = 'parallel'
      prevStage.steps.push(stepCopy)
    } else {
      stages.push({
        stageId: `stage-${stages.length + 1}`,
        phase: stepCopy.phase,
        phaseLabel: PHASE_META[stepCopy.phase]?.label || stepCopy.phase,
        executionMode: 'serial',
        steps: [stepCopy],
      })
    }
  }

  const prevMetrics = workflow.optimized?.metrics || {}
  const parallelStagesCount = stages.filter(s => s.executionMode === 'parallel' && s.steps.length > 1).length
  const beforeSteps = prevMetrics.beforeSteps ?? currentSteps.length
  const afterSteps = merged.length
  const afterScore = computeEfficiencyScore({
    totalSteps: afterSteps,
    duplicateCount: 0,
    unresolvedFailures: prevMetrics.unresolvedFailures || 0,
    retryLoops: 0,
    parallelGroups: parallelStagesCount,
    guardrails: currentGuardrails.length,
  })
  const summary = `二次精炼：步骤 ${currentSteps.length} → ${afterSteps}（再消重 ${extraMerged}），并行 ${parallelStagesCount} 组，护栏 ${currentGuardrails.length} 条，评分 ${prevMetrics.afterScore ?? 0} → ${afterScore}`
  const nextOpt = {
    stages,
    steps: merged,
    guardrails: currentGuardrails,
    metrics: {
      ...prevMetrics,
      beforeSteps,
      afterSteps,
      stepsSaved: Math.max(0, beforeSteps - afterSteps),
      parallelStagesCount,
      guardrailsAdded: currentGuardrails.length,
      afterScore,
      estimatedTurnReductionPct: beforeSteps > 0 ? Math.max(0, Math.round(((beforeSteps - stages.length) / beforeSteps) * 100)) : 0,
    },
    diff: {
      summary,
      digest: sha256Hex({ stages, guardrails: currentGuardrails }),
    },
  }
  const prevGenealogy = Array.isArray(workflow.genealogy) ? workflow.genealogy : []
  const nextGen = prevGenealogy.length > 0 ? prevGenealogy[prevGenealogy.length - 1].gen + 1 : nextVersion
  const nextMaturity = options.crystallize ? 'crystallized' : (workflow.maturity || 'exploring')

  const next = {
    ...workflow,
    schemaVersion: '2.0.0',
    version: nextVersion,
    maturity: nextMaturity,
    updatedAt: now,
    ...(typeof options.title === 'string' && options.title.trim() ? { title: truncateText(options.title, 72) } : {}),
    ...(typeof options.promote === 'boolean' ? { promotedAsSkill: options.promote } : {}),
    optimized: nextOpt,
    genealogy: appendGenealogy(prevGenealogy, buildGenealogySnapshot({
      gen: nextGen,
      version: nextVersion,
      action: options.action || 'optimize',
      reason: options.reason || summary,
      maturity: nextMaturity,
      sourceSessionId: options.sourceSessionId || workflow.observations?.lastSessionId || '',
      optimized: nextOpt,
      problemFixes: workflow.observations?.problemFixes || [],
      createdAt: now,
    })),
    revisions: [
      ...(Array.isArray(workflow.revisions) ? workflow.revisions : []).slice(-19),
      {
        version: nextVersion,
        gen: nextGen,
        updatedAt: now,
        action: options.action || 'optimize',
        maturity: nextMaturity,
        beforeSteps: currentSteps.length,
        afterSteps,
        beforeScore: prevMetrics.afterScore ?? 0,
        afterScore,
        parallelStagesCount,
        guardrailsAdded: currentGuardrails.length,
        summary,
        digest: sha256Hex({ stages, guardrails: currentGuardrails }),
      },
    ],
  }
  next.artifacts = {
    skillMarkdown: renderSkillMarkdown(next),
    workflowScript: renderWorkflowScript(next),
  }
  return next
}

/**
 * Restore an earlier workflow generation ("不遗忘改善前的工作流") forward as a new immutable version,
 * keeping BOTH the newer experimental generation and the restored baseline preserved in `genealogy`.
 */
export function restoreWorkflowGeneration(workflow, targetGen) {
  const genealogy = Array.isArray(workflow?.genealogy) ? workflow.genealogy : []
  const found = genealogy.find(g => g.gen === Number(targetGen) || g.version === Number(targetGen))
  if (!found) {
    throw new Error(`Generation "${targetGen}" was not found in workflow "${workflow?.workflowId || 'unknown'}".`)
  }
  const now = Date.now()
  const nextVersion = (workflow.version || 1) + 1
  const nextGen = (genealogy[genealogy.length - 1]?.gen || nextVersion - 1) + 1
  const restoredStages = structuredClone(found.stagesSnapshot || [])
  const restoredSteps = restoredStages.flatMap(st => st.steps || [])
  const restoredGuardrails = structuredClone(found.guardrailsSnapshot || [])
  const nextOpt = {
    stages: restoredStages,
    steps: restoredSteps,
    guardrails: restoredGuardrails,
    metrics: {
      ...(found.metrics || {}),
      afterSteps: restoredSteps.length,
    },
    diff: {
      summary: `回溯恢复至第 ${found.gen} 代工作流 (${found.action}: ${found.reason}) — 原后续改良代次仍完整保留在谱系中`,
      digest: sha256Hex({ stages: restoredStages, guardrails: restoredGuardrails }),
    },
  }
  const next = {
    ...workflow,
    version: nextVersion,
    updatedAt: now,
    optimized: nextOpt,
    genealogy: appendGenealogy(genealogy, buildGenealogySnapshot({
      gen: nextGen,
      version: nextVersion,
      action: 'restore-generation',
      reason: `回溯并复用 Gen ${found.gen}（不丢弃后续进化记录）`,
      maturity: workflow.maturity || 'emerging',
      sourceSessionId: found.sourceSessionId || '',
      optimized: nextOpt,
      problemFixes: workflow.observations?.problemFixes || found.problemFixesSnapshot || [],
      createdAt: now,
    })),
    revisions: [
      ...(Array.isArray(workflow.revisions) ? workflow.revisions : []).slice(-19),
      {
        version: nextVersion,
        gen: nextGen,
        updatedAt: now,
        action: 'restore-generation',
        beforeSteps: workflow.optimized?.steps?.length ?? 0,
        afterSteps: restoredSteps.length,
        beforeScore: workflow.optimized?.metrics?.afterScore ?? 0,
        afterScore: nextOpt.metrics?.afterScore ?? 0,
        parallelStagesCount: restoredStages.filter(s => s.executionMode === 'parallel' && s.steps.length > 1).length,
        guardrailsAdded: restoredGuardrails.length,
        summary: nextOpt.diff.summary,
        digest: nextOpt.diff.digest,
      },
    ],
  }
  next.artifacts = {
    skillMarkdown: renderSkillMarkdown(next),
    workflowScript: renderWorkflowScript(next),
  }
  return next
}

/** Build a compact timeline summary of all remembered generations of a workflow. */
export function summarizeGenealogy(workflow) {
  const list = Array.isArray(workflow?.genealogy) ? workflow.genealogy : []
  return list.map(g => ({
    gen: g.gen,
    version: g.version,
    action: g.action,
    maturity: g.maturity,
    reason: g.reason,
    createdAt: g.createdAt,
    sourceSessionId: g.sourceSessionId,
    steps: g.metrics?.afterSteps ?? (g.stagesSnapshot || []).reduce((acc, s) => acc + (s.steps?.length || 0), 0),
    score: g.metrics?.afterScore ?? 0,
    guardrails: (g.guardrailsSnapshot || []).length,
    fixesCount: (g.problemFixesSnapshot || []).length,
    digest: g.digest,
  }))
}

/** Compare two workflow versions/revisions cleanly. */
export function diffWorkflow(workflow, fromVersion, toVersion) {
  const revisions = Array.isArray(workflow?.revisions) ? workflow.revisions : []
  const fromRev = fromVersion ? revisions.find(r => r.version === Number(fromVersion)) : revisions[Math.max(0, revisions.length - 2)]
  const toRev = toVersion ? revisions.find(r => r.version === Number(toVersion)) : revisions[revisions.length - 1]
  return {
    workflowId: workflow.workflowId,
    name: workflow.name,
    currentVersion: workflow.version,
    from: fromRev || null,
    to: toRev || null,
    baselineVsCurrent: {
      beforeSteps: workflow.optimized?.metrics?.beforeSteps ?? 0,
      afterSteps: workflow.optimized?.metrics?.afterSteps ?? 0,
      stepsSaved: workflow.optimized?.metrics?.stepsSaved ?? 0,
      beforeScore: workflow.optimized?.metrics?.beforeScore ?? 0,
      afterScore: workflow.optimized?.metrics?.afterScore ?? 0,
      parallelStagesCount: workflow.optimized?.metrics?.parallelStagesCount ?? 0,
      guardrailsAdded: workflow.optimized?.metrics?.guardrailsAdded ?? 0,
      summary: workflow.optimized?.diff?.summary || '',
    },
  }
}

/** High-level Workflow service coordinating trace reading, persistence, and live DSH Skill sync. */
export class WorkflowService {
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    this.skillDisposers = new Map()
  }

  /** Sync promoted workflows into optional `ctx.skills` runtime registry without blocking if absent. */
  async syncRuntimeSkills() {
    const skills = this.ctx.get?.('skills')
    if (!skills || typeof skills.register !== 'function') return { synced: 0, available: false }
    // Unregister previous runtime contributions cleanly before re-applying current promoted set
    for (const dispose of this.skillDisposers.values()) {
      try { dispose() } catch { /* ignore */ }
    }
    this.skillDisposers.clear()

    const workflows = await this.store.listWorkflows()
    let synced = 0
    for (const wf of workflows) {
      if (!wf.promotedAsSkill) continue
      try {
        const content = wf.artifacts?.skillMarkdown || renderSkillMarkdown(wf)
        const dispose = skills.register({
          name: wf.name,
          description: truncateText(wf.description || wf.title, 200),
          whenToUse: `适用于类似“${truncateText(wf.title, 60)}”的任务；复用已优化步骤并避开历史失败路径`,
          source: 'runtime',
          content,
          metadata: {
            workflowId: wf.workflowId,
            version: wf.version,
            workspaceRoot: wf.workspaceRoot || undefined,
          },
        })
        this.skillDisposers.set(wf.workflowId, dispose)
        synced += 1
      } catch {
        // Ignore duplicate name collisions with higher-priority project/user skills gracefully
      }
    }
    return { synced, available: true }
  }

  dispose() {
    for (const dispose of this.skillDisposers.values()) {
      try { dispose() } catch { /* ignore */ }
    }
    this.skillDisposers.clear()
  }

  /** Read available sessions through sessionQuery. */
  async listSessions({ limit = 30, signal } = {}) {
    return listSessionsWithTitles(this.ctx.get?.('sessionQuery'), { limit, signal })
  }

  /** Distill + optimize a workflow directly from a session log. */
  async distillFromSession({ sessionId, title, name, workflowId, promote, crystallize, crystallizeThreshold, signal } = {}) {
    const sq = this.ctx.get?.('sessionQuery')
    const snapshot = await readSessionSnapshot(sq, sessionId, signal)
    const trace = normalizeSessionTrace(snapshot, { sessionId, title })
    let existingWorkflow = workflowId ? await this.store.readWorkflow(workflowId) : undefined
    if (!existingWorkflow) {
      const prefs = await this.store.readPreferences()
      const fp = computeTaskFingerprint(trace)
      const all = await this.store.listWorkflows()
      const matched = all
        .map(w => ({ w, score: scoreFingerprintSimilarity(fp, w) }))
        .filter(x => x.score >= 0.72)
        .sort((a, b) => b.score - a.score)[0]
      if (matched) existingWorkflow = matched.w
      if (crystallizeThreshold === undefined) crystallizeThreshold = prefs.crystallizeThreshold
    }
    const workflow = distillWorkflowFromTrace(trace, {
      title,
      name,
      workflowId,
      promote,
      crystallize,
      crystallizeThreshold,
      existingWorkflow,
    })
    await this.store.saveWorkflow(workflow)
    await this.store.recordAudit({
      kind: 'workflow-distill',
      workflowId: workflow.workflowId,
      sessionId,
      version: workflow.version,
      maturity: workflow.maturity,
      summary: workflow.optimized.diff.summary,
    })
    if (workflow.promotedAsSkill) await this.syncRuntimeSkills()
    return { workflow, traceStats: workflow.rawStats, trace }
  }

  /** Restore an earlier generation cleanly while preserving later generations in genealogy. */
  async restoreGeneration({ workflowId, gen } = {}) {
    const existing = await this.store.readWorkflow(workflowId)
    if (!existing) throw new Error(`Workflow "${workflowId}" was not found.`)
    const restored = restoreWorkflowGeneration(existing, gen)
    await this.store.saveWorkflow(restored)
    await this.store.recordAudit({
      kind: 'workflow-restore-gen',
      workflowId: restored.workflowId,
      restoredFromGen: gen,
      version: restored.version,
    })
    await this.syncRuntimeSkills()
    return restored
  }

  /** Optimize or update promotion status of an existing workflow. */
  async optimizeWorkflow({ workflowId, addGuardrail, title, promote } = {}) {
    const existing = await this.store.readWorkflow(workflowId)
    if (!existing) throw new Error(`Workflow "${workflowId}" was not found.`)
    const updated = applyOptimizationPass(existing, { addGuardrail, title, promote })
    await this.store.saveWorkflow(updated)
    await this.store.recordAudit({
      kind: 'workflow-optimize',
      workflowId: updated.workflowId,
      version: updated.version,
      summary: updated.optimized.diff.summary,
    })
    await this.syncRuntimeSkills()
    return updated
  }

  /** Toggle whether an optimized workflow is published to DSH's runtime `ctx.skills` catalog. */
  async setPromoted(workflowId, promote) {
    const existing = await this.store.readWorkflow(workflowId)
    if (!existing) throw new Error(`Workflow "${workflowId}" was not found.`)
    const updated = { ...existing, promotedAsSkill: Boolean(promote), updatedAt: Date.now() }
    await this.store.saveWorkflow(updated)
    await this.syncRuntimeSkills()
    return updated
  }

  async deleteWorkflow(workflowId) {
    const removed = await this.store.deleteWorkflow(workflowId)
    await this.syncRuntimeSkills()
    return removed
  }
}
