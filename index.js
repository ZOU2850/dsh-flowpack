/**
 * DSH FlowPack (`dsh-flowpack` v2.0) — Host plugin entry.
 *
 * Capabilities:
 *  1. Human-like progressive learning (`exploring` -> `emerging` -> `crystallized`) with immutable
 *     non-forgetting workflow genealogy (Gen 1..N snapshots never overwritten).
 *  2. Selectable Experience Capsules shared across conversations, workspaces, and spawned/forked subagents,
 *     with cross-platform exports (`.dshcapsule.json`, `SKILL.md`, `AGENTS.md`, DSH PTC scripts).
 *  3. Real-time runtime Self-Correction & Self-Healing via DSH `tools/post-execute` waterfall
 *     + automatic error->resolution learning + cross-plugin tool discovery (`ctx.tools.definitions()`).
 *  4. Strictly packed, SHA-256 sealed, scope-isolated, compaction-proof memory via `ctx.systemPrompt`.
 */

import { ApprenticeService } from './lib/apprentice.js'
import { CapsuleService, resolveActiveCapsules } from './lib/capsule.js'
import { registerCommands } from './lib/commands.js'
import { compilePromptInjection, MemoryPackService } from './lib/memory-pack.js'
import { registerRoutes } from './lib/routes.js'
import { discoverPluginCapabilities, SelfHealingEngine } from './lib/self-heal.js'
import { FlowPackStore, DEFAULT_PREFERENCES } from './lib/store.js'
import { registerTools } from './lib/tools.js'
import { getService } from './lib/util.js'
import { Win32WatchDriver } from './lib/watch-driver.js'
import { WorkflowService } from './lib/workflow.js'

export const name = 'flowpack'
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

const INJECTION_SECTION_NAME = 'flowpack:strict-memory'
const INSTRUCTION_SECTION_NAME = 'flowpack:instructions'

/** Normalize a Cordis registration result (callback or `{ dispose }`) into a cleanup callback. */
function toDisposer(disposable) {
  if (typeof disposable === 'function') return disposable
  if (disposable && typeof disposable.dispose === 'function') return () => disposable.dispose()
  return () => {}
}

/**
 * Mount a reactive optional dependency so late-mounting services (like `connection`,
 * `commands`, or `skills` in DSH Desktop startup order) still attach cleanly without
 * stalling the Cordis fiber in CLI-only profiles.
 */
function mountOptional(ctx, serviceName, callback) {
  if (typeof ctx.inject === 'function') {
    return toDisposer(ctx.inject([serviceName], (scopedCtx) => toDisposer(callback(scopedCtx))))
  }
  if (ctx.get?.(serviceName) !== undefined) {
    return toDisposer(callback(ctx))
  }
  return () => {}
}

/**
 * Mount dsh-flowpack onto a DSH Cordis context. Fail-open: never blocks optional services.
 */
