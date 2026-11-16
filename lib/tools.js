/**
 * Model-facing tools registered through `ctx.tools.register`:
 *   - `flowpack_workflow`: distill, optimize, inspect, diff, promote, and export workflows
 *   - `flowpack_memory`: capture, seal, verify, pin, query, diff, rollback, export, and import strict memory packs
 */

import { exportCapsuleBundle, resolveActiveCapsules } from './capsule.js'
import { exportPackMarkdown, diffPacks } from './memory-pack.js'
import { diffWorkflow, renderSkillMarkdown, renderWorkflowScript } from './workflow.js'
import { getService } from './util.js'
import { basename } from 'node:path'

/** Resolve current workspace directory via `workingDirectory` or session header fallback. */
async function resolveCwd(ctx, exec) {
  const wd = getService(ctx, 'workingDirectory')
  if (wd !== undefined && exec?.agent !== undefined) {
    try {
      const dir = await wd.ensure(exec.agent, exec.signal)
      if (typeof dir === 'string' && dir.length > 0) return dir
    } catch {
      // Fallback below
    }
  }
  return exec?.agent?.session?.header?.cwd || ''
}

/** Register `flowpack_workflow`, `flowpack_memory`, and `flowpack_capsule` tools on `ctx.tools`. */
export function registerTools(ctx, { store, workflowService, memoryService, capsuleService, selfHealEngine, apprenticeService, onMutate }) {
  const tools = getService(ctx, 'tools')
  if (!tools || typeof tools.register !== 'function') return () => {}
  const disposeWorkflowTool = tools.register({
    name: 'flowpack_workflow',
    description:
      'Distill and optimize AI execution workflows from DSH session traces (deduplicating redundant reads, merging retry failures into guardrails, batching parallel steps) and export reusable SKILL.md or DSH workflow scripts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['distill', 'optimize', 'list', 'get', 'diff', 'promote_skill', 'export'],
          description: 'Workflow operation to perform. Defaults to "list".',
        },
        sessionId: {
          type: 'string',
          description: 'Source session ID for "distill". Defaults to the current session.',
        },
        workflowId: {
          type: 'string',
          description: 'Target workflow ID for "optimize", "get", "diff", "promote_skill", or "export".',
        },
        name: {
          type: 'string',
          description: 'Optional kebab-case skill slug override for "distill".',
        },
        title: {
          type: 'string',
          description: 'Optional workflow title override.',
        },
        addGuardrail: {
          type: 'string',
          description: 'For "optimize": add an explicit pre-check or anti-pitfall rule.',
        },
        promote: {
          type: 'boolean',
          description: 'For "distill", "optimize", or "promote_skill": whether to publish the workflow as a runtime DSH Skill.',
        },
        format: {
          type: 'string',
          enum: ['skill', 'script', 'json'],
          description: 'For "export": artifact format ("skill" = SKILL.md, "script" = DSH PTC workflow JS, "json" = full spec). Defaults to "skill".',
        },
        versionA: { type: 'integer', description: 'Optional source revision number for "diff".' },
        versionB: { type: 'integer', description: 'Optional target revision number for "diff".' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max workflows returned by "list" (default 20).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(rawArgs, exec) {
      const args = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}
      const action = typeof args.action === 'string' ? args.action : 'list'
      const sessionId = typeof args.sessionId === 'string' && args.sessionId.trim()
        ? args.sessionId.trim()
        : exec?.agent?.session?.id
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(50, Math.trunc(args.limit)))
        : 20

      if (action === 'list') {
        const items = (await store.listWorkflows()).slice(0, limit)
        if (items.length === 0) {
          return { text: 'No distilled workflows yet. Use action "distill" to extract and optimize a workflow from this session.' }
        }
        const lines = items.map((w, i) => {
          const m = w.optimized?.metrics || {}
          const skillTag = w.promotedAsSkill ? ' [SKILL ACTIVE]' : ''
          return `${i + 1}. ${w.title} (id: ${w.workflowId}, name: ${w.name}, v${w.version}${skillTag})\n   steps: ${m.beforeSteps ?? 0} -> ${m.afterSteps ?? 0}, score: ${m.beforeScore ?? '-'} -> ${m.afterScore ?? '-'}, parallel: ${m.parallelStagesCount ?? 0}, guardrails: ${m.guardrailsAdded ?? 0}`
        })
        return { text: `Distilled Workflows (${items.length}):\n${lines.join('\n')}` }
      }

      if (action === 'distill') {
        if (!sessionId) throw new Error('flowpack_workflow distill requires a sessionId (or run inside an active session).')
        const { workflow } = await workflowService.distillFromSession({
          sessionId,
          workflowId: args.workflowId,
          name: args.name,
          title: args.title,
          promote: args.promote,
          signal: exec?.signal,
        })
        await onMutate?.()
        const m = workflow.optimized.metrics
        return {
          text: `Distilled & optimized workflow "${workflow.title}" (${workflow.workflowId} v${workflow.version}, skill name: ${workflow.name})\n`
            + `Summary: ${workflow.optimized.diff.summary}\n`
            + `Metrics: steps ${m.beforeSteps} -> ${m.afterSteps}, duplicatesRemoved=${m.duplicatesRemoved}, retriesResolved=${m.retriesResolved}, parallelGroups=${m.parallelStagesCount}, guardrails=${m.guardrailsAdded}, score ${m.beforeScore} -> ${m.afterScore}/100`,
        }
      }

      if (!args.workflowId) throw new Error(`flowpack_workflow "${action}" requires "workflowId".`)

      if (action === 'optimize') {
        const wf = await workflowService.optimizeWorkflow({
          workflowId: args.workflowId,
          addGuardrail: args.addGuardrail,
          title: args.title,
          promote: args.promote,
        })
        await onMutate?.()
        return { text: `Optimized workflow "${wf.title}" to v${wf.version}: ${wf.optimized.diff.summary}` }
      }

      if (action === 'promote_skill') {
        const wf = await workflowService.setPromoted(args.workflowId, args.promote !== false)
        await onMutate?.()
        return { text: `Workflow "${wf.name}" (${wf.workflowId}) runtime skill status: ${wf.promotedAsSkill ? 'PROMOTED & ACTIVE' : 'DISABLED'}.` }
      }

      const wf = await store.readWorkflow(args.workflowId)
      if (!wf) throw new Error(`Workflow "${args.workflowId}" was not found.`)

      if (action === 'diff') {
        const d = diffWorkflow(wf, args.versionA, args.versionB)
        return {
          text: `Workflow diff for ${d.name} (current v${d.currentVersion}):\n`
            + `Baseline vs Current: ${d.baselineVsCurrent.beforeSteps} -> ${d.baselineVsCurrent.afterSteps} steps (saved ${d.baselineVsCurrent.stepsSaved}), score ${d.baselineVsCurrent.beforeScore} -> ${d.baselineVsCurrent.afterScore}\n`
            + (d.from ? `From v${d.from.version}: ${d.from.afterSteps} steps, score ${d.from.afterScore}\n` : '')
            + (d.to ? `To v${d.to.version}: ${d.to.afterSteps} steps, score ${d.to.afterScore} — ${d.to.summary}` : ''),
        }
      }

      if (action === 'export') {
        const format = args.format || 'skill'
        if (format === 'script') return { text: wf.artifacts?.workflowScript || renderWorkflowScript(wf) }
        if (format === 'json') return { text: JSON.stringify(wf, null, 2) }
        return { text: wf.artifacts?.skillMarkdown || renderSkillMarkdown(wf) }
      }

      // action === 'get'
      const stageLines = (wf.optimized?.stages || []).map((st, idx) =>
        `${idx + 1}. [${st.executionMode.toUpperCase()}] ${st.phaseLabel}: ${st.steps.map(s => `${s.tool}(${s.target || '-'})`).join(' | ')}`,
      )
      return {
        text: `Workflow "${wf.title}" (${wf.workflowId} v${wf.version}, skill=${wf.name}, promoted=${wf.promotedAsSkill})\n`
          + `${wf.optimized?.diff?.summary || ''}\nStages:\n${stageLines.join('\n') || '(none)'}`,
      }
    },
  })

  const disposeMemoryTool = tools.register({
    name: 'flowpack_memory',
    description:
      'Strictly pack, SHA-256 seal, verify, pin, query, diff, rollback, export, or import compaction-proof project & session memory packs with strict scope isolation (workspace/session/global) and secret redaction.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['pack', 'seal', 'verify', 'pin', 'list', 'query', 'diff', 'rollback', 'export', 'import'],
          description: 'Strict memory operation to perform. Defaults to "query".',
        },
        packId: { type: 'string', description: 'Target pack ID.' },
        sessionId: { type: 'string', description: 'Source or active session ID.' },
        cwd: { type: 'string', description: 'Workspace root directory (auto-resolved from session when omitted).' },
        title: { type: 'string', description: 'Memory pack title.' },
        scope: {
          type: 'string',
          enum: ['session', 'workspace', 'global', 'workflow'],
          description: 'Strict isolation scope for new packs or pins.',
        },
        section: {
          type: 'string',
          enum: ['constraints', 'facts', 'decisions', 'pitfalls', 'workflows', 'checkpoints'],
          description: 'For "pin": target typed memory section (default "facts").',
        },
        text: { type: 'string', description: 'For "pin": verified fact/constraint/decision/pitfall/checkpoint text.' },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'normal'],
          description: 'For "pin": entry injection priority.',
        },
        sourceRef: { type: 'string', description: 'Provenance citation (e.g. file path, command, or event ref).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional search tags.' },
        query: { type: 'string', description: 'Search query string for "query".' },
        seal: { type: 'boolean', description: 'Whether "pack" or "pin" immediately computes a SHA-256 strict seal (default true).' },
        version: { type: 'integer', description: 'Archived target version for "rollback" or "diff".' },
        bundleJson: { type: 'string', description: 'For "import": serialized `.dshpack.json` payload.' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'For "export": bundle output format.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max packs/hits to return.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(rawArgs, exec) {
      const args = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}
      const action = typeof args.action === 'string' ? args.action : 'query'
      const cwd = (typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd.trim() : await resolveCwd(ctx, exec)
      const sessionId = typeof args.sessionId === 'string' && args.sessionId.trim()
        ? args.sessionId.trim()
        : exec?.agent?.session?.id
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(50, Math.trunc(args.limit)))
        : 20

      if (action === 'pack') {
        if (!sessionId) throw new Error('flowpack_memory "pack" requires a sessionId (or active session).')
        const res = await memoryService.packFromSession({
          sessionId,
          packId: args.packId,
          title: args.title,
          scope: args.scope,
          seal: args.seal !== false,
          signal: exec?.signal,
        })
        await onMutate?.()
        const recap = (res.memorySummary?.recapLines || []).join('\n')
        return {
          text: `Packed memory "${res.pack.title}" (${res.pack.packId} v${res.pack.version}, state=${res.pack.sealState}, scope=${res.pack.scope})\n`
            + (recap ? `${recap}\n` : '')
            + `Entries: ${res.stats.totalEntries}, Size: ${res.stats.totalChars}/${res.pack.budget.maxTotalChars} chars (${res.stats.budgetPct}%)\n`
            + (res.pack.integrity?.sha256 ? `SHA-256: ${res.pack.integrity.sha256}\n` : '')
            + (res.warnings.length > 0 ? `Warnings:\n- ${res.warnings.join('\n- ')}` : 'Clean strict validation passed.'),
        }
      }

      if (action === 'pin') {
        if (typeof args.text !== 'string' || args.text.trim().length === 0) {
          throw new Error('flowpack_memory "pin" requires non-empty "text".')
        }
        const res = await memoryService.pinEntry({
          packId: args.packId,
          title: args.title || (cwd ? `${basename(cwd)} 严格记忆包` : undefined),
          scope: args.scope,
          workspaceRoot: cwd,
          sessionId,
          section: args.section || 'facts',
          text: args.text,
          priority: args.priority || 'high',
          sourceType: args.sourceRef ? 'file' : 'user',
          sourceRef: args.sourceRef || (sessionId ? `session:${sessionId}` : cwd || 'agent-pin'),
          tags: Array.isArray(args.tags) ? args.tags : [],
          seal: args.seal,
        })
        await onMutate?.()
        return {
          text: `Pinned [${args.section || 'facts'}] entry into "${res.pack.title}" (${res.pack.packId} v${res.pack.version}, state=${res.pack.sealState}, totalChars=${res.stats.totalChars})`
            + (res.pack.integrity?.sha256 ? `\nSHA-256: ${res.pack.integrity.sha256}` : ''),
        }
      }

      if (action === 'seal') {
        if (!args.packId) throw new Error('flowpack_memory "seal" requires "packId".')
        const res = await memoryService.sealExistingPack(args.packId)
        await onMutate?.()
        return {
          text: res.alreadySealed
            ? `Pack "${res.pack.packId}" v${res.pack.version} is already sealed & verified (${res.pack.integrity.sha256}).`
            : `Sealed pack "${res.pack.title}" (${res.pack.packId} v${res.pack.version}) with SHA-256: ${res.pack.integrity.sha256}`,
        }
      }

      if (action === 'verify') {
        const report = await memoryService.verifyAll({ packId: args.packId, sessionId, cwd })
        await onMutate?.()
        const lines = report.results.map(r =>
          `- ${r.packId} v${r.version} [${r.sealState}]: ${r.ok ? 'PASS' : 'FAIL'}`
          + (r.scopeReason ? ` (scope blocked: ${r.scopeReason})` : ' (scope ok)')
          + (r.errors.length > 0 ? `\n  errors: ${r.errors.join('; ')}` : ''),
        )
        return {
          text: `Strict Memory Verification: checked=${report.checked}, passed=${report.passed}, failed=${report.failed}`
            + (report.quarantinedNow.length > 0 ? `, quarantinedNow=[${report.quarantinedNow.join(', ')}]` : '')
            + (lines.length > 0 ? `\n${lines.join('\n')}` : '\nNo stored memory packs found.'),
        }
      }

      if (action === 'list') {
        const { packs, corrupt } = await store.listPacks()
        if (packs.length === 0 && corrupt.length === 0) return { text: 'No memory packs stored yet.' }
        const lines = packs.slice(0, limit).map((p, i) => {
          const digest = p.integrity?.sha256 ? p.integrity.sha256.slice(0, 12) : 'draft'
          return `${i + 1}. ${p.title} (${p.packId} v${p.version}, ${p.sealState}:${digest}, scope=${p.scope}${p.workspaceRoot ? `@${p.workspaceRoot}` : ''})`
        })
        if (corrupt.length > 0) lines.push(`Corrupt unreadable files: ${corrupt.map(c => c.file).join(', ')}`)
        return { text: `Memory Packs (${packs.length}):\n${lines.join('\n')}` }
      }

      if (action === 'query') {
        const hits = await memoryService.queryPacks({ query: args.query || '', cwd, sessionId, limit })
        if (hits.length === 0) return { text: `No matching verified memory entries in current scope (${cwd || sessionId || 'global'}).` }
        const lines = hits.map(p =>
          `### ${p.title} (${p.packId} v${p.version}, ${p.sealState})\n`
          + (p.hits.length > 0 ? p.hits.map(h => `- [${h.section}|${h.priority}] ${h.text} (src: ${h.provenance?.ref})`).join('\n') : '(matched title only)'),
        )
        return { text: lines.join('\n\n') }
      }

      if (action === 'rollback') {
        if (!args.packId) throw new Error('flowpack_memory "rollback" requires "packId".')
        const restored = await memoryService.rollbackPack(args.packId, args.version)
        await onMutate?.()
        return { text: `Rolled back "${restored.packId}" to verified archive v${restored.version} (SHA-256: ${restored.integrity?.sha256 || 'n/a'}).` }
      }

      if (action === 'diff') {
        if (!args.packId) throw new Error('flowpack_memory "diff" requires "packId".')
        const current = (await store.readPack(args.packId)).pack
        if (!current) throw new Error(`Pack "${args.packId}" not found.`)
        const archives = await store.listPackArchives(args.packId)
        const base = args.version ? archives.find(a => a.version === args.version) : archives[archives[0]?.version === current.version ? 1 : 0]
        if (!base) return { text: `Pack "${args.packId}" v${current.version} has no older sealed archive snapshot to diff against.` }
        const d = diffPacks(base, current)
        return {
          text: `Diff ${d.packId} v${d.fromVersion} -> v${d.toVersion}: +${d.addedCount} added, -${d.removedCount} removed\n${JSON.stringify(d.sections, null, 2)}`,
        }
      }

      if (action === 'export') {
        if (!args.packId) throw new Error('flowpack_memory "export" requires "packId".')
        const current = (await store.readPack(args.packId)).pack
        if (!current) throw new Error(`Pack "${args.packId}" not found.`)
        return {
          text: args.format === 'json' ? JSON.stringify(current, null, 2) : exportPackMarkdown(current),
        }
      }

      if (action === 'import') {
        if (typeof args.bundleJson !== 'string' || args.bundleJson.trim().length === 0) {
          throw new Error('flowpack_memory "import" requires "bundleJson".')
        }
        const imported = await memoryService.importBundle(args.bundleJson)
        await onMutate?.()
        return { text: `Imported & strictly verified pack "${imported.pack.title}" (${imported.pack.packId} v${imported.pack.version}, state=${imported.pack.sealState}).` }
      }

      throw new Error(`Unknown flowpack_memory action: ${action}`)
    },
  })

  const disposeCapsuleTool = capsuleService
    ? tools.register({
        name: 'flowpack_capsule',
        description:
          'Learn & consolidate repeated tasks into Selectable Experience Capsules (`exploring` -> `emerging` -> `crystallized`), activate them across conversations & subagents, record self-healing problem fixes, consult/restore non-forgetting prior workflow generations (`genealogy`), and export cross-platform bundles (`SKILL.md`, `AGENTS.md`, DSH PTC script, `.dshcapsule.json`).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['learn', 'list', 'get', 'crystallize', 'activate', 'deactivate', 'learn_fix', 'recall_generation', 'rename', 'export', 'import'],
              description: 'Experience capsule action. Defaults to "list".',
            },
            capsuleId: { type: 'string', description: 'Target capsule ID.' },
            sessionId: { type: 'string', description: 'Session ID (defaults to current session).' },
            cwd: { type: 'string', description: 'Workspace directory.' },
            title: { type: 'string', description: 'Capsule title.' },
            name: { type: 'string', description: 'Slug identifier.' },
            scope: {
              type: 'string',
              enum: ['session', 'workspace', 'global', 'all'],
              description: 'Activation scope: "session", "workspace" (all chats in project), or "global" (cross-conversation + all agents).',
            },
            crystallize: { type: 'boolean', description: 'Force promote to crystallized Selectable Capsule immediately.' },
            activate: { type: 'boolean', description: 'Whether "learn"/"crystallize" also activates the capsule button immediately.' },
            gen: { type: 'integer', description: 'Target generation number for "recall_generation" (e.g. 1 for baseline).' },
            restore: { type: 'boolean', description: 'For "recall_generation": if true, restores that generation forward as a new version while preserving newer ones.' },
            tool: { type: 'string', description: 'For "learn_fix": tool name associated with the problem.' },
            target: { type: 'string', description: 'For "learn_fix": file/target associated with the problem.' },
            symptom: { type: 'string', description: 'For "learn_fix": error or symptom observed.' },
            resolution: { type: 'string', description: 'For "learn_fix": verified workaround/fix.' },
            format: {
              type: 'string',
              enum: ['skill', 'dshcapsule', 'agents_md', 'ptc', 'markdown'],
              description: 'Export format for "export".',
            },
            bundleJson: { type: 'string', description: 'For "import": serialized `.dshcapsule.json` content.' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max capsules for "list".' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute(rawArgs, exec) {
          const args = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}
          const action = typeof args.action === 'string' ? args.action : 'list'
          const sessionId = typeof args.sessionId === 'string' && args.sessionId.trim()
            ? args.sessionId.trim()
            : exec?.agent?.session?.id
          const header = exec?.agent?.session?.header || {}
          const cwd = (typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd.trim() : await resolveCwd(ctx, exec)
          const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.min(50, Math.trunc(args.limit)))
            : 20

          if (action === 'list') {
            const [{ capsules }, activations] = await Promise.all([store.listCapsules(), store.readActivations()])
            const activeInfo = resolveActiveCapsules({
              activations,
              capsules,
              sessionId: sessionId || '',
              parentSessionId: header.parentSession || '',
              isSubagent: header.origin === 'subagent',
              cwd,
            })
            const activeMap = new Map(activeInfo.resolved.map(r => [r.capsule.capsuleId, r.activationScope]))
            if (capsules.length === 0) return { text: 'No experience capsules learned yet. Use action="learn" after completing a task!' }
            const lines = capsules.slice(0, limit).map((c, i) => {
              const scopeTag = activeMap.has(c.capsuleId) ? ` [ACTIVE:${activeMap.get(c.capsuleId)}]` : ''
              return `${i + 1}. ${c.icon || '⚡'} ${c.title} (${c.capsuleId} v${c.version}, ${c.maturity}${scopeTag}, attempts=${c.attempts}, successes=${c.successes}, rules=${c.selfHealing?.rules?.length || 0}, gens=${c.workflow?.genealogySummary?.length || 1})`
            })
            return { text: `Experience Capsules (${capsules.length}):\n${lines.join('\n')}` }
          }

          if (action === 'learn' || action === 'crystallize') {
            if (action === 'crystallize' && args.capsuleId && !args.sessionId) {
              const cap = await store.readCapsule(args.capsuleId)
              if (!cap) throw new Error(`Capsule "${args.capsuleId}" not found.`)
              const { buildCapsuleFromArtifacts } = await import('./capsule.js')
              const wf = await store.readWorkflow(cap.workflow?.workflowId)
              if (!wf) throw new Error(`Linked workflow for capsule "${args.capsuleId}" not found.`)
              const nextWf = { ...wf, maturity: 'crystallized', updatedAt: Date.now() }
              await store.saveWorkflow(nextWf)
              const updated = buildCapsuleFromArtifacts({ workflow: nextWf, existingCapsule: cap, crystallize: true })
              await store.saveCapsule(updated)
              if (args.activate !== false) {
                await capsuleService.activateCapsule({
                  capsuleId: updated.capsuleId,
                  scope: args.scope || (updated.workspaceRoot ? 'workspace' : 'global'),
                  sessionId: sessionId || '',
                  cwd: updated.workspaceRoot || cwd,
                })
              }
              await onMutate?.()
              return { text: `⚡ Crystallized capsule "${updated.title}" (${updated.capsuleId} v${updated.version}), ready as selectable button.` }
            }

            if (!sessionId) throw new Error('flowpack_capsule "learn" requires sessionId (or run inside a session).')
            const res = await capsuleService.learnFromSession({
              sessionId,
              capsuleId: args.capsuleId,
              title: args.title,
              name: args.name,
              crystallize: action === 'crystallize' || args.crystallize === true,
              scope: args.scope === 'global' || args.scope === 'session' ? args.scope : 'workspace',
              activate: args.activate === true,
              activateScope: args.scope,
              signal: exec?.signal,
            })
            await onMutate?.()
            const c = res.capsule
            const recap = (c.learnedSummary?.recapLines || []).map(l => `  • ${l}`).join('\n')
            return {
              text: `${c.icon} 已记住并整理经验「${c.title}」（${c.capsuleId} v${c.version}, ${c.maturity}）\n`
                + (recap ? `${recap}\n` : '')
                + `自愈规则: ${c.selfHealing?.rules?.length || 0} 条，保留演化代次: ${c.workflow?.genealogySummary?.length || 1} 代。`,
            }
          }

          if (!args.capsuleId) throw new Error(`flowpack_capsule "${action}" requires "capsuleId".`)

          if (action === 'rename') {
            const renamed = await capsuleService.renameCapsule({ capsuleId: args.capsuleId, title: args.title })
            await onMutate?.()
            return { text: `已将经验胶囊重命名为「${renamed.title}」(${renamed.capsuleId})。` }
          }

          if (action === 'activate') {
            await capsuleService.activateCapsule({
              capsuleId: args.capsuleId,
              scope: args.scope || 'workspace',
              sessionId: sessionId || '',
              cwd,
            })
            await onMutate?.()
            return { text: `Activated capsule "${args.capsuleId}" for scope=${args.scope || 'workspace'} (subagents inherit automatically).` }
          }

          if (action === 'deactivate') {
            await capsuleService.deactivateCapsule({
              capsuleId: args.capsuleId,
              scope: args.scope || 'all',
              sessionId: sessionId || '',
              cwd,
            })
            await onMutate?.()
            return { text: `Deactivated capsule "${args.capsuleId}" (scope=${args.scope || 'all'}).` }
          }

          if (action === 'learn_fix') {
            const res = await capsuleService.learnProblemFix({
              capsuleId: args.capsuleId,
              tool: args.tool || '*',
              target: args.target || '',
              symptom: args.symptom,
              resolution: args.resolution,
              sourceSessionId: sessionId || '',
            })
            await onMutate?.()
            return {
              text: `Recorded self-healing fix into "${res.capsule.title}" (${res.capsule.capsuleId} v${res.capsule.version}).\n`
                + `Genealogy generations retained: ${res.capsule.workflow?.genealogySummary?.length || 1} (all earlier workflows preserved!).`,
            }
          }

          const cap = await store.readCapsule(args.capsuleId)
          if (!cap) throw new Error(`Experience capsule "${args.capsuleId}" not found.`)

          if (action === 'recall_generation') {
            const targetGen = typeof args.gen === 'number' ? args.gen : 1
            if (args.restore === true) {
              const res = await capsuleService.restoreGeneration({ capsuleId: cap.capsuleId, gen: targetGen })
              await onMutate?.()
              return { text: `Restored Gen ${targetGen} forward into "${res.capsule.title}" v${res.capsule.version} (later experimental generations remain in genealogy).` }
            }
            const gens = Array.isArray(cap.workflow?.genealogy) ? cap.workflow.genealogy : []
            const found = gens.find(g => g.gen === targetGen || g.version === targetGen) || gens[0]
            if (!found) return { text: `Capsule "${cap.capsuleId}" has no stored generation ${targetGen}.` }
            const stepLines = (found.stagesSnapshot || []).flatMap((st, i) =>
              [`Stage ${i + 1} [${st.executionMode}]:`, ...(st.steps || []).map(s => `  - ${s.tool}: ${s.goal}`)],
            )
            return {
              text: `Recalled Non-Forgetting Generation snapshot Gen ${found.gen} (v${found.version}, action=${found.action}, maturity=${found.maturity}):\n`
                + `Reason: ${found.reason}\nMetrics: steps=${found.metrics?.afterSteps ?? '-'}, score=${found.metrics?.afterScore ?? '-'}\n`
                + `${stepLines.join('\n')}`,
            }
          }

          if (action === 'export') {
            return { text: exportCapsuleBundle(cap, args.format || 'skill') }
          }

          if (action === 'import') {
            const res = await capsuleService.importCapsuleBundle(args.bundleJson)
            await onMutate?.()
            return { text: `Imported & verified capsule "${res.capsule.title}" (${res.capsule.capsuleId} v${res.capsule.version}).` }
          }

          if (action === 'get') {
            const gens = (cap.workflow?.genealogySummary || []).map(g => `  - Gen ${g.gen} (v${g.version}, ${g.steps} steps, score=${g.score}): ${g.reason}`)
            const rules = (cap.selfHealing?.rules || []).slice(0, 8).map(r => `  - [${r.tool}] "${r.symptomPattern}" -> ${r.fixSteps}`)
            return {
              text: `${cap.icon} ${cap.title} (${cap.capsuleId} v${cap.version}, maturity=${cap.maturity}, attempts=${cap.attempts}, successes=${cap.successes})\n`
                + `Starter prompt: ${cap.executionPreset?.starterPrompt || ''}\n`
                + `Genealogy (${gens.length} generations retained):\n${gens.join('\n') || '  (none)'}\n`
                + `Self-healing rules (${rules.length}):\n${rules.join('\n') || '  (none)'}`,
            }
          }

          throw new Error(`Unknown flowpack_capsule action "${action}".`)
        },
      })
    : undefined

  const disposeTrainTool = (apprenticeService && typeof tools.register === 'function')
    ? tools.register({
      name: 'flowpack_train',
      description:
        'Interact with FlowPack Watch-and-Train Apprenticeship sessions: inspect captured human demonstration steps & screenshot paths, ask the human clarifying questions during learning/training, propose a better/faster alternative method, and report practice round completion.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['inspect_demo', 'ask_question', 'propose_better_method', 'record_round', 'list'],
            description: 'Apprenticeship training action.',
          },
          trainId: { type: 'string', description: 'Apprenticeship training ID (e.g. train-xxxx).' },
          question: { type: 'string', description: 'Clarifying question to surface immediately to the human.' },
          stepSeq: { type: 'integer', description: 'Optional human demo step sequence related to the question.' },
          reason: { type: 'string', description: 'Reason for question or why the alternative method is better.' },
          proposal: { type: 'string', description: 'Description of a faster/more reliable alternative method.' },
          approach: {
            type: 'string',
            enum: ['followed_demo', 'better_alternative'],
            description: 'Whether this training round followed the demo GUI steps or used a better method.',
          },
          summary: { type: 'string', description: 'Concise summary of what this round did and produced.' },
          toolsUsed: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tools used in this training round.',
          },
          deliverables: {
            type: 'array',
            items: { type: 'string' },
            description: 'Produced file paths or verified outputs for human inspection.',
          },
        },
        required: ['action'],
      },
      execute: async (rawArgs, exec) => {
        const args = rawArgs || {}
        const action = String(args.action || 'list')
        const sessionId = exec?.agent?.session?.id || ''

        if (action === 'list') {
          const items = await store.listApprenticeships()
          const lines = items.slice(0, 12).map(t =>
            `- ${t.trainId} [${t.status}] 「${t.title}」 (${t.demoSteps?.length || 0} demo steps, ${t.rounds?.length || 0} rounds, ${(t.questions || []).filter(q => q.status === 'pending').length} pending Qs)`,
          )
          return { text: lines.length > 0 ? `Apprenticeship trainings:\n${lines.join('\n')}` : 'No human demonstration training sessions yet.' }
        }

        if (!args.trainId) throw new Error(`flowpack_train "${action}" requires "trainId".`)

        if (action === 'inspect_demo') {
          const t = await store.readApprenticeship(args.trainId)
          if (!t) throw new Error(`Training "${args.trainId}" not found.`)
          const stepText = (t.demoSteps || []).map(s =>
            `${s.seq}. [${s.actionType}] ${s.semanticSummary}`
            + `${s.humanNote ? ` (note: ${s.humanNote})` : ''}`
            + `${s.screenshotPath ? ` -> frame: ${s.screenshotPath}` : ''}`,
          ).join('\n')
          const qaText = (t.questions || []).map(q =>
            `- [${q.status}] Q: ${q.question}${q.answer ? ` => A: ${q.answer}` : ''}`,
          ).join('\n')
          const roundText = (t.rounds || []).map(r =>
            `- Round ${r.roundNo} (${r.approach}, ${r.verdict}): ${r.summary}${r.humanNote ? ` | Human feedback: ${r.humanNote}` : ''}`,
          ).join('\n')
          return {
            text: `Training 「${t.title}」 (${t.trainId}, status=${t.status})\n`
              + `Goal: ${t.goal || t.title}\n\n`
              + `Demo steps:\n${stepText || '(none)'}\n\n`
              + `Q&A:\n${qaText || '(none)'}\n\n`
              + `Prior rounds:\n${roundText || '(none)'}`,
          }
        }

        if (action === 'ask_question') {
          const res = await apprenticeService.askQuestion(args.trainId, {
            question: args.question,
            stepSeq: args.stepSeq || 0,
            reason: args.reason || 'AI 训练/学习时实时提问',
            askedBy: 'agent',
          })
          await onMutate?.()
          return {
            text: `已向人类提出实时问题（${res.question.qId}）：「${res.question.question}」。\n`
              + `人类可在 FlowPack 侧边栏「示教训练」卡片直接回答；若问题阻塞核心条件，可顺便在对话里提示用户确认。`,
          }
        }

        if (action === 'propose_better_method') {
          const updated = await apprenticeService.proposeBetterMethod(args.trainId, {
            proposal: args.proposal,
            reason: args.reason || '',
          })
          await onMutate?.()
          return {
            text: `已记录你的更优方法建议到「${updated.title}」：${updated.betterMethodProposal}。可直接按该更优方法完成任务后上报本轮结果供人类查收！`,
          }
        }

        if (action === 'record_round') {
          const res = await apprenticeService.recordRound(args.trainId, {
            sessionId,
            approach: args.approach,
            approachReason: args.reason || '',
            summary: args.summary || '',
            toolsUsed: Array.isArray(args.toolsUsed) ? args.toolsUsed : [],
            deliverables: Array.isArray(args.deliverables) ? args.deliverables : [],
          })
          await onMutate?.()
          return {
            text: `已记录第 ${res.round.roundNo} 轮练习（策略：${res.round.approach === 'better_alternative' ? 'AI 更优方法' : '按示教复现'}）。请向人类展示本轮成果并请用户在 FlowPack 侧边栏「示教训练」中批注或点验收通过！`,
          }
        }

        throw new Error(`Unknown flowpack_train action "${action}".`)
      },
    })
    : undefined

  return () => {
    try { disposeWorkflowTool?.() } catch { /* ignore */ }
    try { disposeMemoryTool?.() } catch { /* ignore */ }
    try { disposeCapsuleTool?.() } catch { /* ignore */ }
    try { disposeTrainTool?.() } catch { /* ignore */ }
  }
}
