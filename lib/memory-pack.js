/**
 * Strict Memory Packaging, Cryptographic Sealing, Integrity Verification, Scope Isolation,
 * Compaction Survival, and Context Injection Compiler for dsh-flowpack.
 */

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { isSystemNoiseMessage, normalizeSessionTrace, readSessionSnapshot } from './session-trace.js'
import { DEFAULT_PREFERENCES } from './store.js'
import {
  canonicalJson,
  clampInt,
  isSameWorkspace,
  normalizeWorkspaceRoot,
  redactSecrets,
  scanSecrets,
  sha256Hex,
  slugifyId,
  truncateText,
} from './util.js'

export const MEMORY_SCHEMA_VERSION = '1.0.0'
export const MEMORY_SECTIONS = Object.freeze([
  'constraints',
  'facts',
  'decisions',
  'pitfalls',
  'workflows',
  'checkpoints',
])

const SECTION_LABELS = {
  constraints: '硬性约束与边界 (Constraints)',
  facts: '已验证事实与路径 (Verified Facts)',
  decisions: '关键架构决策 (Decisions)',
  pitfalls: '历史踩坑与修复 (Pitfalls & Fixes)',
  workflows: '绑定优化工作流 (Linked Workflows)',
  checkpoints: '交接点与下一步 (Checkpoints)',
}

const VALID_SCOPES = new Set(['session', 'workspace', 'global', 'workflow'])
const VALID_PRIORITIES = new Set(['critical', 'high', 'normal'])
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2 }

/** Create empty section buckets object. */
export function emptySections() {
  return {
    constraints: [],
    facts: [],
    decisions: [],
    pitfalls: [],
    workflows: [],
    checkpoints: [],
  }
}

/** Normalize one candidate entry cleanly while preserving strict provenance & redaction rules. */
function normalizeEntry(raw, section, { strictMode, redactMode, maxEntryChars }) {
  const errors = []
  const warnings = []
  if (!raw || typeof raw !== 'object') {
    errors.push(`${section}: entry must be an object`)
    return { errors, warnings, entry: null }
  }
  let text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text.length === 0) {
    errors.push(`${section}: entry text cannot be empty`)
    return { errors, warnings, entry: null }
  }

  // Secret hygiene check
  const findings = scanSecrets(text)
  if (findings.length > 0) {
    if (redactMode === 'reject') {
      errors.push(`${section}: secret pattern detected (${findings[0].rule}) and strict secret rejection is enabled`)
      return { errors, warnings, entry: null }
    }
    if (redactMode === 'mask') {
      const masked = redactSecrets(text)
      text = masked.text
      warnings.push(`${section}: masked ${masked.redactedCount} secret pattern(s)`)
    }
  }

  if (text.length > maxEntryChars) {
    if (strictMode && raw.enforceExactLength === true) {
      errors.push(`${section}: entry length ${text.length} exceeds maxEntryChars (${maxEntryChars})`)
      return { errors, warnings, entry: null }
    }
    text = truncateText(text, maxEntryChars)
    warnings.push(`${section}: entry truncated to ${maxEntryChars} chars`)
  }

  const provRaw = raw.provenance
  const hasValidProvenance = provRaw
    && typeof provRaw === 'object'
    && typeof provRaw.sourceType === 'string'
    && provRaw.sourceType.trim().length > 0
    && typeof provRaw.ref === 'string'
    && provRaw.ref.trim().length > 0

  if (strictMode && !hasValidProvenance) {
    errors.push(`${section}: strict mode requires provenance ({ sourceType, ref }) on "${truncateText(text, 40)}"`)
    return { errors, warnings, entry: null }
  }

  const priority = VALID_PRIORITIES.has(raw.priority)
    ? raw.priority
    : (section === 'constraints' ? 'critical' : section === 'pitfalls' || section === 'decisions' ? 'high' : 'normal')

  const confidenceNum = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, Number(raw.confidence.toFixed(2))))
    : 1

  return {
    errors,
    warnings,
    entry: {
      id: typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : `${section.slice(0, 3)}-${sha256Hex(`${section}:${text}`).slice(0, 8)}`,
      text,
      priority,
      pinned: typeof raw.pinned === 'boolean' ? raw.pinned : (priority === 'critical' || section === 'constraints' || section === 'checkpoints'),
      confidence: confidenceNum,
      tags: Array.isArray(raw.tags)
        ? [...new Set(raw.tags.map(t => String(t).trim()).filter(Boolean))].slice(0, 8)
        : [],
      ...(typeof raw.supersedes === 'string' && raw.supersedes.trim() ? { supersedes: raw.supersedes.trim() } : {}),
      provenance: hasValidProvenance
        ? {
            sourceType: provRaw.sourceType.trim(),
            ref: truncateText(provRaw.ref, 180),
            recordedAt: typeof provRaw.recordedAt === 'number' ? provRaw.recordedAt : Date.now(),
          }
        : {
            sourceType: 'manual',
            ref: 'unverified-draft',
            recordedAt: Date.now(),
          },
    },
  }
}

/** Extract the exact canonical payload covered by `sha256` sealing. */
export function canonicalPackPayload(pack) {
  return {
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    title: pack.title,
    version: pack.version,
    scope: pack.scope,
    workspaceRoot: pack.workspaceRoot || '',
    sourceSessionIds: Array.isArray(pack.sourceSessionIds) ? pack.sourceSessionIds : [],
    budget: pack.budget,
    entries: pack.entries,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
  }
}

/** Measure total text characters across all sections of a pack. */
export function measurePackChars(pack) {
  let chars = 0
  const entries = pack?.entries || {}
  for (const section of MEMORY_SECTIONS) {
    for (const item of Array.isArray(entries[section]) ? entries[section] : []) {
      chars += String(item?.text || '').length
    }
  }
  return chars
}

/** Detect potential conflicts or superseded items across entries in the same section. */
export function detectPackConflicts(entries) {
  const conflicts = []
  const supersededIds = new Set()
  for (const section of MEMORY_SECTIONS) {
    for (const item of entries[section] || []) {
      if (item.supersedes) supersededIds.add(item.supersedes)
    }
  }
  for (const section of MEMORY_SECTIONS) {
    const list = entries[section] || []
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i].text.toLowerCase()
        const b = list[j].text.toLowerCase()
        if ((a.includes('不要') && b.includes('必须')) || (a.includes('never') && b.includes('always'))) {
          conflicts.push({
            section,
            entryIds: [list[i].id, list[j].id],
            reason: 'Potential directive polarity tension (always vs never)',
          })
        }
      }
    }
  }
  return { conflicts, supersededCount: supersededIds.size }
}

/**
 * Strictly validate, normalize, deduplicate, redact, and budget-check a memory pack.
 * Returns `{ ok, pack, errors, warnings, stats }`.
 */
