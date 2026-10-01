import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.mjs';
import { readConfig } from '../src/config.mjs';
import { runMeeting } from '../src/runner.mjs';
import { compareModels, evaluateRun, runMetrics, validateComparison } from '../src/comparison.mjs';

function isolated(t) { const store = openStore({ path: ':memory:' }); t.after(() => store.close()); return store; }
const config = readConfig({});
const meetingId = 'mtg_cedar_explicit';
test('explicit changes preserve commercial terms, draft the right recipients, and require human approval', async t => {
  const store = isolated(t);
  assert.equal(store.overview().timeline.filter(s => s.accountId === 'acct_cedar').length, 63);
  const run = await runMeeting({ store, meetingId, mode: 'offline', config });
  assert.equal(run.status, 'succeeded', run.error);
  assert.equal(evaluateRun(run).passed, true);
  assert.ok(run.events.some(e => e.type === 'tool_result' && e.data.name === 'get_timeline' && e.data.result.timeline.length === 63));
  const draft = store.snapshot().drafts[0];
  assert.throws(() => store.executeTool('approve_draft', { draftId: draft.id }, { runId: run.id }), /does not exist/);
  const review = { expectedVersion: draft.version, subject: draft.subject, body: draft.body, recipientContactIds: draft.recipientContactIds, approve: true };
  assert.throws(() => store.reviewDraft(draft.id, { ...review, recipientContactIds: ['contact_maple_maya'] }), /different account|belong/);
  const approved = store.reviewDraft(draft.id, review);
  assert.equal(approved.status, 'approved'); assert.ok(approved.approvedAt);
  assert.throws(() => store.reviewDraft(draft.id, review), /changed/);
  const edited = store.reviewDraft(draft.id, { ...review, expectedVersion: approved.version, body: approved.body + '\nEdited.', approve: false });
  assert.equal(edited.status, 'needs_review'); assert.equal(edited.approvedAt, null);
  assert.equal(store.getRun(run.id).events.filter(e => e.type === 'draft_review').length, 2);
  assert.equal(store.getRun(run.id).after.drafts[0].status, 'needs_review');
});
test('ambiguous call leaves CRM facts and tasks unchanged and drafts a clarification', async t => {
  const store = isolated(t); const before = store.snapshot();
  const run = await runMeeting({ store, meetingId: 'mtg_cedar_ambiguous', mode: 'offline', config });
  assert.equal(run.status, 'succeeded', run.error);
  assert.deepEqual(run.after.deals, before.deals); assert.deepEqual(run.after.tasks, before.tasks);
  assert.equal(evaluateRun(run).passed, true);
});
test('comparison uses identical fresh data and preserves working CRM including approved drafts', async t => {
  const store = isolated(t);
  const run = await runMeeting({ store, meetingId, mode: 'offline', config });
  const draft = run.after.drafts[0];
  store.reviewDraft(draft.id, { expectedVersion: 1, subject: draft.subject, body: draft.body, recipientContactIds: draft.recipientContactIds, approve: true });
  const before = store.snapshot();
  const comparison = await compareModels({ store, config, args: { meetingId, mode: 'offline', baselineModel: 'frontier-example', candidateModel: 'open-example' } });
  assert.equal(comparison.status, 'completed'); assert.equal(comparison.identicalStartingState, true);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(comparison.sides[0].run.before, comparison.sides[1].run.before);
  assert.equal(comparison.sides[0].run.before.drafts.length, 0);
  assert.equal(comparison.sides[0].run.before.deals.find(d => d.id === 'deal_cedar').deployment, 'cloud');
  assert.ok(comparison.sides.every(s => s.evaluation.passed && s.metrics.synthetic && s.metrics.estimatedCostUSD === null && s.metrics.inputTokens === null));
  assert.equal(store.getComparison(comparison.id).sides.length, 2);
});
test('scenario evaluator catches wrong recipient, invented task, changed unrelated field, and missing draft', async t => {
  const store = isolated(t); const original = await runMeeting({ store, meetingId, mode: 'offline', config });
  for (const mutate of [run => run.after.drafts[0].recipientContactIds.push('contact_cedar_robin'), run => run.after.tasks.push({ id: 'invented', dealId: 'deal_cedar' }), run => run.after.deals.find(d => d.id === 'deal_cedar').amount = 110000, run => run.after.drafts = []]) {
    const run = structuredClone(original); mutate(run); assert.equal(evaluateRun(run).passed, false);
  }
});
test('missing usage, fixture mode or changed served model cannot produce a misleading cost', () => {
  const pricing = { input: 2, output: 8 };
  const run = { mode: 'live', startedAt: '2026-09-30T10:00:00Z', finishedAt: '2026-09-30T10:00:01Z', events: [{ type: 'llm_request' }, { type: 'llm_response', data: { model: 'test', effectiveModel: 'test', usage: { prompt_tokens: 1000, completion_tokens: 100 } } }] };
  assert.equal(runMetrics(run, pricing).estimatedCostUSD, 0.0028);
  assert.equal(runMetrics({ ...run, mode: 'offline' }, pricing).estimatedCostUSD, null);
  run.events[1].data.effectiveModel = 'another'; assert.equal(runMetrics(run, pricing).estimatedCostUSD, null);
  run.events.push({ type: 'llm_request' }); assert.equal(runMetrics(run, pricing).inputTokens, null);
  assert.throws(() => validateComparison({ meetingId, mode: 'live', baselineModel: 'a', candidateModel: 'b' }, config), /not configured/);
  assert.throws(() => validateComparison({ meetingId, mode: 'offline', baselineModel: 'a', candidateModel: 'b', pricing: { baseline: { input: -1, output: 1 } } }, config), /rates/);
});

