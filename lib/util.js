/**
 * Shared utilities for dsh-flowpack: path normalization, workspace isolation,
 * canonical serialization, SHA-256 hashing, and secret redaction.
 */

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, normalize, resolve } from 'node:path'

/** Resolve `$DSH_HOME`, matching DSH desktop and CLI defaults. */
export function resolveDshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (fromEnv.length > 0) return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

/** Normalize separators to forward slashes without trailing slash (preserving drive root). */
export function slashPath(value) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/')
  if (raw.length === 0) return ''
  if (/^[A-Za-z]:\/$/.test(raw)) return raw
  return raw.replace(/\/+$/, '') || '/'
}

/** Case-aware comparison key for Windows and POSIX paths. */
export function pathKey(value) {
  const normalized = slashPath(value)
  if (normalized.length === 0) return ''
  return process.platform === 'win32' || /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLowerCase()
    : normalized
}

/** Normalize an absolute directory path for workspace binding. */
export function normalizeWorkspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return ''
  const trimmed = cwd.trim()
  try {
    return slashPath(isAbsolute(trimmed) ? normalize(trimmed) : resolve(trimmed))
  } catch {
    return slashPath(trimmed)
  }
}

/** Check strict workspace equivalence or explicit child containment. */
export function isSameWorkspace(leftCwd, rightCwd) {
  const a = pathKey(normalizeWorkspaceRoot(leftCwd))
  const b = pathKey(normalizeWorkspaceRoot(rightCwd))
  return a.length > 0 && a === b
}

/** Check whether `targetPath` is inside `rootDir` (inclusive). */
export function isInsideWorkspace(targetPath, rootDir) {
  const target = pathKey(slashPath(targetPath))
  const root = pathKey(normalizeWorkspaceRoot(rootDir))
  if (!target || !root) return false
  if (target === root) return true
  const prefix = root.endsWith('/') ? root : `${root}/`
  return target.startsWith(prefix)
}

/** Final display segment of a path. */
export function baseName(value) {
  const normalized = slashPath(value)
  if (!normalized) return ''
  const trimmed = normalized.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || basename(normalized)
}

/** Convert free-form text into a valid kebab-case identifier (max 64 chars). */
export function slugifyId(input, fallback = 'item') {
  const raw = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (raw.length > 0 && /^[a-z0-9]/.test(raw)) return raw
  return fallback
}

/** Trim and bound text to a safe max character length with ellipsis. */
export function truncateText(value, maxChars = 400) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  if (maxChars <= 3) return text.slice(0, maxChars)
  return `${text.slice(0, maxChars - 3).trimEnd()}...`
}

/** Clamp a numeric value to an integer range. */
export function clampInt(value, min, max, fallback) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(num)))
}

/**
 * Deterministically serialize any JSON-compatible value with sorted object keys.
 * Essential for tamper-evident SHA-256 digests across reloads/platforms.
 */
export function canonicalJson(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter(k => value[k] !== undefined && typeof value[k] !== 'function')
      .sort()
    const parts = keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    return `{${parts.join(',')}}`
  }
  return 'null'
}

/** Compute lowercase SHA-256 hex digest of UTF-8 text or canonicalized value. */
export function sha256Hex(input) {
  const text = typeof input === 'string' ? input : canonicalJson(input)
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const SECRET_PATTERNS = [
  { name: 'openai_or_deepseek_sk', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'github_token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'google_api_key', regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'bearer_token', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { name: 'private_key_block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'env_secret_assignment', regex: /\b([A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*(['"]?)([^\s'"]{8,})\2/g },
]

/** Inspect text for accidental credential or token leaks. */
export function scanSecrets(text) {
  const source = String(text ?? '')
  const findings = []
  for (const rule of SECRET_PATTERNS) {
    rule.regex.lastIndex = 0
    let match
    while ((match = rule.regex.exec(source)) !== null) {
      findings.push({ rule: rule.name, index: match.index, length: match[0].length })
      if (findings.length >= 20) return findings
    }
  }
  return findings
}

/** Mask recognized secrets deterministically so strict packs never leak raw tokens. */
export function redactSecrets(text) {
  let out = String(text ?? '')
  let redactedCount = 0
  for (const rule of SECRET_PATTERNS) {
    rule.regex.lastIndex = 0
    if (rule.name === 'env_secret_assignment') {
      out = out.replace(rule.regex, (_m, keyName) => {
        redactedCount += 1
        return `${keyName}=[REDACTED]`
      })
    } else if (rule.name === 'bearer_token') {
      out = out.replace(rule.regex, () => {
        redactedCount += 1
        return 'Bearer [REDACTED]'
      })
    } else {
      out = out.replace(rule.regex, () => {
        redactedCount += 1
        return '[REDACTED_SECRET]'
      })
    }
  }
  return { text: out, redactedCount }
}

/** Look up a Cordis service via `ctx.get(name)` first, falling back to `ctx[name]`. */
export function getService(ctx, name) {
  if (!ctx) return undefined
  if (typeof ctx.get === 'function') {
    const val = ctx.get(name)
    if (val !== undefined) return val
  }
  return ctx[name]
}