export function validateAndNormalizePack(rawInput, preferences = DEFAULT_PREFERENCES) {
  const prefs = { ...DEFAULT_PREFERENCES, ...(preferences || {}) }
  const errors = []
  const warnings = []

  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return { ok: false, pack: null, errors: ['Memory pack must be a JSON object.'], warnings: [], stats: {} }
  }

  const schemaVersion = rawInput.schemaVersion || MEMORY_SCHEMA_VERSION
  if (schemaVersion !== MEMORY_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion "${schemaVersion}"; expected "${MEMORY_SCHEMA_VERSION}".`)
  }

  const title = truncateText(rawInput.title || '', 90)
  if (!title) errors.push('Pack "title" must be a non-empty string.')

  const scope = VALID_SCOPES.has(rawInput.scope) ? rawInput.scope : prefs.defaultScope
  if (rawInput.scope !== undefined && !VALID_SCOPES.has(rawInput.scope)) {
    errors.push(`Invalid scope "${rawInput.scope}". Must be one of session|workspace|global|workflow.`)
  }

  const workspaceRoot = normalizeWorkspaceRoot(rawInput.workspaceRoot || '')
  if (scope === 'workspace' && !workspaceRoot) {
    errors.push('Scope "workspace" strictly requires a non-empty "workspaceRoot" directory path.')
  }

  const sourceSessionIds = Array.isArray(rawInput.sourceSessionIds)
    ? [...new Set(rawInput.sourceSessionIds.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 30)
    : []
  if (scope === 'session' && sourceSessionIds.length === 0) {
    errors.push('Scope "session" strictly requires at least one sourceSessionId.')
  }

  const budgetInput = rawInput.budget && typeof rawInput.budget === 'object' ? rawInput.budget : {}
  const budget = {
    maxTotalChars: clampInt(budgetInput.maxTotalChars, 500, 32000, prefs.maxTotalPackChars),
    maxEntryChars: clampInt(budgetInput.maxEntryChars, 80, 2000, prefs.maxEntryChars),
    maxEntriesPerSection: clampInt(budgetInput.maxEntriesPerSection, 2, 100, prefs.maxEntriesPerSection),
  }

  const strictMode = typeof rawInput.strictMode === 'boolean' ? rawInput.strictMode : prefs.strictMode
  const redactMode = prefs.redactSecrets || 'mask'

  const entries = emptySections()
  const rawEntries = rawInput.entries && typeof rawInput.entries === 'object' ? rawInput.entries : {}
  let totalEntries = 0
  let totalChars = 0

  for (const section of MEMORY_SECTIONS) {
    const list = Array.isArray(rawEntries[section]) ? rawEntries[section] : []
    const seenTexts = new Set()
    const seenIds = new Set()
    const normalizedSection = []

    for (const candidate of list) {
      const res = normalizeEntry(candidate, section, {
        strictMode,
        redactMode,
        maxEntryChars: budget.maxEntryChars,
      })
      errors.push(...res.errors)
      warnings.push(...res.warnings)
      if (!res.entry) continue

      const dedupKey = res.entry.text.toLowerCase()
      if (seenTexts.has(dedupKey)) {
        warnings.push(`${section}: deduplicated identical entry "${truncateText(res.entry.text, 40)}"`)
        continue
      }
      seenTexts.add(dedupKey)

      if (seenIds.has(res.entry.id)) {
        res.entry.id = `${res.entry.id}-${randomUUID().slice(0, 4)}`
      }
      seenIds.add(res.entry.id)
      normalizedSection.push(res.entry)
    }

    // Remove entries explicitly superseded by a newer entry in the same section
    const superseded = new Set(normalizedSection.map(e => e.supersedes).filter(Boolean))
    const filtered = normalizedSection.filter(e => !superseded.has(e.id))
    if (filtered.length < normalizedSection.length) {
      warnings.push(`${section}: pruned ${normalizedSection.length - filtered.length} superseded entry/entries`)
    }

    // Sort by pinned + priority rank before capping section length
    filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
    })

    if (filtered.length > budget.maxEntriesPerSection) {
      if (strictMode && rawInput.rejectOverBudget === true) {
        errors.push(`${section}: ${filtered.length} entries exceed maxEntriesPerSection (${budget.maxEntriesPerSection})`)
      } else {
        warnings.push(`${section}: capped from ${filtered.length} to maxEntriesPerSection=${budget.maxEntriesPerSection}`)
      }
      entries[section] = filtered.slice(0, budget.maxEntriesPerSection)
    } else {
      entries[section] = filtered
    }

    totalEntries += entries[section].length
    for (const item of entries[section]) totalChars += item.text.length
  }

  if (totalChars > budget.maxTotalChars) {
    errors.push(`Total pack text (${totalChars} chars) exceeds strict budget.maxTotalChars (${budget.maxTotalChars}). Prune or raise budget before sealing.`)
  }
  if (strictMode && totalEntries === 0) {
    errors.push('Strict mode rejects empty memory packs (must contain at least 1 validated entry).')
  }

  const conflictReport = detectPackConflicts(entries)
  if (conflictReport.conflicts.length > 0) {
    warnings.push(`Detected ${conflictReport.conflicts.length} potential directive tension(s); verify manually.`)
  }

  const now = Date.now()
  const packId = typeof rawInput.packId === 'string' && /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(rawInput.packId.trim())
    ? rawInput.packId.trim()
    : `pack-${slugifyId(title, 'mem')}-${sha256Hex(`${scope}:${workspaceRoot}:${title}`).slice(0, 6)}`

  const pack = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    packId,
    title,
    version: clampInt(rawInput.version, 1, 1_000_000, 1),
    scope,
    workspaceRoot,
    sourceSessionIds,
    sealState: rawInput.sealState === 'sealed' ? 'sealed' : 'draft',
    compactionSurvival: rawInput.compactionSurvival !== false,
    budget,
    entries,
    createdAt: typeof rawInput.createdAt === 'number' ? rawInput.createdAt : now,
    updatedAt: typeof rawInput.updatedAt === 'number' ? rawInput.updatedAt : now,
    integrity: rawInput.integrity && typeof rawInput.integrity === 'object' ? rawInput.integrity : null,
  }

  return {
    ok: errors.length === 0,
    pack,
    errors,
    warnings,
    stats: {
      totalEntries,
      totalChars,
      budgetPct: Math.round((totalChars / budget.maxTotalChars) * 100),
      conflicts: conflictReport.conflicts,
    },
  }
}

/**
 * Cryptographically seal a validated pack with canonical SHA-256 integrity metadata.
 * Throws if strict validation fails.
 */
export function sealPack(rawInput, preferences = DEFAULT_PREFERENCES) {
  const now = Date.now()
  const preparedInput = {
    ...(rawInput || {}),
    updatedAt: now,
    sealState: 'sealed',
  }
  const validation = validateAndNormalizePack(preparedInput, { ...preferences, strictMode: true })
  if (!validation.ok) {
    const err = new Error(`Strict memory seal rejected:\n- ${validation.errors.join('\n- ')}`)
    err.validationErrors = validation.errors
    throw err
  }
  const pack = validation.pack
  const canonical = canonicalPackPayload(pack)
  const canonicalText = canonicalJson(canonical)
  const sha256 = sha256Hex(canonicalText)

  pack.sealState = 'sealed'
  pack.integrity = {
    algorithm: 'sha256',
    sha256,
    canonicalBytes: Buffer.byteLength(canonicalText, 'utf8'),
    sealedAt: now,
  }

  return {
    pack,
    warnings: validation.warnings,
    stats: validation.stats,
  }
}

/**
 * Strictly verify an existing memory pack's schema, SHA-256 digest, secret hygiene, and scope isolation.
 */
export function verifyPack(pack, context = {}) {
  if (!pack || typeof pack !== 'object') {
    return {
      ok: false,
      tampered: true,
      validIntegrity: false,
      scopeAllowed: false,
      errors: ['Pack is missing or malformed JSON.'],
      warnings: [],
    }
  }

  const schemaCheck = validateAndNormalizePack(pack, {
    ...DEFAULT_PREFERENCES,
    ...(context.preferences || {}),
    strictMode: pack.sealState === 'sealed' ? true : (context.strictMode ?? true),
    redactSecrets: 'off', // Verify must inspect raw text without altering it
  })

  const errors = [...schemaCheck.errors]
  const warnings = [...schemaCheck.warnings]

  // Check raw secret leaks during verification
  let secretHits = 0
  for (const section of MEMORY_SECTIONS) {
    for (const item of Array.isArray(pack.entries?.[section]) ? pack.entries[section] : []) {
      const found = scanSecrets(item?.text || '')
      if (found.length > 0) secretHits += found.length
    }
  }
  if (secretHits > 0) {
    warnings.push(`Found ${secretHits} potential credential/secret pattern(s); re-pack with mask mode.`)
  }

  // Cryptographic integrity check for sealed packs
  let tampered = false
  let validIntegrity = true
  let computedSha256 = ''
  const expectedSha256 = pack.integrity?.sha256 || ''

  if (pack.sealState === 'sealed') {
    if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      validIntegrity = false
      tampered = true
      errors.push('Sealed pack is missing a valid 64-char SHA-256 integrity digest.')
    } else {
      computedSha256 = sha256Hex(canonicalJson(canonicalPackPayload(pack)))
      if (computedSha256 !== expectedSha256.toLowerCase()) {
        validIntegrity = false
        tampered = true
        errors.push(`SHA-256 integrity mismatch! Expected ${expectedSha256}, got ${computedSha256}. Content may be tampered or corrupted.`)
      }
    }
  } else {
    computedSha256 = sha256Hex(canonicalJson(canonicalPackPayload(pack)))
    validIntegrity = null // draft (unsealed)
  }

  // Scope isolation check (only evaluated when cwd/sessionId context is provided)
  let scopeAllowed = true
  let scopeReason = ''
  if (context.enforceScope === true) {
    if (pack.scope === 'workspace') {
      if (!context.cwd || !isSameWorkspace(pack.workspaceRoot, context.cwd)) {
        scopeAllowed = false
        scopeReason = `Workspace mismatch (pack=${pack.workspaceRoot || 'none'}, active=${context.cwd || 'none'})`
      }
    } else if (pack.scope === 'session') {
      if (!context.sessionId || !Array.isArray(pack.sourceSessionIds) || !pack.sourceSessionIds.includes(context.sessionId)) {
        scopeAllowed = false
        scopeReason = `Session mismatch (active=${context.sessionId || 'none'})`
      }
    } else if (pack.scope === 'workflow') {
      if (pack.workspaceRoot && context.cwd && !isSameWorkspace(pack.workspaceRoot, context.cwd)) {
        scopeAllowed = false
        scopeReason = `Workflow pack bound to different workspace (${pack.workspaceRoot})`
      }
    }
  }

  return {
    ok: errors.length === 0 && !tampered,
    packId: pack.packId,
    version: pack.version,
    sealState: pack.sealState,
    tampered,
    validIntegrity,
    expectedSha256,
    computedSha256,
    scopeAllowed,
    scopeReason,
    totalChars: measurePackChars(pack),
    errors,
    warnings,
  }
}

/**
 * Deterministically harvest candidate strict memory entries from a normalized DSH session trace
 * plus any distilled workflows linked to that session or workspace.
 */
export function collectCandidatesFromTrace(trace, linkedWorkflows = []) {
  const entries = emptySections()
  const now = Date.now()
  const sessionId = trace.sessionId

  // 1. User constraints
  for (const c of (trace.constraintCandidates || []).slice(0, 8)) {
    entries.constraints.push({
      text: c.text,
      priority: 'critical',
      pinned: true,
      confidence: 0.95,
      tags: ['user-directive'],
      provenance: { sourceType: 'session-event', ref: `${sessionId}#seq=${c.seq}`, recordedAt: c.time || now },
    })
  }

  // 2. Verified workspace & file facts
  if (trace.cwd) {
    entries.facts.push({
      text: `项目工作区根目录: ${trace.cwd}`,
      priority: 'high',
      pinned: true,
      confidence: 1,
      tags: ['workspace'],
      provenance: { sourceType: 'session-event', ref: `${sessionId}#header.cwd`, recordedAt: trace.createdAt || now },
    })
  }

  const modified = (trace.touchedFiles || []).filter(f => f.writes > 0).slice(0, 8)
  for (const file of modified) {
    entries.facts.push({
      text: `已创建/修改关键文件: ${file.path} (写入 ${file.writes} 次, 读取 ${file.reads} 次)`,
      priority: 'high',
      pinned: false,
      confidence: 1,
      tags: ['modified-file'],
      provenance: { sourceType: 'tool-result', ref: `${sessionId}#seq=${file.lastSeq}`, recordedAt: now },
    })
  }

  for (const cmd of (trace.verificationCommands || []).slice(0, 6)) {
    if (cmd.passed) {
      entries.facts.push({
        text: `已验证通过的检查/测试命令: \`${cmd.command}\``,
        priority: 'high',
        pinned: true,
        confidence: 1,
        tags: ['verified-command'],
        provenance: { sourceType: 'tool-result', ref: `${sessionId}#seq=${cmd.resultSeq}`, recordedAt: now },
      })
    } else {
      entries.pitfalls.push({
        text: `失败命令 \`${cmd.command}\` → 输出摘要: ${cmd.summary || '返回非零或错误'}`,
        priority: 'high',
        pinned: true,
        confidence: 1,
        tags: ['command-failure'],
        provenance: { sourceType: 'tool-result', ref: `${sessionId}#seq=${cmd.resultSeq}`, recordedAt: now },
      })
    }
  }

  // 3. Tool failure pitfalls & guardrails
  for (const fail of (trace.failures || []).slice(0, 8)) {
    if (fail.target && trace.verificationCommands?.some(v => !v.passed && v.seq === fail.seq)) continue
    entries.pitfalls.push({
      text: `${fail.tool}${fail.target ? ` (${truncateText(fail.target, 70)})` : ''} 曾失败: ${fail.error}`,
      priority: 'high',
      pinned: true,
      confidence: 0.95,
      tags: ['tool-error'],
      provenance: { sourceType: 'tool-result', ref: `${sessionId}#seq=${fail.resultSeq ?? fail.seq}`, recordedAt: now },
    })
  }

  // 4. Linked optimized workflows
  for (const wf of linkedWorkflows.slice(0, 5)) {
    const m = wf.optimized?.metrics || {}
    entries.workflows.push({
      text: `复用优化工作流 [${wf.name} v${wf.version}] (${wf.title}): 步骤 ${m.beforeSteps ?? 0}→${m.afterSteps ?? 0}, 评分 ${m.afterScore ?? 0}/100 — ${wf.optimized?.diff?.summary || ''}`,
      priority: wf.promotedAsSkill ? 'critical' : 'high',
      pinned: true,
      confidence: 1,
      tags: ['workflow', wf.name],
      provenance: { sourceType: 'workflow', ref: `${wf.workflowId}@v${wf.version}`, recordedAt: wf.updatedAt || now },
    })
  }

  // 5. Deliverables & resumption checkpoints
  for (const deliv of (trace.deliverables || []).slice(0, 6)) {
    entries.checkpoints.push({
      text: `已交付产物: ${deliv.path}${deliv.description ? ` — ${deliv.description}` : ''}`,
      priority: 'high',
      pinned: true,
      confidence: 1,
      tags: ['deliverable'],
      provenance: { sourceType: 'session-event', ref: `${sessionId}#seq=${deliv.seq}`, recordedAt: deliv.time || now },
    })
  }

  const latestUserGoal = trace.userMessages?.[trace.userMessages.length - 1]
  if (latestUserGoal) {
    entries.checkpoints.push({
      text: `最近会话目标 (${sessionId}): ${truncateText(latestUserGoal.text, 240)}`,
      priority: 'normal',
      pinned: true,
      confidence: 0.9,
      tags: ['goal'],
      provenance: { sourceType: 'session-event', ref: `${sessionId}#seq=${latestUserGoal.seq}`, recordedAt: latestUserGoal.time || now },
    })
  }

  return entries
}

