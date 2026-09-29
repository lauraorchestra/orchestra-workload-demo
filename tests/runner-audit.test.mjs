import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, scenarioExpectations as expected } from '../src/store.mjs';
import { readConfig } from '../src/config.mjs';
import { runMeeting } from '../src/runner.mjs';

function isolated(t) {
  const directory = mkdtempSync(join(tmpdir(), 'synthetic-crm-audit-'));
  const store = openStore({ path: join(directory, 'crm.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return store;
}

// Exercise the real SDK and runner with deliberately incorrect tool decisions.
// This transport never contacts a service or exposes the oracle to live models.
function scriptedTransport(steps, stageAnswers = {}) {
  let turn = 0;
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const stage = request.headers.get('x-lab-stage');
    const body = await request.json();
    let message;
    if (stage === 'reconcileDeal') {
      const step = steps[turn++];
      message = step ? { role: 'assistant', content: null, tool_calls: [{
        id: `synthetic_call_${turn}`, type: 'function',
        function: { name: step.name, arguments: step.rawArguments ?? JSON.stringify(step.args) },
      }] } : { role: 'assistant', content: 'The work is complete.' };
    } else {
      const answer = stageAnswers[stage] ?? {
        extractMeetingFacts: { accountHint: 'Synthetic meeting', facts: [], uncertainties: [] },
        assessDealReadiness: { stage: 'negotiation', rationale: 'Synthetic assessment.', evidence: [expected.meetingId] },
        draftFollowUp: expected.expectedTask,
      }[stage];
      message = { role: 'assistant', content: typeof answer === 'string' ? answer : JSON.stringify(answer) };
    }
    return new Response(JSON.stringify({
      id: 'synthetic_completion', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    }), { headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic_request' } });
  };
}

function outcomeSteps({ assessmentDeal = expected.dealId, draftDeal = expected.dealId, taskDeal = expected.dealId, taskBody = expected.expectedTask.body } = {}) {
  return [
    { name: 'assess_deal_readiness', args: { dealId: assessmentDeal } },
    { name: 'update_deal', args: { dealId: expected.dealId, expectedVersion: 1, changes: expected.expectedChanges, evidence: [expected.meetingId] } },
    { name: 'draft_follow_up', args: { dealId: draftDeal } },
    { name: 'create_follow_up_task', args: { dealId: taskDeal, ...expected.expectedTask, body: taskBody, evidence: [expected.meetingId] } },
  ];
}

function assertPairedAudit(run) {
  const calls = run.events.filter(event => event.type === 'tool_call');
  const results = run.events.filter(event => event.type === 'tool_result');
  assert.equal(new Set(calls.map(event => event.data.attemptId)).size, calls.length);
  assert.equal(results.length, calls.length);
  for (const call of calls) {
    const paired = results.filter(result => result.data.attemptId === call.data.attemptId);
    assert.equal(paired.length, 1, call.data.name);
    assert.equal(paired[0].data.name, call.data.name);
    assert.ok(run.events.indexOf(paired[0]) > run.events.indexOf(call));
  }
  return { calls, results };
}

for (const [label, changes] of [
  ['task belongs to another deal on the same account', { taskDeal: 'deal_maple_training' }],
  ['assessment belongs to another deal on the same account', { assessmentDeal: 'deal_maple_training' }],
  ['draft belongs to another deal on the same account', { draftDeal: 'deal_maple_training' }],
  ['persisted task differs from the draft', { taskBody: 'A different, unsupported action.' }],
]) {
  test(`completion fails when ${label}, preserving already-applied changes`, async t => {
    const store = isolated(t);
    const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}), offlineFetch: scriptedTransport(outcomeSteps(changes)) });
    assert.equal(run.status, 'failed');
    assert.match(run.error, /one consistent deal outcome/);
    assert.equal(run.after.deals.find(deal => deal.id === expected.dealId).amount, expected.expectedChanges.amount);
    assert.equal(run.after.tasks.length, run.before.tasks.length + 1);
    assert.deepEqual(store.snapshot(), run.after);
    assertPairedAudit(run);
  });
}

test('every malformed or rejected tool attempt has one raw call and one error result', async t => {
  const store = isolated(t);
  const before = store.snapshot();
  const malformed = '{"dealId":';
  const steps = [
    { name: 'get_deal', rawArguments: malformed },
    { name: 'assess_deal_readiness', args: { dealId: expected.dealId, unexpected: true } },
    { name: 'draft_follow_up', args: { dealId: 'synthetic_missing_deal' } },
    { name: 'unavailable_tool', args: {} },
  ];
  const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}), offlineFetch: scriptedTransport(steps) });
  assert.equal(run.status, 'failed');
  assert.deepEqual(store.snapshot(), before);
  const { calls, results } = assertPairedAudit(run);
  assert.equal(calls.length, 5, 'four requested tools plus the nested deal lookup');
  assert.equal(calls[0].data.rawArguments, malformed);
  assert.ok(results.every(result => typeof result.data.error === 'string'));
  assert.ok(calls.some(call => call.stage === 'draft_follow_up' && call.data.name === 'get_deal'));
});

test('nested tool budget rejection journals both the rejected lookup and outer model tool', async t => {
  const store = isolated(t);
  const before = store.snapshot();
  const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: { ...readConfig({}), maxToolCalls: 1 }, offlineFetch: scriptedTransport([{ name: 'assess_deal_readiness', args: { dealId: expected.dealId } }]) });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /budget exhausted/);
  assert.deepEqual(store.snapshot(), before);
  const { calls, results } = assertPairedAudit(run);
  assert.equal(calls.length, 2);
  assert.ok(results.every(result => /budget exhausted/.test(result.data.error)));
  assert.equal(run.events.filter(event => event.type === 'llm_request').length, 2, 'no nested model request after exhausted tool budget');
});

test('invalid nested model output still completes the outer tool audit', async t => {
  const store = isolated(t);
  const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}), offlineFetch: scriptedTransport([{ name: 'draft_follow_up', args: { dealId: expected.dealId } }], { draftFollowUp: '{broken' }) });
  assert.equal(run.status, 'failed');
  const { calls, results } = assertPairedAudit(run);
  assert.equal(calls.length, 3);
  assert.ok(results.find(result => result.data.name === 'draft_follow_up').data.error);
  assert.equal(results.filter(result => result.data.result).length, 2, 'both successful nested reads remain recorded');
});

test('retry after final-response budget exhaustion reuses the persisted equivalent task', async t => {
  const store = isolated(t);
  const first = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({ CRM_MAX_MODEL_CALLS: '13' }) });
  assert.equal(first.status, 'failed');
  assert.match(first.error, /budget exhausted/);
  assert.equal(first.after.tasks.length, first.before.tasks.length + 1);
  const retry = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}) });
  assert.equal(retry.status, 'succeeded', retry.error);
  assert.deepEqual(retry.after.tasks, first.after.tasks);
  assertPairedAudit(first);
  assertPairedAudit(retry);
});