export function apply(ctx, config = {}) {
  const store = new FlowPackStore(typeof config?.storageDir === 'string' ? config.storageDir : undefined)
  const workflowService = new WorkflowService(ctx, store)
  const memoryService = new MemoryPackService(ctx, store, workflowService)
  const capsuleService = new CapsuleService(
    ctx,
    store,
    workflowService,
    memoryService,
    async () => discoverPluginCapabilities(ctx),
  )
  let lastModelRoute = null
  const watchDriver = new Win32WatchDriver(msg => ctx.logger?.warn?.(msg))
  const apprenticeService = new ApprenticeService(ctx, store, {
    workflowService,
    memoryService,
    capsuleService,
    watchDriver,
    getLastModelRoute: () => lastModelRoute,
  })

  // Synchronous in-memory mirror so `ctx.systemPrompt` and `tools/post-execute` evaluate synchronously in <1ms
  let cache = {
    prefs: { ...DEFAULT_PREFERENCES },
    packs: [],
    workflows: [],
    capsules: [],
    activations: { version: 1, global: [], workspaces: {}, sessions: {} },
    quarantinedIds: new Set(),
  }

  let lastSkillsSig = ''
  const lastIdleWorkAt = new Map() // sessionId -> timestampMs

  const refreshCache = async () => {
    try {
      const [prefs, packRes, workflows, capRes, activations] = await Promise.all([
        store.readPreferences(),
        store.listPacks(),
        store.listWorkflows(),
        store.listCapsules(),
        store.readActivations(),
      ])
      cache = {
        prefs,
        packs: packRes.packs,
        workflows,
        capsules: capRes.capsules,
        activations,
        quarantinedIds: cache.quarantinedIds,
      }
      const nextSig = workflows
        .filter(w => w.promotedAsSkill)
        .map(w => `${w.workflowId}:${w.version}:${w.updatedAt || 0}`)
        .join('|')
      if (nextSig !== lastSkillsSig) {
        lastSkillsSig = nextSig
        await workflowService.syncRuntimeSkills().catch(() => {})
      }
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-flowpack] cache refresh warning: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const selfHealEngine = new SelfHealingEngine({
    store,
    getSnapshot: () => cache,
    onLearnedFix: async ({ capsuleIds, tool, target, symptom, resolution, sourceSessionId }) => {
      if (!cache.prefs.autoConsolidateOnIdle) return
      for (const cid of capsuleIds.slice(0, 2)) {
        await capsuleService.learnProblemFix({
          capsuleId: cid,
          tool,
          target,
          symptom,
          resolution,
          sourceSessionId,
        }).catch(() => {})
      }
      await refreshCache()
    },
  })

  // Kick off initial warm-up immediately without stalling Cordis fiber
  void store.ensureDirs().then(refreshCache).catch(() => {})

  const renderDynamicInjection = (assembleCtx) => {
    try {
      const prefs = cache.prefs
      if (!prefs.autoInject) return ''
      const session = assembleCtx?.agent?.session
      const sessionId = session?.id || ''
      const header = session?.header || {}
      const parentSessionId = header.parentSession || ''
      const isSubagent = header.origin === 'subagent'
      const cwd = header.cwd || ''

      const activeCaps = resolveActiveCapsules({
        activations: cache.activations,
        capsules: cache.capsules,
        sessionId,
        parentSessionId,
        isSubagent,
        cwd,
        subagentInheritance: prefs.subagentInheritance !== false,
        requireSealed: prefs.requireSealedForInjection,
      })

      const compiled = compilePromptInjection({
        packs: cache.packs,
        workflows: cache.workflows,
        activeCapsules: activeCaps.resolved,
        quarantinedCapsules: activeCaps.quarantined,
        isSubagent,
        parentSessionId,
        sessionId,
        cwd,
        maxChars: prefs.promptBudgetChars,
        requireSealedForInjection: prefs.requireSealedForInjection,
        preferences: prefs,
      })

      // Lazily quarantine any tampered pack encountered during assembly without mutating inside sync render
      for (const q of compiled.quarantined) {
        if (!cache.quarantinedIds.has(q.packId)) {
          cache.quarantinedIds.add(q.packId)
          const bad = cache.packs.find(p => p.packId === q.packId)
          if (bad) {
            void store.quarantinePack(bad, 'tampered_at_prompt_assembly', { reason: q.reason })
              .then(refreshCache)
              .catch(() => {})
          }
        }
      }
      return compiled.text
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-flowpack] prompt assembly skipped: ${error instanceof Error ? error.message : String(error)}`)
      return ''
    }
  }

  // 1. Register concise tool guidance in systemPrompt + dynamic compaction-proof strict memory & capsule injection
  ctx.effect(() => {
    const sysPrompt = getService(ctx, 'systemPrompt')
    const disposers = []
    if (typeof sysPrompt?.section === 'function') {
      disposers.push(toDisposer(sysPrompt.section({
        name: INSTRUCTION_SECTION_NAME,
        order: 5100,
        interpolate: false,
        text: () =>
          '## FlowPack 经验学习、可选胶囊与严格记忆协议\n'
          + '- 使用 `flowpack_capsule`（`learn`/`crystallize`/`activate`/`learn_fix`/`recall_generation`/`export`）将多次执行沉淀为可选经验胶囊（支持跨对话与子 Agent 自动继承），并保留改善前全部历史代次不遗忘。\n'
          + '- 当用户需要提炼步骤或复用工作流时，调用 `flowpack_workflow`（`distill`/`optimize`/`export`）；遇到自愈排错提示时优先遵循历史已验证解法，必要时可 `recall_generation` 对照初始基线。\n'
          + '- 当需要跨上下文压缩持久化严格约束/事实时，调用 `flowpack_memory`（`pin`/`pack`/`seal`/`verify`）并附带 `sourceRef` 溯源，严禁写入明文密钥。\n'
          + '- 当处于人类示教/训练任务（消息带 `[FLOWPACK_TRAIN:...]`）时，可调用 `flowpack_train`（`inspect_demo`/`ask_question`/`propose_better_method`/`record_round`）随时向人类提问、提出/采用更快更好的替代方法完成任务，并请人类查收批注。',
      })))
    }
    if (typeof sysPrompt?.context === 'function') {
      disposers.push(toDisposer(sysPrompt.context({
        name: INJECTION_SECTION_NAME,
        order: 125,
        required: true,
        interpolate: false,
        text: renderDynamicInjection,
      })))
    } else if (typeof sysPrompt?.section === 'function') {
      disposers.push(toDisposer(sysPrompt.section({
        name: INJECTION_SECTION_NAME,
        order: 5110,
        interpolate: false,
        text: renderDynamicInjection,
      })))
    }
    return () => {
      for (const d of disposers.splice(0).reverse()) {
        try { d() } catch { /* ignore */ }
      }
    }
  })

  // 2. Register agent tools (`flowpack_workflow`, `flowpack_memory`, `flowpack_capsule`, `flowpack_train`)
  ctx.effect(() => toDisposer(registerTools(ctx, {
    store,
    workflowService,
    memoryService,
    capsuleService,
    selfHealEngine,
    apprenticeService,
    onMutate: refreshCache,
  })))

  // 3. Optional slash commands (`/flow-distill`, `/flow-pack`, `/flow-verify`, `/flow-capsule`)
  mountOptional(ctx, 'commands', (scopedCtx) => registerCommands(scopedCtx, {
    workflowService,
    memoryService,
    capsuleService,
    onMutate: refreshCache,
  }))

  // 4. Optional HTTP Fetch routes for sidebar UI, composer capsule dock & settings
  mountOptional(ctx, 'connection', (scopedCtx) => registerRoutes(scopedCtx, {
    store,
    workflowService,
    memoryService,
    capsuleService,
    selfHealEngine,
    apprenticeService,
    onMutate: refreshCache,
  }))

  // 5. Optional runtime skills sync when `skills` mounts later
  mountOptional(ctx, 'skills', () => {
    void workflowService.syncRuntimeSkills().catch(() => {})
    return () => workflowService.dispose()
  })

  // 6. Runtime self-healing interceptor (`tools/post-execute` + `agent/pre-step`) & compaction/evolution hooks
  ctx.effect(() => {
    const disposers = []
    disposers.push(toDisposer(selfHealEngine.mount(ctx)))

    if (typeof ctx.on === 'function') {
      disposers.push(toDisposer(ctx.on('agent/created', ({ agent, source }) => {
        if (source !== 'compact') return
        const sessionId = agent?.session?.id
        if (!sessionId) return
        void (async () => {
          const prefs = await store.readPreferences()
          await store.recordAudit({
            kind: 'compaction-survival-check',
            sessionId,
            cwd: agent?.session?.header?.cwd || '',
            autoPackOnCompact: prefs.autoPackOnCompact,
          })
          if (prefs.autoPackOnCompact) {
            await memoryService.packFromSession({
              sessionId,
              seal: true,
            }).catch(() => {})
            await refreshCache()
          }
        })()
      })))

      disposers.push(toDisposer(ctx.on('agent/status', ({ agent, status }) => {
        const modelRoute = agent?.session?.requestHeader?.()?.config ?? agent?.options
        if (modelRoute?.provider && modelRoute?.model) {
          lastModelRoute = { provider: modelRoute.provider, model: modelRoute.model }
        }
        if (status !== 'idle') return
        const sessionId = agent?.session?.id
        if (!sessionId) return
        const header = agent?.session?.header || {}
        const linkedTrain = apprenticeService.getLinkedSessionInfo(sessionId)
        if (linkedTrain && !linkedTrain.recorded) {
          void (async () => {
            const res = await apprenticeService.recordRoundFromSession(linkedTrain.trainId, {
              sessionId,
              baselineEventCount: linkedTrain.baselineEventCount,
            }).catch(() => null)
            if (res) await refreshCache()
          })()
        }
        const now = Date.now()
        if (now - (lastIdleWorkAt.get(sessionId) || 0) < 15000) return
        void (async () => {
          const prefs = await store.readPreferences()
          if (!prefs.autoDistillOnIdle && !prefs.autoConsolidateOnIdle) return
          let didMutate = false
          if (prefs.autoDistillOnIdle) {
            await workflowService.distillFromSession({ sessionId }).then(() => { didMutate = true }).catch(() => {})
          }
          if (prefs.autoConsolidateOnIdle) {
            const active = resolveActiveCapsules({
              activations: cache.activations,
              capsules: cache.capsules,
              sessionId,
              parentSessionId: header.parentSession || '',
              isSubagent: header.origin === 'subagent',
              cwd: header.cwd || '',
              subagentInheritance: prefs.subagentInheritance !== false,
            })
            if (active.resolved.length > 0) {
              for (const entry of active.resolved.slice(0, 1)) {
                await capsuleService.learnFromSession({
                  sessionId,
                  capsuleId: entry.capsule.capsuleId,
                }).then(() => { didMutate = true }).catch(() => {})
              }
            }
          }
          if (didMutate) {
            lastIdleWorkAt.set(sessionId, Date.now())
            await refreshCache()
          }
        })()
      })))
    }

    return () => {
      for (const d of disposers.splice(0).reverse()) {
        try { d() } catch { /* ignore */ }
      }
      apprenticeService.dispose()
      watchDriver.dispose()
      workflowService.dispose()
    }
  })

  return {
    store,
    workflowService,
    memoryService,
    capsuleService,
    selfHealEngine,
    apprenticeService,
    refreshCache,
    compileCurrentInjection: (opts = {}) => {
      const active = resolveActiveCapsules({
        activations: cache.activations,
        capsules: cache.capsules,
        sessionId: opts.sessionId || '',
        parentSessionId: opts.parentSessionId || '',
        isSubagent: Boolean(opts.isSubagent),
        cwd: opts.cwd || '',
        subagentInheritance: cache.prefs.subagentInheritance !== false,
      })
      return memoryService.compileForContext({
        ...opts,
        activeCapsules: opts.activeCapsules ?? active.resolved,
        quarantinedCapsules: opts.quarantinedCapsules ?? active.quarantined,
      })
    },
  }
}

export default { name, inject, apply }