/** Merge new collected entries cleanly onto an existing draft/pack without duplicates. */
export function mergePackEntries(baseEntries = emptySections(), incomingEntries = emptySections()) {
  const merged = emptySections()
  for (const section of MEMORY_SECTIONS) {
    const map = new Map()
    for (const item of [...(baseEntries[section] || []), ...(incomingEntries[section] || [])]) {
      if (!item || typeof item.text !== 'string') continue
      const key = item.text.trim().toLowerCase()
      if (!key) continue
      const prev = map.get(key)
      if (!prev) map.set(key, item)
      else {
        map.set(key, {
          ...prev,
          ...item,
          pinned: Boolean(prev.pinned || item.pinned),
          priority: (PRIORITY_RANK[item.priority] ?? 2) < (PRIORITY_RANK[prev.priority] ?? 2) ? item.priority : prev.priority,
        })
      }
    }
    merged[section] = [...map.values()]
  }
  return merged
}

/** Build a plain-language explanation & preview of what a Memory Pack stores and when it takes effect. */
export function buildMemorySummary(pack) {
  if (!pack || typeof pack !== 'object') {
    return {
      totalEntries: 0,
      sectionCounts: {},
      scopeLabel: '全局通用',
      headline: '暂无记住的条目',
      highlights: [],
      recapLines: [],
    }
  }
  const shortNames = {
    constraints: '红线要求',
    facts: '路径与事实',
    decisions: '已定方案',
    pitfalls: '踩坑避雷',
    workflows: '关联做法',
    checkpoints: '交接断点',
  }
  const sectionCounts = {}
  const parts = []
  const highlights = []
  let totalEntries = 0
  for (const sec of MEMORY_SECTIONS) {
    const list = Array.isArray(pack.entries?.[sec]) ? pack.entries[sec] : []
    sectionCounts[sec] = list.length
    totalEntries += list.length
    if (list.length > 0) parts.push(`${shortNames[sec] || sec} ${list.length} 条`)
    for (const item of list.slice(0, 2)) {
      if (highlights.length < 5 && item?.text) {
        highlights.push({
          section: sec,
          sectionName: shortNames[sec] || sec,
          priority: item.priority || 'normal',
          text: truncateText(item.text, 78),
        })
      }
    }
  }
  const scopeLabel = pack.scope === 'session'
    ? '仅在当前对话内生效'
    : pack.scope === 'global'
      ? '在所有对话中通用'
      : `仅在项目「${basename(pack.workspaceRoot || '') || '当前工作区'}」内生效`
  const headline = totalEntries > 0
    ? `共记住 ${totalEntries} 条重点（${parts.join('、')}）；${scopeLabel}，对话太长被压缩也不会忘`
    : `尚无内容；${scopeLabel}`
  const recapLines = [
    `🧠 记忆本「${pack.title}」已保存（${headline}）`,
    ...highlights.map((h, i) => `  ${i + 1}. [${h.sectionName}] ${h.text}`),
  ]
  return {
    totalEntries,
    sectionCounts,
    scopeLabel,
    headline,
    highlights,
    recapLines,
  }
}

