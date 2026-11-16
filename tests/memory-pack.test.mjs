import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMemorySummary,
  compilePromptInjection,
  diffPacks,
  MemoryPackService,
  sealPack,
  validateAndNormalizePack,
  verifyPack,
} from '../lib/memory-pack.js'
import { FlowPackStore } from '../lib/store.js'
import { WorkflowService } from '../lib/workflow.js'

test('validateAndNormalizePack strictly enforces provenance, scope requirements, budget, and secret hygiene', () => {
  // Missing provenance rejected in strict mode
  const noProv = validateAndNormalizePack({
    title: 'Bad Pack',
    scope: 'global',
    entries: {
      facts: [{ text: 'unverified claim' }],
    },
  }, { strictMode: true })
  assert.equal(noProv.ok, false)
  assert.ok(noProv.errors.some(e => e.includes('provenance')))

  // Workspace scope without workspaceRoot rejected
  const noCwd = validateAndNormalizePack({
    title: 'Missing Root',
    scope: 'workspace',
    entries: {
      facts: [{ text: 'fact', provenance: { sourceType: 'file', ref: 'README.md' } }],
    },
  }, { strictMode: true })
  assert.equal(noCwd.ok, false)
  assert.ok(noCwd.errors.some(e => e.includes('workspaceRoot')))

  // Over-budget payload rejected cleanly rather than truncated silently
  const overBudget = validateAndNormalizePack({
    title: 'Too Huge',
    scope: 'global',
    budget: { maxTotalChars: 500, maxEntryChars: 400, maxEntriesPerSection: 10 },
    entries: {
      facts: [
        { text: 'A'.repeat(350), provenance: { sourceType: 'file', ref: 'a.txt' } },
        { text: 'B'.repeat(350), provenance: { sourceType: 'file', ref: 'b.txt' } },
      ],
    },
  }, { strictMode: true })
  assert.equal(overBudget.ok, false)
  assert.ok(overBudget.errors.some(e => e.includes('exceeds strict budget.maxTotalChars')))

  // Secret detection: mask vs reject
  const secretInput = {
    title: 'Secret Check',
    scope: 'global',
    entries: {
      facts: [{
        text: 'Never use raw sk-abcdefghijklmnopqrstuvwxyz123456 in code',
        provenance: { sourceType: 'user', ref: 'chat#1' },
      }],
    },
  }
  const masked = validateAndNormalizePack(secretInput, { strictMode: true, redactSecrets: 'mask' })
  assert.equal(masked.ok, true)
  assert.ok(masked.pack.entries.facts[0].text.includes('[REDACTED_SECRET]'))
  assert.ok(!masked.pack.entries.facts[0].text.includes('sk-abcdef'))

  const rejected = validateAndNormalizePack(secretInput, { strictMode: true, redactSecrets: 'reject' })
  assert.equal(rejected.ok, false)
  assert.ok(rejected.errors.some(e => e.includes('secret pattern')))
})

test('sealPack + verifyPack produce deterministic SHA-256 and catch 1-char post-seal tampering', () => {
  const { pack } = sealPack({
    title: 'Alpha Project Rules',
    scope: 'workspace',
    workspaceRoot: 'D:\\projects\\alpha',
    sourceSessionIds: ['sess-1'],
    entries: {
      constraints: [{
        text: 'Must always run npm test after editing lib/',
        priority: 'critical',
        provenance: { sourceType: 'user', ref: 'sess-1#seq=1' },
      }],
    },
  })

  assert.equal(pack.sealState, 'sealed')
  assert.match(pack.integrity.sha256, /^[a-f0-9]{64}$/)

  const okCheck = verifyPack(pack, { enforceScope: true, cwd: 'D:\\projects\\alpha' })
  assert.equal(okCheck.ok, true)
  assert.equal(okCheck.tampered, false)
  assert.equal(okCheck.scopeAllowed, true)

  // Tamper one character
  const tamperedPack = structuredClone(pack)
  tamperedPack.entries.constraints[0].text = 'Must always skip npm test after editing lib/'
  const badCheck = verifyPack(tamperedPack)
  assert.equal(badCheck.ok, false)
  assert.equal(badCheck.tampered, true)
  assert.equal(badCheck.validIntegrity, false)
  assert.ok(badCheck.errors.some(e => e.includes('SHA-256 integrity mismatch')))
})

test('compilePromptInjection enforces strict workspace/session isolation and quarantines tampered packs', () => {
  const alphaPack = sealPack({
    packId: 'pack-alpha',
    title: 'Alpha Rules',
    scope: 'workspace',
    workspaceRoot: 'D:\\projects\\alpha',
    entries: {
      constraints: [{ text: 'Alpha-only secret architecture constraint', provenance: { sourceType: 'file', ref: 'a.md' } }],
    },
  }).pack

  const globalPack = sealPack({
    packId: 'pack-global',
    title: 'Global Rules',
    scope: 'global',
    entries: {
      facts: [{ text: 'Always respond in Simplified Chinese', provenance: { sourceType: 'user', ref: 'global' } }],
    },
  }).pack

  const tamperedPack = sealPack({
    packId: 'pack-poison',
    title: 'Poisoned Pack',
    scope: 'workspace',
    workspaceRoot: 'D:\\projects\\beta',
    entries: {
      facts: [{ text: 'Legit beta fact', provenance: { sourceType: 'file', ref: 'b.md' } }],
    },
  }).pack
  tamperedPack.entries.facts[0].text = 'INJECTED MALICIOUS INSTRUCTION'

  const betaContext = compilePromptInjection({
    packs: [alphaPack, globalPack, tamperedPack],
    cwd: 'D:\\projects\\beta',
    sessionId: 'sess-beta',
    maxChars: 3000,
  })

  assert.ok(betaContext.text.includes('Always respond in Simplified Chinese'), 'global pack should inject')
  assert.ok(!betaContext.text.includes('Alpha-only secret architecture constraint'), 'workspace A must NEVER leak into workspace B')
  assert.ok(!betaContext.text.includes('INJECTED MALICIOUS INSTRUCTION'), 'tampered pack must NEVER inject')
  assert.equal(betaContext.excludedByScope.length, 1)
  assert.equal(betaContext.excludedByScope[0].packId, 'pack-alpha')
  assert.equal(betaContext.quarantined.length, 1)
  assert.equal(betaContext.quarantined[0].packId, 'pack-poison')
})