test('comparison draft review records edits separately and preserves original outcome evidence', async t => {
  const store = isolated(t);
  const c = await compareModels({ store, config, args: { meetingId, mode: 'offline', baselineModel: 'a', candidateModel: 'b' } });
  const original = c.sides[1].run.after.drafts[0];
  const args = { side: 'candidate', expectedVersion: original.version, recipientContactIds: original.recipientContactIds, subject: original.subject, body: original.body, approve: true };
  assert.throws(() => store.reviewComparisonDraft(c.id, original.id, { ...args, recipientContactIds: ['contact_maple_maya'] }), /Recipients/);
  const approved = store.reviewComparisonDraft(c.id, original.id, args);
  assert.equal(approved.status, 'approved');
  assert.throws(() => store.reviewComparisonDraft(c.id, original.id, args), /changed/);
  const saved = store.getComparison(c.id);
  assert.equal(saved.sides[1].run.after.drafts[0].status, 'needs_review');
  assert.equal(saved.sides[1].reviewedDrafts[0].status, 'approved');
  assert.equal(saved.sides[1].run.events.at(-1).type, 'draft_review');
  assert.equal(store.snapshot().drafts.length, 0);
  const edited = store.reviewComparisonDraft(c.id, original.id, { ...args, expectedVersion: approved.version, approve: false, body: original.body + '\nReviewed.' });
  assert.equal(edited.status, 'needs_review'); assert.equal(edited.approvedAt, null);
});
test('candidate guidance is an explicit experimental variable without altering baseline messages or fixture evidence', async t => {
  const store = isolated(t);
  const c = await compareModels({ store, config, args: { meetingId, mode: 'offline', baselineModel: 'a', candidateModel: 'b', candidateGuidance: 'Review the dated evidence.' } });
  assert.equal(c.identicalStartingState, true); assert.equal(c.identicalInstructions, false);
  const requests = c.sides.map(side => side.run.events.find(e => e.type === 'llm_request').data.request.messages);
  assert.equal(requests[0][0].content, requests[1][0].content);
  assert.equal(JSON.parse(requests[0][1].content).operatorGuidance, undefined);
  assert.equal(JSON.parse(requests[1][1].content).operatorGuidance, 'Review the dated evidence.');
  assert.ok(c.sides.every(side => side.metrics.synthetic && side.metrics.estimatedCostUSD === null));
});

test('curated missed-context replay completes tools but fails quality checks and is forbidden in live mode', async t => {
  const store = isolated(t);
  const c = await compareModels({ store, config, args: { meetingId, mode: 'offline', baselineModel: 'a', candidateModel: 'b', candidateReplay: 'missed_context' } });
  assert.equal(c.status, 'completed');
  assert.equal(c.sides[0].evaluation.passed, true);
  assert.equal(c.sides[1].run.status, 'succeeded');
  assert.equal(c.sides[1].evaluation.passed, false);
  const failed = c.sides[1].evaluation.checks.filter(check => !check.pass).map(check => check.name);
  assert.ok(failed.includes('frontierSpendMonthly: confirmed value'));
  assert.ok(failed.includes('deployment: confirmed value'));
  assert.ok(failed.includes('Correct prospect recipients'));
  assert.match(c.sides[1].run.summary, /intentionally incorrect/);
  assert.equal(c.sides[1].metrics.estimatedCostUSD, null);
  assert.throws(() => validateComparison({ meetingId, mode: 'live', baselineModel: 'a', candidateModel: 'b', candidateReplay: 'missed_context' }, { ...config, liveReady: true }), /offline/);
});
