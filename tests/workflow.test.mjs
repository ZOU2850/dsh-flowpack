import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSessionTrace } from '../lib/session-trace.js'
import { applyOptimizationPass, diffWorkflow, distillWorkflowFromTrace, restoreWorkflowGeneration } from '../lib/workflow.js'

function sampleSnapshot() {
  const cwd = 'D:\\projects\\demo-app'
  return {
    header: { id: 'sess-alpha-01', cwd, createdAt: 1700000000000, title: 'Fix Auth Middleware' },
    events: [
      {
        seq: 1,
        time: 1700000001000,
        type: 'user/message',
        data: {
          content: [{
            type: 'text',
            text: '必须保留现有注释风格，不要破坏鉴权逻辑。Fix the auth middleware bug and run tests.',
          }],
        },
      },
      // Two independent reads that should batch in parallel
      { seq: 2, time: 1700000002000, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read_file', arguments: JSON.stringify({ path: `${cwd}\\src\\auth.js` }) } },
      { seq: 3, time: 1700000002100, type: 'tool/result', data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'auth content' }] } } },
      // Duplicate read of the exact same file (should be pruned!)
      { seq: 4, time: 1700000003000, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read_file', arguments: JSON.stringify({ path: `${cwd}\\src\\auth.js` }) } },
      { seq: 5, time: 1700000003100, type: 'tool/result', data: { message: { toolCallId: 'c2', isError: false, content: [{ type: 'text', text: 'auth content' }] } } },
      // Second distinct read right after -> should pair into parallel batch with c1
      { seq: 6, time: 1700000004000, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c3', name: 'grep_search', arguments: JSON.stringify({ pattern: 'verifyToken', path: `${cwd}\\src` }) } },
      { seq: 7, time: 1700000004100, type: 'tool/result', data: { message: { toolCallId: 'c3', isError: false, content: [{ type: 'text', text: 'matched line 42' }] } } },
      // Failed edit followed by successful edit retry -> retry absorbed into guardrail
      { seq: 8, time: 1700000005000, type: 'tool/call', data: { turn: 2, step: 1, callId: 'c4', name: 'edit_file', arguments: JSON.stringify({ path: `${cwd}\\src\\auth.js` }) } },
      { seq: 9, time: 1700000005100, type: 'tool/result', data: { message: { toolCallId: 'c4', isError: true, content: [{ type: 'text', text: 'Target text did not match whitespace in auth.js' }] } } },
      { seq: 10, time: 1700000006000, type: 'tool/call', data: { turn: 2, step: 2, callId: 'c5', name: 'edit_file', arguments: JSON.stringify({ path: `${cwd}\\src\\auth.js` }) } },
      { seq: 11, time: 1700000006100, type: 'tool/result', data: { message: { toolCallId: 'c5', isError: false, content: [{ type: 'text', text: 'Edited successfully' }] } } },
      // Verification command passes
      { seq: 12, time: 1700000007000, type: 'tool/call', data: { turn: 3, step: 1, callId: 'c6', name: 'run_command', arguments: JSON.stringify({ CommandLine: 'npm test' }) } },
      { seq: 13, time: 1700000008000, type: 'tool/result', data: { message: { toolCallId: 'c6', isError: false, content: [{ type: 'text', text: 'All 12 tests passed' }] } } },
      { seq: 14, time: 1700000009000, type: 'deliverables/presented', data: { files: [{ path: `${cwd}\\src\\auth.js`, description: 'Updated middleware' }] } },
    ],
  }
}

test('distillWorkflowFromTrace deduplicates reads, absorbs retries, batches parallel reads, and generates SKILL + PTC script', () => {
  const trace = normalizeSessionTrace(sampleSnapshot())
  assert.equal(trace.steps.length, 6)
  assert.equal(trace.failures.length, 1)
  assert.equal(trace.verificationCommands.length, 1)
  assert.equal(trace.verificationCommands[0].passed, true)
  assert.ok(trace.constraintCandidates.some(c => c.text.includes('必须保留现有注释风格')))

  const wf = distillWorkflowFromTrace(trace, { name: 'fix-auth-flow', title: 'Auth Middleware Fix Flow' })
  const m = wf.optimized.metrics

  assert.equal(m.beforeSteps, 6)
  assert.equal(m.duplicatesRemoved, 1, 'duplicate read_file should be removed')
  assert.equal(m.retriesResolved, 1, 'failed edit_file should be absorbed by retry')
  assert.ok(m.parallelStagesCount >= 1, 'read_file + grep_search should merge into a parallel stage')
  assert.ok(m.guardrailsAdded >= 1, 'absorbed error must create a guardrail')
  assert.ok(m.afterScore >= m.beforeScore, 'optimized score should improve')

  assert.match(wf.artifacts.skillMarkdown, /^---\nname: fix-auth-flow\n/m)
  assert.match(wf.artifacts.skillMarkdown, /防呆护栏/)
  assert.match(wf.artifacts.workflowScript, /await phase\(/)
  assert.match(wf.artifacts.workflowScript, /await parallel\(\[/)
  assert.match(wf.artifacts.workflowScript, /agent\(\{/)
  assert.equal(wf.maturity, 'emerging', 'passing test run advances from initial exploring state')
  assert.equal(wf.genealogy.length, 1)
  assert.equal(wf.genealogy[0].gen, 1)
})

test('applyOptimizationPass upgrades version, injects custom guardrail, preserves full prior genealogy, and restores forward', () => {
  const trace = normalizeSessionTrace(sampleSnapshot())
  const wf1 = distillWorkflowFromTrace(trace)
  const wf2 = applyOptimizationPass(wf1, {
    addGuardrail: '修改鉴权中间件前必须先跑基线单测',
    promote: true,
  })

  assert.equal(wf2.version, 2)
  assert.equal(wf2.promotedAsSkill, true)
  assert.ok(wf2.optimized.guardrails.some(g => g.rule.includes('修改鉴权中间件前必须先跑基线单测')))
  assert.equal(wf2.genealogy.length, 2, 'must preserve Gen 1 baseline + Gen 2 optimization snapshot')
  assert.equal(wf2.genealogy[0].gen, 1)
  assert.ok(Array.isArray(wf2.genealogy[0].stagesSnapshot) && wf2.genealogy[0].stagesSnapshot.length > 0)

  const wf3 = restoreWorkflowGeneration(wf2, 1)
  assert.equal(wf3.version, 3)
  assert.equal(wf3.genealogy.length, 3, 'restoring Gen 1 creates Gen 3 forward without erasing Gen 2')
  assert.equal(wf3.optimized.guardrails.length, wf2.genealogy[0].guardrailsSnapshot.length)

  const diff = diffWorkflow(wf2, 1, 2)
  assert.equal(diff.from.version, 1)
  assert.equal(diff.to.version, 2)
  assert.ok(diff.to.guardrailsAdded > diff.from.guardrailsAdded)
})
