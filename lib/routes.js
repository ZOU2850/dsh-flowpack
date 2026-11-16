/**
 * Authenticated HTTP Fetch routes for the FlowPack panel & Settings section.
 * Registered via `connection.fetch.register` so DSH Host/Origin + auth fences apply automatically.
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { compactApprenticeshipSummary } from './apprentice.js'
import { buildCapsuleFromArtifacts, exportCapsuleBundle, resolveActiveCapsules } from './capsule.js'
import { buildMemorySummary, diffPacks, exportPackMarkdown } from './memory-pack.js'
import { discoverPluginCapabilities } from './self-heal.js'
import { buildMacroStages, diffWorkflow } from './workflow.js'

function compactCapsuleForList(cap) {
  if (!cap || typeof cap !== 'object') return cap
  const rawStages = cap.workflow?.stages || []
  const totalRawSteps = cap.workflow?.totalRawSteps
    ?? rawStages.reduce((n, st) => n + (st.steps?.length || 0), 0)
  const macroStages = (cap.workflow?.macroStages?.length > 0)
    ? cap.workflow.macroStages
    : (rawStages.length > 0 ? buildMacroStages(rawStages) : [])
  return {
    schemaVersion: cap.schemaVersion,
    capsuleId: cap.capsuleId,
    slug: cap.slug,
    title: cap.title,
    description: cap.description,
    icon: cap.icon,
    maturity: cap.maturity,
    version: cap.version,
    attempts: cap.attempts,
    successes: cap.successes,
    crystallizeThreshold: cap.crystallizeThreshold,
    confidence: cap.confidence,
    workspaceRoot: cap.workspaceRoot,
    installedPluginHints: cap.installedPluginHints,
    learnedSummary: cap.learnedSummary,
    selfHealing: cap.selfHealing,
    executionPreset: cap.executionPreset,
    createdAt: cap.createdAt,
    updatedAt: cap.updatedAt,
    sealState: cap.sealState,
    integrity: cap.integrity,
    workflow: cap.workflow ? {
      workflowId: cap.workflow.workflowId,
      version: cap.workflow.version,
      metrics: cap.workflow.metrics,
      macroStages,
      genealogySummary: cap.workflow.genealogySummary || [],
      totalRawSteps,
    } : undefined,
  }
}

function compactCapsuleForLite(cap) {
  return {
    capsuleId: cap.capsuleId,
    title: cap.title,
    description: cap.description,
    icon: cap.icon,
    maturity: cap.maturity,
    workspaceRoot: cap.workspaceRoot,
    updatedAt: cap.updatedAt,
    executionPreset: cap.executionPreset,
  }
}

function compactWorkflowForList(wf) {
  if (!wf || typeof wf !== 'object') return wf
  return {
    workflowId: wf.workflowId,
    name: wf.name,
    title: wf.title,
    description: wf.description,
    version: wf.version,
    maturity: wf.maturity,
    promotedAsSkill: wf.promotedAsSkill,
    workspaceRoot: wf.workspaceRoot,
    updatedAt: wf.updatedAt,
    rawStats: wf.rawStats,
    optimized: {
      stages: (wf.optimized?.stages || []).slice(0, 35),
      macroStages: wf.optimized?.macroStages || [],
      guardrails: wf.optimized?.guardrails || [],
      metrics: wf.optimized?.metrics || {},
      diff: wf.optimized?.diff || {},
    },
    genealogySummary: wf.genealogySummary,
  }
}

export const ROUTES = Object.freeze({
  health: '/api/flowpack.health',
  settings: '/api/flowpack.settings',
  sessions: '/api/flowpack.sessions',
  workflows: '/api/flowpack.workflows',
  packs: '/api/flowpack.packs',
  capsules: '/api/flowpack.capsules',
  activate: '/api/flowpack.activate',
  capabilities: '/api/flowpack.capabilities',
  preview: '/api/flowpack.preview-injection',
  train: '/api/flowpack.train',
})

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } })
}

async function readObject(request) {
  let value
  try {
    value = await request.json()
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }
  return value
}

function queryOf(request) {
  return new URL(request.url, 'http://localhost').searchParams
}

/** Register all FlowPack HTTP endpoints on `connection.fetch`. */
export function registerRoutes(ctx, { store, workflowService, memoryService, capsuleService, selfHealEngine, apprenticeService, onMutate }) {
  const connection = ctx.get?.('connection')
  if (!connection?.fetch || typeof connection.fetch.register !== 'function') {
    return () => {}
  }

  const disposers = []
  const register = (path, methods, requestBody, handler) => {
    disposers.push(connection.fetch.register({
      path,
      methods,
      ...(requestBody ? { requestBody } : {}),
      fetch: async (request) => {
        try {
          return await handler(request)
        } catch (error) {
          if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status)
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    }))
  }

  register(ROUTES.health, ['GET'], undefined, async () => {
    const [prefs, workflows, packRes, capRes, activations, quarantine, audit] = await Promise.all([
      store.readPreferences(),
      store.listWorkflows(),
      store.listPacks(),
      store.listCapsules(),
      store.readActivations(),
      store.listQuarantined(20),
      store.readAudit(20),
    ])
    const capList = capRes.capsules || []
    return json({
      ok: true,
      plugin: 'dsh-flowpack',
      version: '2.0.0',
      strictMode: prefs.strictMode,
      counts: {
        workflows: workflows.length,
        promotedSkills: workflows.filter(w => w.promotedAsSkill).length,
        packs: packRes.packs.length,
        sealedPacks: packRes.packs.filter(p => p.sealState === 'sealed').length,
        capsules: capList.length,
        crystallizedCapsules: capList.filter(c => c.maturity === 'crystallized').length,
        activeGlobal: activations.global.length,
        quarantined: quarantine.length,
      },
      auditCount: audit.length,
      paths: store.paths(),
    })
  })

  register(ROUTES.settings, ['GET', 'POST'], 'buffered', async (request) => {
    if (request.method === 'POST') {
      const body = await readObject(request)
      const settings = await store.updatePreferences(body.settings || body)
      await onMutate?.()
      return json({ ok: true, settings, paths: store.paths() })
    }
    const settings = await store.readPreferences()
    return json({ ok: true, settings, paths: store.paths() })
  })

  register(ROUTES.sessions, ['GET'], undefined, async (request) => {
    const sp = queryOf(request)
    const limit = Number(sp.get('limit')) || 30
    const sessions = await workflowService.listSessions({ limit, signal: request.signal })
    return json({ ok: true, sessions })
  })

  register(ROUTES.workflows, ['GET', 'POST'], 'buffered', async (request) => {
    if (request.method === 'GET') {
      const sp = queryOf(request)
      const id = sp.get('workflowId')
      if (id) {
        const workflow = await store.readWorkflow(id)
        if (!workflow) throw new HttpError(404, `Workflow "${id}" not found.`)
        return json({ ok: true, workflow, diff: diffWorkflow(workflow, sp.get('versionA'), sp.get('versionB')) })
      }
      const workflows = await store.listWorkflows()
      return json({
        ok: true,
        workflows: sp.get('summary') === '1' ? workflows.map(compactWorkflowForList) : workflows,
      })
    }

    const body = await readObject(request)
    const action = String(body.action || 'distill')
    if (action === 'distill') {
      if (!body.sessionId) throw new HttpError(400, 'sessionId is required to distill a workflow.')
      const res = await workflowService.distillFromSession({
        sessionId: body.sessionId,
        workflowId: body.workflowId,
        title: body.title,
        name: body.name,
        promote: body.promote,
        signal: request.signal,
      })
      await onMutate?.()
      return json({ ok: true, ...res })
    }
    if (action === 'optimize') {
      const workflow = await workflowService.optimizeWorkflow({
        workflowId: body.workflowId,
        addGuardrail: body.addGuardrail,
        title: body.title,
        promote: body.promote,
      })
      await onMutate?.()
      return json({ ok: true, workflow })
    }
    if (action === 'promote') {
      const workflow = await workflowService.setPromoted(body.workflowId, body.promote !== false)
      await onMutate?.()
      return json({ ok: true, workflow })
    }
    if (action === 'delete') {
      const deleted = await workflowService.deleteWorkflow(body.workflowId)
      await onMutate?.()
      return json({ ok: true, deleted })
    }
    throw new HttpError(400, `Unsupported workflows action "${action}".`)
  })

  register(ROUTES.packs, ['GET', 'POST'], 'buffered', async (request) => {
    if (request.method === 'GET') {
      const sp = queryOf(request)
      const packId = sp.get('packId')
      if (packId) {
        const res = await store.readPack(packId)
        if (!res.pack) throw new HttpError(404, `Memory pack "${packId}" not found.`)
        const archives = await store.listPackArchives(packId)
        const base = archives[archives[0]?.version === res.pack.version ? 1 : 0]
        return json({
          ok: true,
          pack: res.pack,
          memorySummary: buildMemorySummary(res.pack),
          archives,
          markdown: exportPackMarkdown(res.pack),
          diff: base ? diffPacks(base, res.pack) : null,
        })
      }
      const [packList, quarantined, audit] = await Promise.all([
        store.listPacks(),
        store.listQuarantined(20),
        store.readAudit(30),
      ])
      return json({
        ok: true,
        packs: packList.packs.map(p => ({ ...p, memorySummary: p.memorySummary || buildMemorySummary(p) })),
        corrupt: packList.corrupt,
        quarantined,
        audit,
      })
    }

    const body = await readObject(request)
    const action = String(body.action || 'verify')

    if (action === 'pack') {
      const res = await memoryService.packFromSession({
        sessionId: body.sessionId,
        packId: body.packId,
        title: body.title,
        scope: body.scope,
        seal: body.seal !== false,
        signal: request.signal,
      })
      await onMutate?.()
      return json({ ok: true, ...res })
    }
    if (action === 'pin') {
      const res = await memoryService.pinEntry({
        packId: body.packId,
        title: body.title,
        scope: body.scope,
        workspaceRoot: body.workspaceRoot || body.cwd,
        sessionId: body.sessionId,
        section: body.section || 'facts',
        text: body.text,
        priority: body.priority || 'high',
        sourceType: body.sourceType || 'user',
        sourceRef: body.sourceRef,
        tags: body.tags,
        seal: body.seal,
      })
      await onMutate?.()
      return json({ ok: true, ...res })
    }
    if (action === 'seal') {
      const res = await memoryService.sealExistingPack(body.packId)
      await onMutate?.()
      return json({ ok: true, ...res })
    }
    if (action === 'verify') {
      const report = await memoryService.verifyAll({
        packId: body.packId,
        sessionId: body.sessionId,
        cwd: body.cwd || '',
        quarantineOnTamper: body.quarantineOnTamper !== false,
      })
      await onMutate?.()
      return json({ ok: true, report })
    }
    if (action === 'rollback') {
      const pack = await memoryService.rollbackPack(body.packId, body.version)
      await onMutate?.()
      return json({ ok: true, pack })
    }
    if (action === 'import') {
      const res = await memoryService.importBundle(body.bundle ?? body.bundleJson)
      await onMutate?.()
      return json({ ok: true, ...res })
    }
    if (action === 'delete') {
      const deleted = await store.deletePack(body.packId)
      await onMutate?.()
      return json({ ok: true, deleted })
    }
    throw new HttpError(400, `Unsupported packs action "${action}".`)
  })

  if (capsuleService) {
    register(ROUTES.capsules, ['GET', 'POST'], 'buffered', async (request) => {
      if (request.method === 'GET') {
        const sp = queryOf(request)
        const capsuleId = sp.get('capsuleId')
        if (capsuleId) {
          const cap = await store.readCapsule(capsuleId)
          if (!cap) throw new HttpError(404, `Experience capsule "${capsuleId}" not found.`)
          const format = sp.get('format')
          if (format) {
            return json({ ok: true, capsuleId, format, exported: exportCapsuleBundle(cap, format) })
          }
          const includeExports = sp.get('includeExports') === '1'
          return json({
            ok: true,
            capsule: cap,
            ...(includeExports ? {
              exports: {
                skill: exportCapsuleBundle(cap, 'skill'),
                agentsMd: exportCapsuleBundle(cap, 'agents_md'),
                ptc: exportCapsuleBundle(cap, 'ptc'),
                markdown: exportCapsuleBundle(cap, 'markdown'),
                dshcapsule: exportCapsuleBundle(cap, 'dshcapsule'),
              },
            } : {}),
          })
        }
        const [capRes, activations] = await Promise.all([store.listCapsules(), store.readActivations()])
        const summaryOnly = sp.get('summary') === '1'
        return json({
          ok: true,
          capsules: summaryOnly ? capRes.capsules.map(compactCapsuleForList) : capRes.capsules,
          corrupt: capRes.corrupt,
          activations,
        })
      }

      const body = await readObject(request)
      const action = String(body.action || 'learn')
      if (action === 'learn') {
        if (!body.sessionId) throw new HttpError(400, 'sessionId is required to learn an experience capsule.')
        const res = await capsuleService.learnFromSession({
          sessionId: body.sessionId,
          capsuleId: body.capsuleId,
          workflowId: body.workflowId,
          title: body.title,
          name: body.name,
          crystallize: Boolean(body.crystallize),
          scope: body.scope,
          activate: Boolean(body.activate),
          activateScope: body.activateScope,
          signal: request.signal,
        })
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'crystallize') {
        if (body.sessionId && !body.capsuleId) {
          const res = await capsuleService.learnFromSession({
            sessionId: body.sessionId,
            title: body.title,
            crystallize: true,
            activate: body.activate !== false,
            activateScope: body.scope,
            signal: request.signal,
          })
          await onMutate?.()
          return json({ ok: true, ...res })
        }
        const cap = await store.readCapsule(body.capsuleId)
        if (!cap) throw new HttpError(404, `Capsule "${body.capsuleId}" not found.`)
        const wf = await store.readWorkflow(cap.workflow?.workflowId)
        if (!wf) throw new HttpError(404, `Workflow for capsule "${body.capsuleId}" not found.`)
        const nextWf = { ...wf, maturity: 'crystallized', updatedAt: Date.now() }
        await store.saveWorkflow(nextWf)
        const updated = buildCapsuleFromArtifacts({ workflow: nextWf, existingCapsule: cap, crystallize: true })
        await store.saveCapsule(updated)
        if (body.activate !== false) {
          await capsuleService.activateCapsule({
            capsuleId: updated.capsuleId,
            scope: body.scope || (updated.workspaceRoot ? 'workspace' : 'global'),
            sessionId: body.sessionId || '',
            cwd: updated.workspaceRoot || body.cwd || '',
          })
        }
        await onMutate?.()
        return json({ ok: true, capsule: updated })
      }
      if (action === 'learn_fix') {
        const res = await capsuleService.learnProblemFix({
          capsuleId: body.capsuleId,
          tool: body.tool || '*',
          target: body.target || '',
          symptom: body.symptom,
          resolution: body.resolution,
          sourceSessionId: body.sessionId || '',
        })
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'restore_gen') {
        const res = await capsuleService.restoreGeneration({
          capsuleId: body.capsuleId,
          gen: Number(body.gen),
        })
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'rename') {
        const capsule = await capsuleService.renameCapsule({
          capsuleId: body.capsuleId,
          title: body.title,
        })
        await onMutate?.()
        return json({ ok: true, capsule })
      }
      if (action === 'import') {
        const res = await capsuleService.importCapsuleBundle(body.bundle ?? body.bundleJson)
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'delete') {
        await capsuleService.deactivateCapsule({ capsuleId: body.capsuleId, scope: 'all' })
        const deleted = await store.deleteCapsule(body.capsuleId)
        await onMutate?.()
        return json({ ok: true, deleted })
      }
      throw new HttpError(400, `Unsupported capsules action "${action}".`)
    })

    register(ROUTES.activate, ['GET', 'POST'], 'buffered', async (request) => {
      if (request.method === 'GET') {
        const sp = queryOf(request)
        const sessionId = sp.get('sessionId') || ''
        const parentSessionId = sp.get('parentSessionId') || ''
        const isSubagent = sp.get('isSubagent') === 'true'
        const cwd = sp.get('cwd') || ''
        const [prefs, capRes, activations] = await Promise.all([
          store.readPreferences(),
          store.listCapsules(),
          store.readActivations(),
        ])
        const activeInfo = resolveActiveCapsules({
          activations,
          capsules: capRes.capsules,
          sessionId,
          parentSessionId,
          isSubagent,
          cwd,
          subagentInheritance: prefs.subagentInheritance !== false,
        })
        const isLite = sp.get('lite') === '1'
        return json({
          ok: true,
          capsules: isLite ? capRes.capsules.map(compactCapsuleForLite) : capRes.capsules,
          activations,
          resolved: activeInfo.resolved.map(r => ({
            capsuleId: r.capsule.capsuleId,
            title: r.capsule.title,
            icon: r.capsule.icon,
            maturity: r.capsule.maturity,
            version: r.capsule.version,
            activationScope: r.activationScope,
            inheritedFrom: r.inheritedFrom || null,
            preset: r.preset,
            starterPrompt: r.capsule.executionPreset?.starterPrompt || '',
            rulesCount: r.capsule.selfHealing?.rules?.length || 0,
            gensCount: r.capsule.workflow?.genealogySummary?.length || 1,
          })),
          quarantined: activeInfo.quarantined,
        })
      }

      const body = await readObject(request)
      const action = String(body.action || 'activate')
      const sessionId = body.sessionId || ''
      const cwd = body.cwd || ''
      let activations
      if (action === 'deactivate') {
        activations = await capsuleService.deactivateCapsule({
          capsuleId: body.capsuleId,
          scope: body.scope || 'all',
          sessionId,
          cwd,
        })
      } else if (action === 'toggle') {
        const cur = await store.readActivations()
        const targetScope = body.scope || 'workspace'
        const isActive = (
          (targetScope === 'global' && cur.global.some(x => x.capsuleId === body.capsuleId))
          || (targetScope === 'session' && (cur.sessions[sessionId] || []).some(x => x.capsuleId === body.capsuleId))
          || (targetScope === 'workspace' && Object.values(cur.workspaces).some(list => list.some(x => x.capsuleId === body.capsuleId)))
        )
        if (isActive) {
          activations = await capsuleService.deactivateCapsule({ capsuleId: body.capsuleId, scope: targetScope, sessionId, cwd })
        } else {
          activations = await capsuleService.activateCapsule({
            capsuleId: body.capsuleId,
            scope: targetScope,
            sessionId,
            cwd,
            preset: body.preset || 'direct',
            inheritSubagents: body.inheritSubagents !== false,
          })
        }
      } else {
        activations = await capsuleService.activateCapsule({
          capsuleId: body.capsuleId,
          scope: body.scope || 'workspace',
          sessionId,
          cwd,
          preset: body.preset || 'direct',
          inheritSubagents: body.inheritSubagents !== false,
        })
      }
      await onMutate?.()
      return json({ ok: true, activations })
    })
  }

  register(ROUTES.capabilities, ['GET'], undefined, async () => {
    const capabilities = discoverPluginCapabilities(ctx)
    const healEvents = selfHealEngine ? selfHealEngine.getRecentEvents(20) : []
    return json({ ok: true, capabilities, healEvents })
  })

  register(ROUTES.preview, ['GET'], undefined, async (request) => {
    const sp = queryOf(request)
    const sessionId = sp.get('sessionId') || ''
    const parentSessionId = sp.get('parentSessionId') || ''
    const isSubagent = sp.get('isSubagent') === 'true'
    const cwd = sp.get('cwd') || ''
    const [prefs, capRes, activations] = await Promise.all([
      store.readPreferences(),
      store.listCapsules(),
      store.readActivations(),
    ])
    const activeInfo = resolveActiveCapsules({
      activations,
      capsules: capRes.capsules,
      sessionId,
      parentSessionId,
      isSubagent,
      cwd,
      subagentInheritance: prefs.subagentInheritance !== false,
    })
    const injection = await memoryService.compileForContext({
      sessionId,
      parentSessionId,
      isSubagent,
      cwd,
      activeCapsules: activeInfo.resolved,
      quarantinedCapsules: activeInfo.quarantined,
    })
    return json({ ok: true, injection })
  })

  if (apprenticeService) {
    register(ROUTES.train, ['GET', 'POST'], 'buffered', async (request) => {
      if (request.method === 'GET') {
        const sp = queryOf(request)
        if (sp.get('frame') === '1') {
          const trainId = sp.get('trainId') || ''
          const file = sp.get('file') || ''
          if (!trainId || !file || basename(file) !== file || !/^step-\d{1,5}\.jpg$/i.test(file)) {
            throw new HttpError(400, 'Invalid frame filename.')
          }
          const full = join(store.apprenticeshipFramesDir(trainId), file)
          try {
            const bytes = await readFile(full)
            return new Response(bytes, {
              status: 200,
              headers: {
                'content-type': 'image/jpeg',
                'cache-control': 'private, max-age=3600',
              },
            })
          } catch {
            throw new HttpError(404, 'Screenshot frame not found.')
          }
        }

        const trainId = sp.get('trainId')
        if (trainId) {
          const training = await store.readApprenticeship(trainId)
          if (!training) throw new HttpError(404, 'Training session not found.')
          return json({ ok: true, training })
        }

        const items = await store.listApprenticeships()
        return json({
          ok: true,
          supported: apprenticeService.watchDriver?.isSupported?.() ?? true,
          activeWatchTrainId: apprenticeService.activeWatchTrainId || '',
          trainings: items.map(compactApprenticeshipSummary),
        })
      }

      const body = await readObject(request)
      const action = String(body.action || '')

      if (action === 'start_watch') {
        const res = await apprenticeService.startWatch({
          trainId: body.trainId,
          title: body.title || '',
          goal: body.goal || '',
          cwd: body.cwd || '',
          sessionId: body.sessionId || '',
          autoQuestion: body.autoQuestion !== false,
        })
        await onMutate?.()
        return json({ ok: true, ...res })
      }

      if (!body.trainId) throw new HttpError(400, 'trainId is required.')

      if (action === 'capture_now') {
        const res = await apprenticeService.captureNow(body.trainId)
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'stop_watch') {
        const training = await apprenticeService.stopWatch(body.trainId)
        await onMutate?.()
        return json({ ok: true, training })
      }
      if (action === 'add_step') {
        const res = await apprenticeService.addManualStep(body.trainId, body)
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'delete_step') {
        const training = await apprenticeService.deleteDemoStep(body.trainId, body.stepSeq)
        await onMutate?.()
        return json({ ok: true, training })
      }
      if (action === 'step_note') {
        const training = await apprenticeService.annotateDemoStep(body.trainId, body.stepSeq, body.note)
        await onMutate?.()
        return json({ ok: true, training })
      }
      if (action === 'ai_review') {
        const res = await apprenticeService.reviewWithLlm(body.trainId, { force: true })
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'ask_question') {
        const res = await apprenticeService.askQuestion(body.trainId, body)
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'answer_question') {
        const res = await apprenticeService.answerQuestion(body.trainId, body.qId, body.answer, { skip: body.skip === true })
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'prepare_round') {
        const res = await apprenticeService.prepareTrainingRound(body.trainId, body)
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'record_round') {
        let res = null
        if (body.sessionId && !body.summary && (!Array.isArray(body.toolsUsed) || body.toolsUsed.length === 0)) {
          const linked = apprenticeService.getLinkedSessionInfo?.(body.sessionId)
          const baseline = linked?.trainId === body.trainId ? linked.baselineEventCount : 0
          res = await apprenticeService.recordRoundFromSession(body.trainId, {
            sessionId: body.sessionId,
            baselineEventCount: baseline,
          })
        }
        if (!res) {
          res = await apprenticeService.recordRound(body.trainId, body)
        }
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'propose_better_method') {
        const training = await apprenticeService.proposeBetterMethod(body.trainId, body)
        await onMutate?.()
        return json({ ok: true, training })
      }
      if (action === 'annotate_round') {
        const res = await apprenticeService.annotateRound(body.trainId, body.roundNo, body)
        let nextPrep = null
        if (body.prepareNext === true) {
          nextPrep = await apprenticeService.prepareTrainingRound(body.trainId, {
            sessionId: body.sessionId || '',
            cwd: body.cwd || '',
            feedbackNote: body.note || '',
            mode: body.verdict === 'needs_fix' ? 'fix' : 'practice',
          })
        }
        await onMutate?.()
        return json({
          ok: true,
          training: nextPrep?.training || res.training,
          round: res.round,
          nextPrompt: nextPrep?.prompt || '',
        })
      }
      if (action === 'graduate') {
        const res = await apprenticeService.graduateTraining(body.trainId, body)
        await onMutate?.()
        return json({ ok: true, ...res })
      }
      if (action === 'rename') {
        const training = await store.readApprenticeship(body.trainId)
        if (!training) throw new HttpError(404, 'Training session not found.')
        training.title = String(body.title || '').trim() || training.title
        training.updatedAt = Date.now()
        await store.saveApprenticeship(training)
        await onMutate?.()
        return json({ ok: true, training })
      }
      if (action === 'delete') {
        if (apprenticeService.activeWatchTrainId === body.trainId) {
          await apprenticeService.stopWatch(body.trainId).catch(() => {})
        }
        const deleted = await store.deleteApprenticeship(body.trainId)
        await onMutate?.()
        return json({ ok: true, deleted })
      }
      throw new HttpError(400, `Unknown train action "${action}".`)
    })
  }

  return () => {
    for (const d of disposers) {
      try { d?.() } catch { /* ignore */ }
    }
  }
}
