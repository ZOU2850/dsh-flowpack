/**
 * Session trace reader & normalizer for DeepSeek Harness (`ctx.sessionQuery`).
 * Extracts clean ordered tool calls/results, retry loops, errors, compaction boundaries,
 * deliverables, user goals/constraints, and candidate verified facts without mutating the log.
 */

import { basename } from 'node:path'
import { isInsideWorkspace, normalizeWorkspaceRoot, truncateText } from './util.js'

const READ_TOOLS = new Set([
  'read', 'read_file', 'view_file', 'cat', 'grep', 'ripgrep', 'rg', 'glob', 'find_by_name',
  'grep_search', 'list_dir', 'ls', 'list', 'search', 'file_launcher', 'session_search', 'web_search',
])

const WRITE_TOOLS = new Set([
  'write', 'write_file', 'write_to_file', 'edit', 'edit_file', 'replace_file_content',
  'multi_replace_file_content', 'apply_patch', 'rm', 'delete',
])

const EXEC_TOOLS = new Set([
  'bash', 'powershell', 'pwsh', 'run_command', 'shell', 'exec', 'terminal',
])

const ORCHESTRATION_TOOLS = new Set([
  'subagent', 'subagent_fork', 'invoke_subagent', 'workflow', 'run_workflow', 'send_message', 'agent_team',
])

/** Safely parse tool call JSON arguments. */
export function parseToolArgs(rawArgs) {
  if (typeof rawArgs === 'object' && rawArgs !== null) return rawArgs
  if (typeof rawArgs !== 'string') return {}
  const trimmed = rawArgs.trim()
  if (trimmed.length === 0) return {}
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed }
  } catch {
    return { _raw: truncateText(trimmed, 240) }
  }
}

/** Extract plain text from heterogeneous message content arrays or strings. */
export function extractTextBlocks(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block === 'string') parts.push(block)
    else if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/** Classify a DSH/agent tool by effect kind (`read` | `write` | `exec` | `orchestrate` | `other`). */
export function classifyToolKind(toolName) {
  const lower = String(toolName ?? '').toLowerCase()
  if (READ_TOOLS.has(lower) || lower.includes('read') || lower.includes('search') || lower.includes('list') || lower.includes('glob') || lower.includes('grep')) {
    return 'read'
  }
  if (WRITE_TOOLS.has(lower) || lower.includes('write') || lower.includes('edit') || lower.includes('patch')) {
    return 'write'
  }
  if (EXEC_TOOLS.has(lower) || lower.includes('bash') || lower.includes('pwsh') || lower.includes('powershell') || lower.includes('command')) {
    return 'exec'
  }
  if (ORCHESTRATION_TOOLS.has(lower) || lower.includes('subagent') || lower.includes('workflow')) {
    return 'orchestrate'
  }
  return 'other'
}

/** Extract canonical target identifier (file path, command string, or query) from tool args. */
export function extractToolTarget(toolName, args) {
  const obj = parseToolArgs(args)
  for (const key of ['path', 'file_path', 'Path', 'TargetFile', 'file', 'cwd', 'dir', 'AbsolutePath', 'SearchPath']) {
    if (typeof obj[key] === 'string' && obj[key].trim().length > 0) {
      return obj[key].trim()
    }
  }
  if (typeof obj.command === 'string' && obj.command.trim().length > 0) return obj.command.trim()
  if (typeof obj.CommandLine === 'string' && obj.CommandLine.trim().length > 0) return obj.CommandLine.trim()
  if (typeof obj.pattern === 'string' && obj.pattern.trim().length > 0) return obj.pattern.trim()
  if (typeof obj.query === 'string' && obj.query.trim().length > 0) return obj.query.trim()
  if (typeof obj.Query === 'string' && obj.Query.trim().length > 0) return obj.Query.trim()
  if (typeof obj.skill === 'string' && obj.skill.trim().length > 0) return obj.skill.trim()
  if (typeof obj.action === 'string' && obj.action.trim().length > 0) return obj.action.trim()
  return ''
}

