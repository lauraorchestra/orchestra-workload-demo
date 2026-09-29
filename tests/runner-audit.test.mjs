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
function scriptedTransport(steps) {
  let turn = 0;
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.equal(request.headers.get('x-lab-stage'), 'meetingFollowThrough');
    const body = await request.json();
    const step = steps[turn++];
    const message = step ? { role: 'assistant', content: null, tool_calls: [{
      id: `synthetic_call_${turn}`, type: 'function',
      function: { name: step.name, arguments: step.rawArguments ?? JSON.stringify(step.args) },
    }] } : { role: 'assistant', content: 'Scripted conversation ended; inspect the recorded actions and errors.' };
    return new Response(JSON.stringify({
      id: 'synthetic_completion', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    }), { headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic_request' } });
  };
}

function outcomeSteps({ taskDeal = expected.dealId, taskBody = expected.expectedTask.body } = {}) {
  return [
    { name: 'update_deal', args: { dealId: expected.dealId, expectedVersion: 1, changes: expected.expectedChanges, evidence: [expected.meetingId] } },
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
  ['a task belongs to another deal on the same account', { taskDeal: 'deal_maple_training' }],
  ['task wording was chosen by the agent', { taskBody: 'A different action selected by the scripted agent.' }],
]) {
  test(`persisted results are checked without grading business judgment when ${label}`, async t => {
    const store = isolated(t);
    const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}), offlineFetch: scriptedTransport(outcomeSteps(changes)) });
    assert.equal(run.status, 'succeeded');
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
    { name: 'get_deal', args: { dealId: expected.dealId, unexpected: true } },
    { name: 'get_deal', args: { dealId: 'synthetic_missing_deal' } },
    { name: 'unavailable_tool', args: {} },
  ];
  const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}), offlineFetch: scriptedTransport(steps) });
  assert.equal(run.status, 'succeeded', 'a completed conversation can explain rejected actions without making changes');
  assert.deepEqual(store.snapshot(), before);
  const { calls, results } = assertPairedAudit(run);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].data.rawArguments, malformed);
  assert.ok(results.every(result => typeof result.data.error === 'string'));
});

test('tool budget rejection journals the rejected attempt and stops execution', async t => {
  const store = isolated(t);
  const before = store.snapshot();
  const steps = [{ name: 'get_deal', args: { dealId: expected.dealId } }, { name: 'list_tasks', args: { dealId: expected.dealId } }];
  const run = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: { ...readConfig({}), maxToolCalls: 1 }, offlineFetch: scriptedTransport(steps) });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /budget exhausted/);
  assert.deepEqual(store.snapshot(), before);
  const { calls, results } = assertPairedAudit(run);
  assert.equal(calls.length, 2);
  assert.ok(results[0].data.result);
  assert.match(results[1].data.error, /budget exhausted/);
  assert.equal(run.events.filter(event => event.type === 'llm_request').length, 2);
});

test('retry after final-response budget exhaustion reuses the persisted equivalent task', async t => {
  const store = isolated(t);
  const first = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({ CRM_MAX_MODEL_CALLS: '9' }) });
  assert.equal(first.status, 'failed');
  assert.match(first.error, /budget exhausted/);
  assert.equal(first.after.tasks.length, first.before.tasks.length + 1);
  const retry = await runMeeting({ store, meetingId: expected.meetingId, mode: 'offline', config: readConfig({}) });
  assert.equal(retry.status, 'succeeded', retry.error);
  assert.deepEqual(retry.after.tasks, first.after.tasks);
  assertPairedAudit(first);
  assertPairedAudit(retry);
});