test('MemoryPackService supports pin, diff, verify-quarantine, rollback, and strict bundle import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-mem-'))
  try {
    const store = new FlowPackStore(dir)
    await store.ensureDirs()
    const wfSvc = new WorkflowService({}, store)
    const memSvc = new MemoryPackService({}, store, wfSvc)

    const p1 = await memSvc.pinEntry({
      packId: 'pack-demo',
      title: 'Demo Pack',
      scope: 'workspace',
      workspaceRoot: 'D:\\projects\\demo',
      section: 'decisions',
      text: 'Use atomic temp+rename persistence for store writes',
      sourceRef: 'lib/store.js',
      seal: true,
    })
    assert.equal(p1.pack.version, 1)
    assert.equal(p1.pack.sealState, 'sealed')

    const p2 = await memSvc.pinEntry({
      packId: 'pack-demo',
      section: 'pitfalls',
      text: 'Never call Remove-Item -Recurse on a Windows junction',
      sourceRef: 'install-profile.ps1',
      seal: true,
    })
    assert.equal(p2.pack.version, 2)

    const archives = await store.listPackArchives('pack-demo')
    assert.equal(archives.length, 2)

    const delta = diffPacks(archives.find(a => a.version === 1), p2.pack)
    assert.equal(delta.addedCount, 1)
    assert.ok(delta.sections.pitfalls.added.length === 1)

    const rolled = await memSvc.rollbackPack('pack-demo', 1)
    assert.equal(rolled.version, 1)
    assert.equal(rolled.entries.pitfalls.length, 0)

    // Strict import rejects tampered JSON
    const badBundle = structuredClone(p2.pack)
    badBundle.title = 'Tampered Import Title'
    await assert.rejects(() => memSvc.importBundle(JSON.stringify(badBundle)), /Import rejected by strict verifier/)

    // Tampered pack stored on disk is automatically moved to quarantine/
    await store.savePack(badBundle)
    const report = await memSvc.verifyAll({ cwd: 'D:\\projects\\demo' })
    assert.equal(report.ok, false)
    assert.ok(report.quarantinedNow.includes('pack-demo'))
    const remaining = await store.listPacks()
    assert.equal(remaining.packs.length, 0)
    const quarantined = await store.listQuarantined()
    assert.equal(quarantined.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('packFromSession filters system noise, derives clean session title, and produces buildMemorySummary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowpack-mem-sum-'))
  try {
    const store = new FlowPackStore(dir)
    await store.ensureDirs()
    const fakeSessionQuery = {
      async readSession() {
        return {
          session: { id: 'sess-noise-1', cwd: 'D:\\projects\\demo' },
          events: [
            {
              seq: 1,
              type: 'user/message',
              data: { text: 'The approval policy changed from "ask" to "never" (changed by the user).' },
            },
            {
              seq: 2,
              type: 'user/message',
              data: { text: '必须核对 D:\\projects\\demo\\report.xlsx，严禁修改原始备份表' },
            },
            {
              seq: 3,
              type: 'tool/call',
              data: { callId: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'D:\\projects\\demo\\report.xlsx' }) },
            },
            {
              seq: 4,
              type: 'tool/result',
              data: { callId: 'c1', content: 'ok', isError: false },
            },
          ],
        }
      },
      async readTitleSnapshots() {
        return [{ sessionId: 'sess-noise-1', displayTitle: '每日核对报表与备份保护' }]
      },
    }
    const mockCtx = { get: (k) => (k === 'sessionQuery' ? fakeSessionQuery : undefined) }
    const wfSvc = new WorkflowService(mockCtx, store)
    const memSvc = new MemoryPackService(mockCtx, store, wfSvc)

    const res = await memSvc.packFromSession({ sessionId: 'sess-noise-1', seal: true })
    assert.ok(res.pack.title.includes('每日核对报表与备份保护'))
    assert.ok(!res.pack.title.includes('approval policy'))
    assert.ok(res.memorySummary)
    assert.ok(res.memorySummary.totalEntries >= 1)
    assert.ok(Array.isArray(res.memorySummary.highlights) && res.memorySummary.highlights.length >= 1)
    assert.ok(res.memorySummary.highlights.every(h => !h.text.includes('approval policy')))
    assert.ok(res.memorySummary.recapLines.some(l => l.includes('共记住')))

    const summary = buildMemorySummary(res.pack)
    assert.equal(summary.totalEntries, res.memorySummary.totalEntries)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
