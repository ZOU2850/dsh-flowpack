/**
 * Runtime Self-Correction & Self-Healing Engine + Cross-Plugin Capability Discovery (`dsh-flowpack` v2.0).
 *
 * 1. Discovers live tools registered across installed DSH plugins (`office_*`, `excel_*`,
 *    `computer*`, `codebuddy_*`, `file_launcher*`, etc.) via `ctx.tools.definitions()`.
 * 2. Hooks `tools/post-execute` cleanly (fail-open, matching DSH's waterfall contract)
 *    to match runtime tool errors & repeated failures against active Experience Capsules'
 *    `selfHealing.rules` and non-forgetting prior-generation fallbacks (`genealogy`),
 *    injecting concise corrective guidance via `additionalContexts`.
 * 3. Tracks mid-turn "error -> recovery" pairs so active Capsules automatically absorb
 *    newly solved problems and keep improving without forgetting baseline workflows.
 */

import { randomUUID } from 'node:crypto'
import { resolveActiveCapsules } from './capsule.js'
import { extractToolTarget } from './session-trace.js'
import { extractTextBlocks } from './session-trace.js'
import { clampInt, pathKey, truncateText } from './util.js'

const SELF_HEAL_SOURCE = Object.freeze({ kind: 'flowpack-self-heal' })

const PLUGIN_GROUPS = [
  { id: 'office', label: '文档/表格/演示自动化 (@copylee/dsh-office)', match: (n) => /^office_/i.test(n) },
  { id: 'excel', label: 'Excel 表格读写 (dsh-office-tools)', match: (n) => /^excel_/i.test(n) },
  { id: 'gui', label: '桌面视觉/键鼠自动化 (@copylee/dsh-computer-use)', match: (n) => /^(computer|computer_batch|open_application|windows|ui_elements|clipboard|switch_display|request_access|app_skill|list_granted_applications)$/i.test(n) },
  { id: 'workbuddy', label: 'WorkBuddy 协作联动 (dsh-connect-workbuddy)', match: (n) => /^codebuddy_/i.test(n) },
  { id: 'fileLauncher', label: '文件快捷启动器 (dsh-file-launcher)', match: (n) => /^file_launcher/i.test(n) },
  { id: 'flowpack', label: 'FlowPack 工作流与经验胶囊 (dsh-flowpack)', match: (n) => /^flowpack_/i.test(n) },
]

/** Inspect currently registered DSH runtime tools grouped by installed plugin family (fail-open). */
export function discoverPluginCapabilities(ctx) {
  const toolsSvc = ctx?.get?.('tools')
  const defs = typeof toolsSvc?.definitions === 'function' ? toolsSvc.definitions() : []
  const tools = []
  const groups = new Map()

  for (const def of Array.isArray(defs) ? defs : []) {
    if (!def || typeof def.name !== 'string') continue
    const pluginMatch = PLUGIN_GROUPS.find(g => g.match(def.name))
    const groupId = pluginMatch ? pluginMatch.id : 'core'
    const groupLabel = pluginMatch ? pluginMatch.label : '核心内建 / MCP 工具'
    tools.push({
      name: def.name,
      groupId,
      groupLabel,
      description: truncateText(def.description || '', 120),
    })
    if (!groups.has(groupId)) {
      groups.set(groupId, { id: groupId, label: groupLabel, tools: [] })
    }
    groups.get(groupId).tools.push(def.name)
  }

  return {
    available: Boolean(toolsSvc && typeof toolsSvc.definitions === 'function'),
    totalTools: tools.length,
    groups: [...groups.values()],
    tools,
  }
}

/** Extract normalized error string from a DSH `ToolExecutionResult`. */
function extractResultErrorText(result) {
  if (!result || result.isError !== true) return ''
  const fromErr = typeof result.error?.message === 'string' ? result.error.message : ''
  const fromContent = extractTextBlocks(result.content)
  return truncateText(fromErr || fromContent || 'Tool execution failed', 260)
}

/** Compute token overlap match score between an error event and a capsule self-healing rule. */
function scoreRuleMatch(rule, toolName, errorText, target) {
  let score = 0
  const rTool = String(rule.tool || '*').toLowerCase()
  const tName = String(toolName || '').toLowerCase()
  if (rTool === tName) score += 0.45
  else if (rTool === '*') score += 0.15
  else return 0

  const errLower = String(errorText || '').toLowerCase()
  const patLower = String(rule.symptomPattern || '').toLowerCase()
  if (patLower && errLower.includes(patLower)) score += 0.55
  else if (patLower) {
    const tokens = patLower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(x => x.length >= 3)
    if (tokens.length > 0) {
      let hits = 0
      for (const tok of tokens) if (errLower.includes(tok)) hits += 1
      score += (hits / tokens.length) * 0.45
    }
  }
  if (rule.targetHint && target && pathKey(target).includes(pathKey(rule.targetHint))) {
    score += 0.1
  }
  return score
}