/** Stable structural signature for duplicate / retry loop detection. */
export function callSignature(toolName, argsObj) {
  const name = String(toolName ?? '').toLowerCase()
  const target = extractToolTarget(name, argsObj)
  const keys = Object.keys(argsObj || {}).sort().slice(0, 6)
  const compact = {}
  for (const k of keys) {
    const val = argsObj[k]
    compact[k] = typeof val === 'string' ? truncateText(val, 140) : val
  }
  return `${name}::${target}::${JSON.stringify(compact)}`
}

/** Classify finer-grained DSH/plugin semantic role without changing coarse `classifyToolKind`. */
export function inferToolRole(toolName, args) {
  const lower = String(toolName ?? '').toLowerCase()
  const cmd = String(args?.command || args?.CommandLine || args?.query || '').toLowerCase()
  if (/^(request_access|grant|approve)/.test(lower)) return 'permission'
  if (/^(open_application|launch_app)$/.test(lower)) return 'launch'
  if (/^(computer|gui_|mouse_|keyboard_)/.test(lower) || lower.includes('click') || lower.includes('hotkey')) return 'gui'
  if (/^(browser_|playwright|web_fetch|fetch)/.test(lower) || /\bcurl\b|\bwget\b|http:\/\/|https:\/\//.test(cmd)) return 'web'
  if (lower.startsWith('excel_') || /\.xlsx?$/i.test(String(args?.path || args?.file_path || ''))) return 'spreadsheet'
  if (lower.startsWith('office_') || /\.docx?$|\.pdf$/i.test(String(args?.path || args?.file_path || ''))) return 'document'
  if (lower.includes('file_launcher')) return 'deliver'
  if (isVerificationCommand(cmd)) return 'verify'
  return classifyToolKind(toolName)
}

/** Filter out DSH internal/system notifications stored in `user/message` events. */
export function isSystemNoiseMessage(text) {
  const s = String(text ?? '').trim()
  if (!s) return true
  if (/^The approval policy changed\b/i.test(s)) return true
  if (/^Approval policy\b/i.test(s)) return true
  if (/^#\s*Session Context\b/i.test(s)) return true
  if (/^##\s*\[FlowPack\b/i.test(s)) return true
  if (/^<(?:environment_context|permissions|user_instructions|system|INSTRUCTIONS|context)\b/i.test(s)) return true
  if (/^\[(?:SYSTEM|System Message)\b/.test(s)) return true
  return false
}

/** Heuristic test/build/lint command detector. */
function isVerificationCommand(cmd) {
  return /\b(test|vitest|jest|pytest|mocha|cargo\s+test|go\s+test|tsc|eslint|lint|check|build|typecheck|node\s+--test|pnpm\s+test|npm\s+test)\b/i.test(String(cmd ?? ''))
}

/** Detect directive/constraint sentences in user prompts. */
function extractConstraintCandidates(userText) {
  const lines = String(userText ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const hits = []
  const cueRegex = /(?:必须|务必|不要|禁止|严禁|不能|始终|严格|只能|保留|默认|must|never|always|do not|don't|strictly|ensure|keep|avoid|only use)/i
  for (const line of lines) {
    if (line.length < 6 || line.length > 360) continue
    if (cueRegex.test(line)) hits.push(line)
  }
  return hits.slice(0, 8)
}

/**
 * Borrow/read one session from `ctx.sessionQuery` cleanly, always releasing observation handles.
 */
export async function readSessionSnapshot(sessionQuery, sessionId, signal) {
  if (!sessionQuery) {
    throw new Error('The sessionQuery service is not available in this DSH profile.')
  }
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('A non-empty sessionId is required.')
  }
  const observation = typeof sessionQuery.observeSession === 'function'
    ? await sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
    : undefined
  try {
    let rawHeader
    let rawEvents
    if (observation !== undefined) {
      rawHeader = observation.header || { id: sessionId }
      rawEvents = Array.isArray(observation.events) ? observation.events.slice() : []
    } else {
      const read = await sessionQuery.readSession(sessionId)
      rawHeader = read?.session || { id: sessionId }
      rawEvents = Array.isArray(read?.events) ? read.events.slice() : []
    }
    if ((!rawHeader.title || rawHeader.title === sessionId) && typeof sessionQuery.readTitleSnapshots === 'function') {
      try {
        const snaps = await sessionQuery.readTitleSnapshots([sessionId], signal)
        const snap = snaps instanceof Map
          ? snaps.get(sessionId)
          : (Array.isArray(snaps) ? snaps.find(s => s?.sessionId === sessionId) : snaps?.[sessionId])
        const niceTitle = snap?.displayTitle || snap?.title
        if (niceTitle && String(niceTitle).trim()) {
          rawHeader = { ...rawHeader, title: String(niceTitle).trim() }
        }
      } catch {
        // Optional title enrichment failure should never block trace snapshot reading.
      }
    }
    return { header: rawHeader, events: rawEvents }
  } finally {
    observation?.[Symbol.dispose]?.()
  }
}

/**
 * List sessions from `ctx.sessionQuery`, enriched with titles when supported.
 */
export async function listSessionsWithTitles(sessionQuery, { limit = 40, signal } = {}) {
  if (!sessionQuery || typeof sessionQuery.listSessions !== 'function') return []
  const rows = await sessionQuery.listSessions(signal)
  const list = Array.isArray(rows) ? rows.slice() : []
  const ids = list.map(r => r?.header?.id).filter(Boolean).slice(0, limit)
  let titleMap = new Map()
  if (ids.length > 0 && typeof sessionQuery.readTitleSnapshots === 'function') {
    try {
      const snaps = await sessionQuery.readTitleSnapshots(ids, signal)
      if (snaps instanceof Map) titleMap = snaps
      else if (Array.isArray(snaps)) {
        for (const s of snaps) {
          if (s?.sessionId) titleMap.set(s.sessionId, s)
        }
      } else if (snaps && typeof snaps === 'object') {
        for (const [k, v] of Object.entries(snaps)) titleMap.set(k, v)
      }
    } catch {
      // Optional title enrichment failure should never block session listing.
    }
  }
  return list
    .filter(r => r?.header?.id && r.header.origin !== 'subagent')
    .sort((a, b) => (b.header?.createdAt || 0) - (a.header?.createdAt || 0))
    .slice(0, limit)
    .map(r => {
      const id = r.header.id
      const snap = titleMap.get(id)
      const title = snap?.displayTitle || snap?.title || r.header?.title || basename(r.header?.cwd || '') || id
      return {
        sessionId: id,
        title,
        cwd: r.header?.cwd ? normalizeWorkspaceRoot(r.header.cwd) : '',
        createdAt: r.header?.createdAt || 0,
        live: r.live === true,
      }
    })
}

/**
 * Normalize raw DSH session events into a rich trace object ready for workflow distillation
 * and strict memory candidate extraction.
 */
export function normalizeSessionTrace(snapshot, options = {}) {
  const header = snapshot?.header || {}
  const sessionId = header.id || options.sessionId || 'unknown-session'
  const cwd = normalizeWorkspaceRoot(header.cwd || options.cwd || '')
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []

  const pendingCalls = new Map()
  const steps = []
  const userMessages = []
  const constraintCandidates = []
  const deliverables = []
  const commands = []
  const touchedFiles = new Map()
  const verificationCommands = []
  const failures = []
  let compactionCount = 0
  let maxTurn = 0

  for (let idx = 0; idx < events.length; idx += 1) {
    const ev = events[idx]
    if (!ev || typeof ev !== 'object') continue
    const seq = ev.seq ?? idx
    const time = typeof ev.time === 'number' ? ev.time : Date.now()
    const data = ev.data || {}

    switch (ev.type) {
      case 'user/message': {
        const text = extractTextBlocks(data.content ?? data.text ?? '')
        if (text.length > 0 && !isSystemNoiseMessage(text)) {
          userMessages.push({ seq, time, text: truncateText(text, 800) })
          for (const line of extractConstraintCandidates(text)) {
            constraintCandidates.push({ seq, time, text: line })
          }
        }
        break
      }
      case 'tool/call': {
        const turn = Number.isFinite(data.turn) ? data.turn : maxTurn
        if (turn > maxTurn) maxTurn = turn
        const callId = typeof data.callId === 'string' && data.callId.length > 0 ? data.callId : `call-${seq}`
        const name = String(data.name || 'unknown_tool')
        const args = parseToolArgs(data.arguments)
        const target = extractToolTarget(name, args)
        const kind = classifyToolKind(name)
        const role = inferToolRole(name, args)
        const step = {
          index: steps.length + 1,
          seq,
          time,
          turn,
          stepNo: Number.isFinite(data.step) ? data.step : 0,
          callId,
          tool: name,
          kind,
          role,
          target,
          args,
          signature: callSignature(name, args),
          status: 'pending',
          isError: false,
          errorMessage: '',
          resultSummary: '',
          resultSeq: undefined,
        }
        steps.push(step)
        pendingCalls.set(callId, step)
        break
      }
      case 'tool/result': {
        const msg = data.message || {}
        const callId = msg.toolCallId || data.callId
        const step = pendingCalls.get(callId)
        const isError = msg.isError === true || data.isError === true
        const contentText = extractTextBlocks(msg.content ?? data.content ?? '')
        const summary = truncateText(contentText, 300)
        if (step) {
          step.status = isError ? 'error' : 'ok'
          step.isError = isError
          step.resultSeq = seq
          step.resultSummary = summary
          if (isError) {
            step.errorMessage = truncateText(contentText || 'Tool reported error', 240)
            failures.push({
              seq: step.seq,
              resultSeq: seq,
              tool: step.tool,
              target: step.target,
              signature: step.signature,
              error: step.errorMessage,
            })
          } else if (step.target) {
            if (step.kind === 'read' || step.kind === 'write') {
              const prev = touchedFiles.get(step.target) || { path: step.target, reads: 0, writes: 0, lastSeq: seq }
              if (step.kind === 'write') prev.writes += 1
              else prev.reads += 1
              prev.lastSeq = seq
              prev.inWorkspace = cwd ? isInsideWorkspace(step.target, cwd) : true
              touchedFiles.set(step.target, prev)
            } else if (step.kind === 'exec' && isVerificationCommand(step.target)) {
              verificationCommands.push({
                seq: step.seq,
                resultSeq: seq,
                command: truncateText(step.target, 200),
                passed: true,
                summary: truncateText(contentText, 160),
              })
            }
          }
        }
        if (isError && step?.kind === 'exec' && isVerificationCommand(step.target)) {
          verificationCommands.push({
            seq: step.seq,
            resultSeq: seq,
            command: truncateText(step.target, 200),
            passed: false,
            summary: truncateText(contentText, 160),
          })
        }
        break
      }
      case 'deliverables/presented': {
        const files = Array.isArray(data.files) ? data.files : []
        for (const f of files) {
          if (f && typeof f.path === 'string') {
            deliverables.push({
              seq,
              time,
              path: f.path,
              description: truncateText(f.description || '', 160),
            })
          }
        }
        break
      }
      case 'command/run': {
        commands.push({ seq, time, name: String(data.name || ''), args: String(data.args || '') })
        break
      }
      case 'compaction/start':
      case 'compaction/end': {
        if (ev.type === 'compaction/end') compactionCount += 1
        break
      }
      default:
        break
    }
  }

  // Finalize unresolved steps cleanly
  for (const step of steps) {
    if (step.status === 'pending') step.status = 'unknown'
  }

  return {
    sessionId,
    title: options.title || header.title || basename(cwd || '') || sessionId,
    cwd,
    createdAt: header.createdAt || (events[0]?.time ?? Date.now()),
    eventCount: events.length,
    turns: Math.max(maxTurn, userMessages.length),
    compactionCount,
    userMessages,
    constraintCandidates,
    steps,
    failures,
    deliverables,
    commands,
    touchedFiles: [...touchedFiles.values()],
    verificationCommands,
  }
}
