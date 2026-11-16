/**
 * Optional human slash commands (`/flow-distill`, `/flow-pack`, `/flow-verify`, `/flow-capsule`)
 * registered when `ctx.get('commands')` is present. Fail-open if absent.
 */

/** Bind optional slash commands onto `ctx.commands`. */
export function registerCommands(ctx, { workflowService, memoryService, capsuleService, onMutate }) {
  const commands = ctx.get?.('commands')
  if (!commands || typeof commands.register !== 'function') return () => {}

  const disposers = []
  const safeRegister = (def) => {
    try {
      disposers.push(commands.register(def))
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-flowpack] command "${def.name}" registration skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  safeRegister({
    name: 'flow-distill',
    description: '提炼并优化当前会话的 AI 工作流（消重、并行编排、合成护栏）',
    input: { hint: '[工作流标题（可选）]' },
    async handler(invocation) {
      const sessionId = invocation.agent?.session?.id
      if (!sessionId) return { kind: 'error', text: '未检测到活动会话，无法提炼工作流。' }
      const customTitle = invocation.rawInput?.trim() || undefined
      const { workflow } = await workflowService.distillFromSession({
        sessionId,
        title: customTitle,
        signal: invocation.signal,
      })
      await onMutate?.()
      return {
        kind: 'success',
        text: `已提炼并优化工作流「${workflow.title}」(${workflow.workflowId} v${workflow.version})\n${workflow.optimized.diff.summary}`,
      }
    },
  })

  safeRegister({
    name: 'flow-pack',
    description: '从当前会话采集事实、约束、踩坑与交付锚点并执行 SHA-256 严格记忆打包',
    input: { hint: '[记忆包标题（可选）]' },
    async handler(invocation) {
      const sessionId = invocation.agent?.session?.id
      if (!sessionId) return { kind: 'error', text: '未检测到活动会话，无法打包记忆。' }
      const customTitle = invocation.rawInput?.trim() || undefined
      const res = await memoryService.packFromSession({
        sessionId,
        title: customTitle,
        seal: true,
        signal: invocation.signal,
      })
      await onMutate?.()
      const recap = (res.memorySummary?.recapLines || []).join('\n')
      return {
        kind: 'success',
        text: `已整理并记住重要笔记「${res.pack.title}」(${res.pack.packId} v${res.pack.version} · ${res.pack.scope})\n`
          + (recap ? `${recap}\n` : '')
          + `条目 ${res.stats.totalEntries}，大小 ${res.stats.totalChars}/${res.pack.budget.maxTotalChars} 字符 (${res.stats.budgetPct}%)\n`
          + `SHA-256: ${res.pack.integrity.sha256}`,
      }
    },
  })

  safeRegister({
    name: 'flow-verify',
    description: '对当前作用域下的严格记忆包执行 Schema、作用域隔离、密钥与 SHA-256 完整性审计',
    async handler(invocation) {
      const sessionId = invocation.agent?.session?.id
      const cwd = invocation.agent?.session?.header?.cwd || ''
      const report = await memoryService.verifyAll({ sessionId, cwd })
      await onMutate?.()
      return {
        kind: report.ok ? 'success' : 'error',
        text: `严格校验完成：共 ${report.checked} 个，通过 ${report.passed}，失败 ${report.failed}`
          + (report.quarantinedNow.length > 0 ? `，已隔离异常包: ${report.quarantinedNow.join(', ')}` : ''),
      }
    },
  })

  if (capsuleService) {
    safeRegister({
      name: 'flow-capsule',
      description: '从当前会话学习/叠加经验胶囊（支持第1次摸索→多次结晶按键），保留全部演化代次与自愈规则',
      input: { hint: '[可选: crystallize] [经验胶囊标题]' },
      async handler(invocation) {
        const sessionId = invocation.agent?.session?.id
        if (!sessionId) return { kind: 'error', text: '未检测到活动会话，无法凝聚经验胶囊。' }
        const raw = (invocation.rawInput || '').trim()
        const forceCrystallize = /^crystallize\b/i.test(raw)
        const title = (forceCrystallize ? raw.replace(/^crystallize\b/i, '').trim() : raw) || undefined
        const res = await capsuleService.learnFromSession({
          sessionId,
          title,
          crystallize: forceCrystallize,
          activate: forceCrystallize,
          signal: invocation.signal,
        })
        await onMutate?.()
        const c = res.capsule
        const recap = (c.learnedSummary?.recapLines || []).map(l => `- ${l}`).join('\n')
        return {
          kind: 'success',
          text: `${c.icon} 已记住经验「${c.title}」（第 ${c.attempts} 次，${c.maturity}）\n`
            + (recap ? `${recap}\n` : '')
            + `自愈解法 ${c.selfHealing?.rules?.length || 0} 条 · 历史保留 ${c.workflow?.genealogySummary?.length || 1} 个版本`,
        }
      },
    })
  }

  return () => {
    for (const d of disposers) {
      try { d?.() } catch { /* ignore */ }
    }
  }
}