/** Construct a DSH `UserMessage` compatible with `tools/post-execute` `additionalContexts`. */
function createSelfHealMessage(text, summary) {
  const safeSummary = truncateText(summary, 118)
  const msg = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      ...SELF_HEAL_SOURCE,
      form: 'notice',
      summary: safeSummary,
    },
  }
  return Object.freeze(msg)
}

/**
 * Runtime self-correction & recovery tracker wired onto DSH's `tools/post-execute` waterfall.
 */
export class SelfHealingEngine {
  constructor({ store, getSnapshot, onLearnedFix }) {
    this.store = store
    this.getSnapshot = getSnapshot
    this.onLearnedFix = onLearnedFix
    this.errorCountsByAgent = new WeakMap()
    this.pendingErrorsBySession = new Map() // sessionId -> Map<toolLower, { tool, target, symptom, at }>
    this.recentEvents = []
  }

  recordEvent(evt) {
    this.recentEvents.unshift({
      id: randomUUID().slice(0, 10),
      at: Date.now(),
      ...evt,
    })
    if (this.recentEvents.length > 40) this.recentEvents.length = 40
  }

  getRecentEvents(limit = 20) {
    return this.recentEvents.slice(0, clampInt(limit, 1, 40, 20))
  }

  /**
   * Analyze a settled tool execution and optionally return a corrective `UserMessage`
   * for injection into `additionalContexts` on the very next model step.
   */
  observeToolOutcome(exec, result) {
    if (!exec || !exec.agent) return undefined
    const snap = this.getSnapshot?.()
    if (!snap || snap.prefs?.selfHealEnabled === false) return undefined

    const agent = exec.agent
    const sessionId = agent?.session?.id || ''
    const header = agent?.session?.header || {}
    const parentSessionId = header.parentSession || ''
    const isSubagent = header.origin === 'subagent'
    const cwd = header.cwd || ''
    const toolName = String(exec.name || '')
    const toolLower = toolName.toLowerCase()
    const target = extractToolTarget(toolName, exec.arguments)

    // Case A: Tool SUCCEEDED after an earlier failure in this session -> capture live learned solution!
    if (result && result.isError !== true) {
      if (this.errorCountsByAgent.has(agent)) {
        const m = this.errorCountsByAgent.get(agent)
        m?.delete(toolLower)
      }
      if (sessionId && this.pendingErrorsBySession.has(sessionId)) {
        const pendingMap = this.pendingErrorsBySession.get(sessionId)
        const pending = pendingMap.get(toolLower)
        if (pending) {
          pendingMap.delete(toolLower)
          if (pendingMap.size === 0) this.pendingErrorsBySession.delete(sessionId)
          const resolution = `${toolName} 在此前出错后成功恢复${target ? ` (目标: ${truncateText(target, 60)})` : ''}`
          const { resolved } = resolveActiveCapsules({
            activations: snap.activations,
            capsules: snap.capsules,
            sessionId,
            parentSessionId,
            isSubagent,
            cwd,
            subagentInheritance: snap.prefs?.subagentInheritance !== false,
          })
          this.recordEvent({
            kind: 'self-heal-recovered',
            sessionId,
            tool: toolName,
            symptom: pending.symptom,
            resolution,
            capsuleIds: resolved.map(r => r.capsule.capsuleId),
          })
          if (resolved.length > 0 && typeof this.onLearnedFix === 'function') {
            void this.onLearnedFix({
              capsuleIds: resolved.map(r => r.capsule.capsuleId),
              tool: toolName,
              target: target || pending.target,
              symptom: pending.symptom,
              resolution,
              sourceSessionId: sessionId,
            }).catch(() => {})
          }
        }
      }
      return undefined
    }

    // Case B: Tool FAILED -> inspect active + workspace capsules for known self-healing solution or repeated failure loop
    const errorText = extractResultErrorText(result)
    let perToolErrors = this.errorCountsByAgent.get(agent)
    if (!perToolErrors) {
      perToolErrors = new Map()
      this.errorCountsByAgent.set(agent, perToolErrors)
    }
    const failCount = (perToolErrors.get(toolLower) || 0) + 1
    perToolErrors.set(toolLower, failCount)

    if (sessionId) {
      let sMap = this.pendingErrorsBySession.get(sessionId)
      if (!sMap) {
        sMap = new Map()
        this.pendingErrorsBySession.set(sessionId, sMap)
      }
      sMap.set(toolLower, { tool: toolName, target, symptom: errorText, at: Date.now() })
    }

    const { resolved } = resolveActiveCapsules({
      activations: snap.activations,
      capsules: snap.capsules,
      sessionId,
      parentSessionId,
      isSubagent,
      cwd,
      subagentInheritance: snap.prefs?.subagentInheritance !== false,
    })

    // Match rules from active capsules first, then workspace/crystallized fallback capsules
    const matchedSolutions = []
    const fallbackRefs = []
    for (const entry of resolved) {
      const cap = entry.capsule
      for (const rule of cap.selfHealing?.rules || []) {
        const sc = scoreRuleMatch(rule, toolName, errorText, target)
        if (sc >= 0.45) {
          matchedSolutions.push({ score: sc, capsule: cap, scope: entry.activationScope, rule })
        }
      }
      const firstGen = cap.workflow?.genealogySummary?.[0]
      if (firstGen) {
        fallbackRefs.push({ capsuleId: cap.capsuleId, title: cap.title, gen: firstGen.gen, steps: firstGen.steps, reason: firstGen.reason })
      }
    }

    // Also scan workspace/global crystallized capsules if active list found no direct rule match
    if (matchedSolutions.length === 0) {
      for (const cap of snap.capsules || []) {
        if (cap.maturity === 'exploring') continue
        for (const rule of cap.selfHealing?.rules || []) {
          const sc = scoreRuleMatch(rule, toolName, errorText, target)
          if (sc >= 0.55) {
            matchedSolutions.push({ score: sc, capsule: cap, scope: 'history-library', rule })
          }
        }
      }
    }

    matchedSolutions.sort((a, b) => b.score - a.score)

    if (matchedSolutions.length === 0 && failCount < 2) {
      return undefined
    }

    const lines = [
      `[FlowPack 运行时自我纠正与自愈提示] 工具 \`${toolName}\` 执行失败 (连续第 ${failCount} 次):`,
      `- 错误摘要: ${truncateText(errorText, 180)}`,
    ]
    if (matchedSolutions.length > 0) {
      lines.push('- 已从过往经验胶囊匹配到历史解法：')
      for (const m of matchedSolutions.slice(0, 3)) {
        lines.push(`  * [${m.capsule.title} (${m.scope})] ${m.rule.fixSteps} *(若优化路径仍受阻，保底参照 Gen ${m.rule.fallbackGen} 基线工作流)*`)
      }
    } else {
      lines.push('- 未匹配到既有经验库解法，正在处于自愈排错状态：请先诊断根因或检查前置条件/参数/权限，再切换策略（切勿用完全相同参数连续重试）。')
    }
    if (fallbackRefs.length > 0) {
      const f = fallbackRefs[0]
      lines.push(`- 非遗忘基线备忘: 当前已挂载胶囊「${f.title}」保留第 ${f.gen} 代探索基线 (${f.steps} 步)，如需查阅改善前步骤请调用 \`flowpack_capsule\` (action="recall_generation", capsuleId="${f.capsuleId}", gen=${f.gen})。`)
    }
    if (matchedSolutions.length > 0 && failCount === 1) {
      lines.push('- 修复成功后，系统将自动记忆此问题解决路径，不遗忘既往代次。')
    }

    const text = lines.join('\n')
    const summary = matchedSolutions.length > 0
      ? `Self-heal (${toolName}): 命中经验「${matchedSolutions[0].capsule.title}」`
      : `Self-heal (${toolName} x${failCount}): 触发纠错提示`

    this.recordEvent({
      kind: 'self-heal-nudge',
      sessionId,
      tool: toolName,
      failCount,
      matchedCount: matchedSolutions.length,
      summary,
    })

    return createSelfHealMessage(text, summary)
  }

  /** Attach fail-open listeners onto Cordis Context. */
  mount(ctx) {
    if (!ctx || typeof ctx.on !== 'function') return () => {}
    const unsubPost = ctx.on('tools/post-execute', async (exec, result, next) => {
      let reminder
      try {
        reminder = this.observeToolOutcome(exec, result)
      } catch {
        reminder = undefined
      }
      const downstream = await next()
      if (!reminder) return downstream
      return {
        ...downstream,
        additionalContexts: [reminder, ...(downstream?.additionalContexts || [])],
      }
    })

    const unsubPre = ctx.on('agent/pre-step', ({ agent, messages }, next) => {
      try {
        if (Array.isArray(messages) && messages.some(m => m?.source?.kind === 'user')) {
          this.errorCountsByAgent.delete(agent)
        }
      } catch {
        // ignore
      }
      return next()
    })

    return () => {
      try { if (typeof unsubPost === 'function') unsubPost() } catch { /* ignore */ }
      try { if (typeof unsubPre === 'function') unsubPre() } catch { /* ignore */ }
    }
  }
}