/** Render a human- and AI-readable Markdown companion document for any pack. */
export function exportPackMarkdown(pack, verification) {
  const ver = verification || verifyPack(pack)
  const lines = [
    `# FlowPack 严格记忆包: ${pack.title}`,
    '',
    `- **Pack ID**: \`${pack.packId}\` (v${pack.version})`,
    `- **封装状态**: ${pack.sealState === 'sealed' ? '🔒 已严格封装 (Sealed)' : '📝 草稿 (Draft)'}`,
    `- **作用域隔离**: \`${pack.scope}\`${pack.workspaceRoot ? ` · workspace: \`${pack.workspaceRoot}\`` : ''}`,
    `- **SHA-256 完整性**: ${ver.tampered ? `❌ 校验失败 (${ver.errors.join('; ')})` : ver.validIntegrity === true ? `✅ Verified (\`${pack.integrity?.sha256}\`)` : '⏳ Unsealed Draft'}`,
    `- **防压缩保护**: ${pack.compactionSurvival ? '已开启 (Compaction-Proof)' : '关闭'}`,
    `- **来源会话**: ${(pack.sourceSessionIds || []).join(', ') || 'manual'}`,
    '',
  ]

  for (const section of MEMORY_SECTIONS) {
    const items = pack.entries?.[section] || []
    if (items.length === 0) continue
    lines.push(`## ${SECTION_LABELS[section] || section} (${items.length})`, '')
    for (const item of items) {
      const badges = [
        item.priority.toUpperCase(),
        item.pinned ? 'PIN' : '',
        item.provenance?.ref ? `src:${item.provenance.ref}` : '',
      ].filter(Boolean).join(' · ')
      lines.push(`- **[${badges}]** ${item.text}`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Compute structural entry-by-entry diff between two packs/revisions. */
export function diffPacks(packA, packB) {
  const sections = {}
  let addedCount = 0
  let removedCount = 0

  for (const section of MEMORY_SECTIONS) {
    const listA = packA?.entries?.[section] || []
    const listB = packB?.entries?.[section] || []
    const mapA = new Map(listA.map(e => [e.text.trim().toLowerCase(), e]))
    const mapB = new Map(listB.map(e => [e.text.trim().toLowerCase(), e]))

    const added = []
    const removed = []
    for (const [k, item] of mapB.entries()) {
      if (!mapA.has(k)) {
        added.push(item)
        addedCount += 1
      }
    }
    for (const [k, item] of mapA.entries()) {
      if (!mapB.has(k)) {
        removed.push(item)
        removedCount += 1
      }
    }
    if (added.length > 0 || removed.length > 0) {
      sections[section] = { added, removed }
    }
  }

  return {
    packId: packB?.packId || packA?.packId || '',
    fromVersion: packA?.version ?? null,
    toVersion: packB?.version ?? null,
    fromSha256: packA?.integrity?.sha256 || null,
    toSha256: packB?.integrity?.sha256 || null,
    addedCount,
    removedCount,
    sections,
  }
}

/**
 * Compile active scope-isolated, SHA-256 verified strict memory + promoted workflows
 * into a character-budgeted system prompt section ready for `ctx.systemPrompt.section`.
 */
export function compilePromptInjection({
  packs = [],
  workflows = [],
  activeCapsules = [],
  quarantinedCapsules = [],
  isSubagent = false,
  parentSessionId = '',
  sessionId = '',
  cwd = '',
  maxChars = 3600,
  requireSealedForInjection = false,
  preferences = DEFAULT_PREFERENCES,
} = {}) {
  const normalizedCwd = normalizeWorkspaceRoot(cwd)
  const budget = clampInt(maxChars, 400, 16000, 3600)
  const includedPacks = []
  const excludedByScope = []
  const excludedUnsealed = []
  const quarantined = []

  // Partition & verify candidate packs with strict scope isolation
  for (const pack of packs) {
    const ver = verifyPack(pack, {
      enforceScope: true,
      sessionId,
      cwd: normalizedCwd,
      preferences,
    })
    if (ver.tampered) {
      quarantined.push({ packId: pack.packId, title: pack.title, reason: ver.errors.join('; ') })
      continue
    }
    if (!ver.scopeAllowed) {
      excludedByScope.push({ packId: pack.packId, scope: pack.scope, reason: ver.scopeReason })
      continue
    }
    if (!ver.ok && pack.sealState === 'sealed') {
      quarantined.push({ packId: pack.packId, title: pack.title, reason: ver.errors.join('; ') })
      continue
    }
    if (requireSealedForInjection && pack.sealState !== 'sealed') {
      excludedUnsealed.push({ packId: pack.packId, title: pack.title })
      continue
    }
    includedPacks.push({ pack, verification: ver })
  }

  // Rank sealed packs before drafts, and session/workspace before global
  const scopeWeight = { session: 0, workspace: 1, workflow: 2, global: 3 }
  includedPacks.sort((a, b) => {
    if (a.pack.sealState !== b.pack.sealState) return a.pack.sealState === 'sealed' ? -1 : 1
    const sw = (scopeWeight[a.pack.scope] ?? 9) - (scopeWeight[b.pack.scope] ?? 9)
    if (sw !== 0) return sw
    return (b.pack.updatedAt || 0) - (a.pack.updatedAt || 0)
  })

  // Filter promoted/matching workflows for quick awareness in prompt
  const activeWorkflows = workflows.filter(wf => {
    if (!wf.promotedAsSkill) return false
    if (!wf.workspaceRoot) return true
    return normalizedCwd ? isSameWorkspace(wf.workspaceRoot, normalizedCwd) : true
  }).slice(0, 6)

  const normalizedCapsules = Array.isArray(activeCapsules) ? activeCapsules.filter(x => x && x.capsule) : []

  if (
    includedPacks.length === 0
    && activeWorkflows.length === 0
    && normalizedCapsules.length === 0
    && quarantined.length === 0
    && quarantinedCapsules.length === 0
  ) {
    return {
      text: '',
      charCount: 0,
      maxChars: budget,
      budgetPct: 0,
      includedPacks: [],
      activeWorkflows: [],
      includedCapsules: [],
      excludedByScope,
      excludedUnsealed,
      quarantined,
      quarantinedCapsules,
    }
  }

  const headerLines = [
    '## [FlowPack 严格记忆、经验胶囊与优化工作流上下文 | Compaction-Proof]',
    '以下记忆与经验胶囊均经过作用域隔离（Session/Workspace/Global/Subagent Inheritance）与 SHA-256 完整性校验，在上下文压缩、跨对话与跨 Agent 委派中保持生效：',
  ]
  if (isSubagent && parentSessionId) {
    headerLines.push(`> 🤖 当前为子 Agent 会话 (${sessionId || 'subagent'})，已自动继承主会话 \`${parentSessionId}\` 选用的经验胶囊与工作流约束。`)
  }
  if (quarantined.length > 0 || quarantinedCapsules.length > 0) {
    const ids = [...quarantined.map(q => q.packId), ...quarantinedCapsules.map(q => q.capsuleId)]
    headerLines.push(`> ⚠️ 注意：已拦截并隔离 ${ids.length} 个校验失败的条目 (${ids.join(', ')})，未注入任何受污染内容。`)
  }

  const chunks = [headerLines.join('\n')]
  let usedChars = chunks[0].length

  // First inject explicitly selected/inherited Experience Capsules so agent knows exact workflow stages, self-healing rules, and Gen-1 baseline!
  if (normalizedCapsules.length > 0 && usedChars + 180 < budget) {
    const capLines = ['### ⚡ 已启用可选经验胶囊 (Active Experience Capsules)']
    const scopeText = {
      session: '当前对话',
      'subagent-inherited': '子Agent自动继承',
      workspace: '本项目跨对话共享',
      global: '全局跨对话+跨Agent',
    }
    for (const item of normalizedCapsules.slice(0, 5)) {
      const cap = item.capsule
      const wf = cap.workflow || {}
      const gens = Array.isArray(wf.genealogySummary) ? wf.genealogySummary : []
      const firstGen = gens[0]
      const capHead = `- **${cap.icon || '⚡'} ${cap.title}** (\`${cap.capsuleId}\` · v${cap.version} · 成熟度:${cap.maturity} · 作用域:${scopeText[item.activationScope] || item.activationScope})`
      if (usedChars + capHead.length + 60 > budget) break
      capLines.push(capHead)
      usedChars += capHead.length + 1

      const stagesDesc = Array.isArray(wf.macroStages) && wf.macroStages.length > 0
        ? wf.macroStages
          .map(ms => `${ms.stepNo}.${ms.title}: ${truncateText(ms.summary, 52)}`)
          .join(' → ')
        : (wf.stages || [])
          .map((st, idx) => `${idx + 1}.[${st.executionMode === 'parallel' && st.steps?.length > 1 ? '并行' : '顺序'}]${(st.steps || []).map(s => `${s.tool}${s.target ? `(${truncateText(s.target, 32)})` : ''}`).join('+')}`)
          .join(' → ')
      if (stagesDesc && usedChars + stagesDesc.length + 25 < budget) {
        const sLine = `  - 工作流步骤: ${truncateText(stagesDesc, 260)}`
        capLines.push(sLine)
        usedChars += sLine.length + 1
      }

      const topRules = (cap.selfHealing?.rules || []).slice(0, 3)
      for (const r of topRules) {
        const rLine = `  - 自愈防坑[${r.tool}]: ${truncateText(r.fixSteps, 180)}`
        if (usedChars + rLine.length + 25 > budget) break
        capLines.push(rLine)
        usedChars += rLine.length + 1
      }

      if (firstGen && usedChars + 120 < budget) {
        const spanText = gens.length > 1
          ? `已留存 Gen 1 (${firstGen.steps}步) 至 Gen ${gens[gens.length - 1].gen} 共 ${gens.length} 代方案`
          : `已留存 Gen 1 (${firstGen.steps}步) 初始摸索基线`
        const genLine = `  - 非遗忘演化基线: ${spanText}；如当前策略受阻可调用 \`flowpack_capsule(action="recall_generation", capsuleId="${cap.capsuleId}", gen=1)\` 对照回溯`
        capLines.push(genLine)
        usedChars += genLine.length + 1
      }
    }
    if (capLines.length > 1) chunks.push(capLines.join('\n'))
  }

  // Flatten pack entries ordered by section importance & priority so highest-priority rules fit budget first
  const candidateLines = []
  for (const { pack } of includedPacks) {
    const tag = pack.sealState === 'sealed'
      ? `SEALED:${pack.integrity?.sha256?.slice(0, 8)}`
      : 'DRAFT'
    for (const section of MEMORY_SECTIONS) {
      for (const item of pack.entries?.[section] || []) {
        candidateLines.push({
          rank: (pack.sealState === 'sealed' ? 0 : 10) + (PRIORITY_RANK[item.priority] ?? 2) + (item.pinned ? 0 : 3),
          line: `- [${section}|${item.priority}|${tag}] ${item.text} _(src: ${item.provenance?.ref || pack.packId})_`,
        })
      }
    }
  }

  candidateLines.sort((a, b) => a.rank - b.rank)

  const emittedLines = []
  let omittedEntries = 0
  for (const item of candidateLines) {
    const nextLen = item.line.length + 1
    if (usedChars + nextLen + 140 > budget) {
      omittedEntries += 1
      continue
    }
    emittedLines.push(item.line)
    usedChars += nextLen
  }

  if (emittedLines.length > 0) {
    chunks.push(emittedLines.join('\n'))
  }
  if (omittedEntries > 0) {
    const notice = `> (按 ${budget} 字符预算保留高优先级条目，其余 ${omittedEntries} 条请用 \`flowpack_memory\` 工具按需检索)`
    chunks.push(notice)
    usedChars += notice.length + 1
  }

  if (activeWorkflows.length > 0 && usedChars + 140 < budget) {
    const wfLines = ['### 已激活优化工作流 (Promoted Workflows)']
    for (const wf of activeWorkflows) {
      const m = wf.optimized?.metrics || {}
      const wfLine = `- \`${wf.name}\` v${wf.version}: ${wf.title} (步骤 ${m.beforeSteps ?? 0}→${m.afterSteps ?? 0}, 并行 ${m.parallelStagesCount ?? 0} 组, 护栏 ${m.guardrailsAdded ?? 0} 条)`
      if (usedChars + wfLine.length + 30 > budget) break
      wfLines.push(wfLine)
      usedChars += wfLine.length + 1
    }
    if (wfLines.length > 1) chunks.push(wfLines.join('\n'))
  }

  const text = chunks.join('\n\n')
  return {
    text,
    charCount: text.length,
    maxChars: budget,
    budgetPct: Math.min(100, Math.round((text.length / budget) * 100)),
    includedPacks: includedPacks.map(({ pack, verification }) => ({
      packId: pack.packId,
      title: pack.title,
      version: pack.version,
      scope: pack.scope,
      sealState: pack.sealState,
      sha256: pack.integrity?.sha256 || null,
      verified: verification.validIntegrity,
    })),
    includedCapsules: normalizedCapsules.map(({ capsule, activationScope, inheritedFrom }) => ({
      capsuleId: capsule.capsuleId,
      title: capsule.title,
      version: capsule.version,
      maturity: capsule.maturity,
      activationScope,
      inheritedFrom: inheritedFrom || null,
      sha256: capsule.integrity?.sha256 || null,
    })),
    activeWorkflows: activeWorkflows.map(w => ({ workflowId: w.workflowId, name: w.name, version: w.version })),
    excludedByScope,
    excludedUnsealed,
    quarantined,
    quarantinedCapsules,
  }
}

/** High-level MemoryPackService coordinating verification, quarantine, archival, and session capture. */
export class MemoryPackService {
  constructor(ctx, store, workflowService) {
    this.ctx = ctx
    this.store = store
    this.workflowService = workflowService
  }

  /** Capture candidate memories from a session trace, pack them, and optionally seal immediately. */
  async packFromSession({
    sessionId,
    title,
    scope,
    packId,
    seal = true,
    extraEntries,
    signal,
  } = {}) {
    const prefs = await this.store.readPreferences()
    const sq = this.ctx?.get?.('sessionQuery')
    const snapshot = await readSessionSnapshot(sq, sessionId, signal)
    const trace = normalizeSessionTrace(snapshot, { sessionId, title })

    const targetScope = VALID_SCOPES.has(scope) ? scope : (trace.cwd ? prefs.defaultScope : 'session')
    const existing = packId ? (await this.store.readPack(packId)).pack : undefined
    const workflows = (await this.store.listWorkflows()).filter(w =>
      w.sourceSessionIds?.includes(sessionId) || (trace.cwd && isSameWorkspace(w.workspaceRoot, trace.cwd)),
    )

    const collected = collectCandidatesFromTrace(trace, workflows)
    const combinedEntries = mergePackEntries(
      existing?.entries || emptySections(),
      mergePackEntries(collected, extraEntries || emptySections()),
    )

    const rawTraceTitle = String(trace.title || '').trim()
    const cleanTraceTitle = rawTraceTitle && !isSystemNoiseMessage(rawTraceTitle) && rawTraceTitle !== sessionId
      ? rawTraceTitle
      : ''
    const effectiveTitle = truncateText(
      title || existing?.title || (cleanTraceTitle ? `「${truncateText(cleanTraceTitle, 28)}」笔记` : `${basename(trace.cwd || '') || '对话'} 重要笔记`),
      90,
    )
    const nextVersion = existing ? (existing.version || 1) + 1 : 1
    const baseInput = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      packId: existing?.packId || packId,
      title: effectiveTitle,
      version: nextVersion,
      scope: targetScope,
      workspaceRoot: targetScope === 'workspace' || targetScope === 'workflow' ? trace.cwd : (trace.cwd || ''),
      sourceSessionIds: [...new Set([...(existing?.sourceSessionIds || []), sessionId])],
      compactionSurvival: true,
      budget: existing?.budget || {
        maxTotalChars: prefs.maxTotalPackChars,
        maxEntryChars: prefs.maxEntryChars,
        maxEntriesPerSection: prefs.maxEntriesPerSection,
      },
      entries: combinedEntries,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }

    if (seal) {
      const sealed = sealPack(baseInput, prefs)
      await this.store.savePack(sealed.pack)
      const md = exportPackMarkdown(sealed.pack)
      const archivePaths = await this.store.writeArchiveSnapshot(sealed.pack, md)
      await this.store.recordAudit({
        kind: 'memory-seal',
        packId: sealed.pack.packId,
        version: sealed.pack.version,
        scope: sealed.pack.scope,
        sha256: sealed.pack.integrity.sha256,
      })
      return {
        pack: sealed.pack,
        memorySummary: buildMemorySummary(sealed.pack),
        warnings: sealed.warnings,
        stats: sealed.stats,
        archivePaths,
        markdown: md,
      }
    }

    const validated = validateAndNormalizePack({ ...baseInput, sealState: 'draft' }, { ...prefs, strictMode: prefs.strictMode })
    if (!validated.ok) {
      const err = new Error(`Memory pack validation failed:\n- ${validated.errors.join('\n- ')}`)
      err.validationErrors = validated.errors
      throw err
    }
    await this.store.savePack(validated.pack)
    await this.store.recordAudit({
      kind: 'memory-pack-draft',
      packId: validated.pack.packId,
      version: validated.pack.version,
      scope: validated.pack.scope,
    })
    return {
      pack: validated.pack,
      memorySummary: buildMemorySummary(validated.pack),
      warnings: validated.warnings,
      stats: validated.stats,
      markdown: exportPackMarkdown(validated.pack),
    }
  }

  /** Add/pin one structured entry to an existing or newly created pack (re-seals automatically if previously sealed). */
  async pinEntry({
    packId,
    title,
    scope,
    workspaceRoot,
    sessionId,
    section = 'facts',
    text,
    priority = 'high',
    sourceType = 'user',
    sourceRef,
    tags = [],
    seal,
  } = {}) {
    if (!MEMORY_SECTIONS.includes(section)) {
      throw new Error(`Invalid section "${section}". Expected one of: ${MEMORY_SECTIONS.join(', ')}`)
    }
    const prefs = await this.store.readPreferences()
    const resolvedPackId = packId || `pack-${slugifyId(title || basename(workspaceRoot || '') || sessionId || 'default', 'pin')}`
    const existingRes = await this.store.readPack(resolvedPackId)
    const existing = existingRes.pack

    const targetScope = existing?.scope || (VALID_SCOPES.has(scope) ? scope : (workspaceRoot ? 'workspace' : 'global'))
    const normCwd = normalizeWorkspaceRoot(existing?.workspaceRoot || workspaceRoot || '')
    if (targetScope === 'workspace' && !normCwd) {
      throw new Error('Cannot pin into a workspace-scoped pack without a valid workspaceRoot / cwd.')
    }

    const newItem = {
      text: String(text || '').trim(),
      priority,
      pinned: true,
      confidence: 1,
      tags,
      provenance: {
        sourceType,
        ref: sourceRef || (sessionId ? `session:${sessionId}` : normCwd || 'explicit-pin'),
        recordedAt: Date.now(),
      },
    }
    const nextEntries = mergePackEntries(existing?.entries || emptySections(), {
      ...emptySections(),
      [section]: [newItem],
    })

    const shouldSeal = typeof seal === 'boolean' ? seal : (existing?.sealState === 'sealed' || prefs.strictMode)
    const nextVersion = existing ? (existing.version || 1) + 1 : 1
    const baseInput = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      packId: existing?.packId || resolvedPackId,
      title: existing?.title || truncateText(title || `${basename(normCwd) || '全局'} 严格记忆包`, 90),
      version: nextVersion,
      scope: targetScope,
      workspaceRoot: normCwd,
      sourceSessionIds: [...new Set([...(existing?.sourceSessionIds || []), ...(sessionId ? [sessionId] : [])])],
      compactionSurvival: true,
      budget: existing?.budget || {
        maxTotalChars: prefs.maxTotalPackChars,
        maxEntryChars: prefs.maxEntryChars,
        maxEntriesPerSection: prefs.maxEntriesPerSection,
      },
      entries: nextEntries,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }

    if (shouldSeal) {
      const sealed = sealPack(baseInput, prefs)
      await this.store.savePack(sealed.pack)
      const md = exportPackMarkdown(sealed.pack)
      await this.store.writeArchiveSnapshot(sealed.pack, md)
      await this.store.recordAudit({ kind: 'memory-pin-seal', packId: sealed.pack.packId, version: sealed.pack.version, section })
      return { pack: sealed.pack, memorySummary: buildMemorySummary(sealed.pack), warnings: sealed.warnings, stats: sealed.stats }
    }

    const res = validateAndNormalizePack({ ...baseInput, sealState: 'draft' }, prefs)
    if (!res.ok) throw new Error(res.errors.join('; '))
    await this.store.savePack(res.pack)
    return { pack: res.pack, memorySummary: buildMemorySummary(res.pack), warnings: res.warnings, stats: res.stats }
  }

  /** Seal an existing draft pack or bump/re-seal with strict validation & archive snapshot. */
  async sealExistingPack(packId) {
    const prefs = await this.store.readPreferences()
    const res = await this.store.readPack(packId)
    if (!res.exists || !res.pack) throw new Error(`Memory pack "${packId}" does not exist.`)
    // First check it wasn't tampered while already sealed
    if (res.pack.sealState === 'sealed') {
      const preCheck = verifyPack(res.pack, { preferences: prefs })
      if (preCheck.tampered) {
        const qPath = await this.store.quarantinePack(res.pack, 'tampered_before_reseal', { errors: preCheck.errors })
        throw new Error(`Pack "${packId}" failed pre-seal integrity verification and was quarantined at ${qPath}.`)
      }
      return { pack: res.pack, warnings: preCheck.warnings, stats: { totalChars: preCheck.totalChars }, alreadySealed: true }
    }
    const sealed = sealPack({ ...res.pack, version: (res.pack.version || 1) + 1 }, prefs)
    await this.store.savePack(sealed.pack)
    const md = exportPackMarkdown(sealed.pack)
    const archivePaths = await this.store.writeArchiveSnapshot(sealed.pack, md)
    await this.store.recordAudit({
      kind: 'memory-seal',
      packId: sealed.pack.packId,
      version: sealed.pack.version,
      sha256: sealed.pack.integrity.sha256,
    })
    return { pack: sealed.pack, warnings: sealed.warnings, stats: sealed.stats, archivePaths, markdown: md }
  }

  /** Verify one or all stored packs; automatically quarantines tampered packs when `quarantineOnTamper` is enabled. */
  async verifyAll({ packId, sessionId, cwd, quarantineOnTamper = true } = {}) {
    const prefs = await this.store.readPreferences()
    const listRes = packId
      ? await (async () => {
          const single = await this.store.readPack(packId)
          return { packs: single.pack ? [single.pack] : [], corrupt: single.exists && !single.readable ? [{ file: packId, error: single.error }] : [] }
        })()
      : await this.store.listPacks({ bypassCache: true })

    const results = []
    const quarantinedNow = []
    for (const pack of listRes.packs) {
      const report = verifyPack(pack, {
        preferences: prefs,
        enforceScope: Boolean(sessionId || cwd),
        sessionId,
        cwd,
      })
      if (report.tampered && quarantineOnTamper) {
        const qPath = await this.store.quarantinePack(pack, 'integrity_mismatch', { errors: report.errors })
        report.quarantinedAt = qPath
        quarantinedNow.push(pack.packId)
        await this.store.recordAudit({ kind: 'verify-quarantine', packId: pack.packId, errors: report.errors })
      }
      results.push(report)
    }

    return {
      ok: results.every(r => r.ok) && listRes.corrupt.length === 0,
      checked: results.length,
      passed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      quarantinedNow,
      corruptFiles: listRes.corrupt,
      results,
    }
  }

  /** Strictly import a portable `.dshpack.json` pack (verifies SHA-256 and schema before admitting!). */
  async importBundle(bundleData) {
    const raw = typeof bundleData === 'string' ? JSON.parse(bundleData) : bundleData
    const prefs = await this.store.readPreferences()
    const check = verifyPack(raw, { preferences: prefs })
    if (!check.ok) {
      const err = new Error(`Import rejected by strict verifier: ${check.errors.join('; ')}`)
      err.verifyReport = check
      throw err
    }
    const normalized = validateAndNormalizePack(raw, { ...prefs, strictMode: raw.sealState === 'sealed' ? true : prefs.strictMode }).pack
    if (raw.sealState === 'sealed') normalized.integrity = raw.integrity
    await this.store.savePack(normalized)
    if (normalized.sealState === 'sealed') {
      await this.store.writeArchiveSnapshot(normalized, exportPackMarkdown(normalized, check))
    }
    await this.store.recordAudit({ kind: 'memory-import', packId: normalized.packId, version: normalized.version })
    return { pack: normalized, verification: check }
  }

  /** Roll back a memory pack cleanly to an archived sealed revision. */
  async rollbackPack(packId, targetVersion) {
    const archives = await this.store.listPackArchives(packId)
    const match = targetVersion !== undefined
      ? archives.find(a => a.version === Number(targetVersion))
      : archives[0]
    if (!match) throw new Error(`No archived snapshot found for pack "${packId}"${targetVersion ? ` at v${targetVersion}` : ''}.`)
    const check = verifyPack(match)
    if (!check.ok) throw new Error(`Archived snapshot v${match.version} failed integrity check: ${check.errors.join('; ')}`)
    const restored = { ...match, updatedAt: Date.now() }
    // Re-seal only updatedAt? Better: keep exact archived object verbatim so SHA-256 remains pristine!
    await this.store.savePack(match)
    await this.store.recordAudit({ kind: 'memory-rollback', packId, version: match.version, sha256: match.integrity?.sha256 })
    return match
  }

  /** Search across non-tampered packs matching optional scope/cwd/query. */
  async queryPacks({ query = '', cwd = '', sessionId = '', limit = 20 } = {}) {
    const { packs } = await this.store.listPacks()
    const needle = String(query || '').trim().toLowerCase()
    const matches = []
    for (const pack of packs) {
      const ver = verifyPack(pack, { enforceScope: Boolean(cwd || sessionId), cwd, sessionId })
      if (ver.tampered) continue
      if ((cwd || sessionId) && !ver.scopeAllowed) continue

      const sectionHits = []
      for (const section of MEMORY_SECTIONS) {
        for (const item of pack.entries?.[section] || []) {
          if (!needle || `${item.text} ${(item.tags || []).join(' ')} ${section}`.toLowerCase().includes(needle)) {
            sectionHits.push({ section, ...item })
          }
        }
      }
      if (!needle || pack.title.toLowerCase().includes(needle) || sectionHits.length > 0) {
        matches.push({
          packId: pack.packId,
          title: pack.title,
          version: pack.version,
          scope: pack.scope,
          sealState: pack.sealState,
          sha256: pack.integrity?.sha256 || null,
          hits: sectionHits.slice(0, limit),
        })
      }
    }
    return matches.slice(0, limit)
  }

  /** Compile prompt injection safely, quarantining any tampered sealed pack automatically on the spot. */
  async compileForContext({ sessionId = '', parentSessionId = '', isSubagent = false, cwd = '', activeCapsules = [], quarantinedCapsules = [] } = {}) {
    const prefs = await this.store.readPreferences()
    if (!prefs.autoInject) {
      return { enabled: false, text: '', charCount: 0, maxChars: prefs.promptBudgetChars, budgetPct: 0, includedPacks: [], activeWorkflows: [], includedCapsules: [], excludedByScope: [], quarantined: [], quarantinedCapsules: [] }
    }
    const [{ packs }, workflows] = await Promise.all([
      this.store.listPacks(),
      this.store.listWorkflows(),
    ])
    const result = compilePromptInjection({
      packs,
      workflows,
      activeCapsules,
      quarantinedCapsules,
      isSubagent,
      parentSessionId,
      sessionId,
      cwd,
      maxChars: prefs.promptBudgetChars,
      requireSealedForInjection: prefs.requireSealedForInjection,
      preferences: prefs,
    })
    for (const q of result.quarantined) {
      const badPack = packs.find(p => p.packId === q.packId)
      if (badPack) {
        await this.store.quarantinePack(badPack, 'tamper_detected_during_injection', { reason: q.reason }).catch(() => {})
      }
    }
    return { enabled: true, ...result }
  }
}
