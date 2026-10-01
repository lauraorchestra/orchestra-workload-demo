import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, scenarioExpectations as expected, toolDefinitions } from '../src/store.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'synthetic-crm-'));
  const path = join(directory, 'private', 'crm.sqlite');
  const store = openStore({ path });
  t.after(() => { try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const run = store.createRun({ meetingId: expected.meetingId, mode: 'offline' });
  return { store, path, run, context: { runId: run.id } };
}
const updateArgs = () => ({ dealId: expected.dealId, expectedVersion: 1, changes: { ...expected.expectedChanges }, evidence: [expected.meetingId, 'tl_maple_tentative'] });
const taskArgs = () => ({ dealId: expected.dealId, ...expected.expectedTask, evidence: [expected.meetingId] });

test('synthetic account discovery includes similar names and dated conflicting context', (t) => {
  const { store } = fixture(t);
  const accounts = store.executeTool('search_accounts', { query: 'Maple Works' }).accounts;
  assert.equal(accounts.length, 2);
  assert.notEqual(accounts[0].id, accounts[1].id);
  const account = store.executeTool('get_account', { accountId: expected.accountId });
  assert.equal(account.contacts.length, 3);
  const timeline = store.executeTool('get_timeline', { accountId: expected.accountId }).timeline;
  assert.ok(timeline.some((item) => item.body.includes('$64,000')));
  assert.ok(timeline.some((item) => item.body.includes('$52,000')));
  assert.ok(store.getMeeting(expected.meetingId).note.includes('$48,000'));
  assert.equal(store.overview().deals.length, 5);
  assert.equal(toolDefinitions.length, 10);
});

test('accepted mutations persist with atomic audits and before/after run snapshots', (t) => {
  const { store, path, run, context } = fixture(t);
  const before = store.snapshot();
  store.appendEvent(run.id, { type: 'tool_call', stage: 'reconcile', data: { name: 'update_deal' } });
  const deal = store.executeTool('update_deal', updateArgs(), context);
  const task = store.executeTool('create_follow_up_task', taskArgs(), context);
  assert.equal(deal.version, 2);
  for (const [field, value] of Object.entries(expected.expectedChanges)) assert.equal(deal[field], value);
  assert.equal(task.status, 'open');
  assert.equal(task.accountId, expected.accountId);
  const finished = store.finishRun(run.id, { status: 'succeeded', summary: 'Synthetic changes applied.' });
  assert.deepEqual(finished.before, before);
  assert.deepEqual(finished.after, store.snapshot());
  assert.deepEqual(finished.events.map((event) => event.type), ['tool_call', 'mutation', 'mutation']);
  assert.deepEqual(finished.events[1].data.before, before.deals.find((item) => item.id === expected.dealId));
  assert.deepEqual(finished.events[1].data.after, deal);
  for (const dealId of expected.preservedDealIds) assert.deepEqual(finished.after.deals.find((item) => item.id === dealId), before.deals.find((item) => item.id === dealId));
  assert.deepEqual(finished.after.tasks.filter((item) => item.id !== task.id), before.tasks);
  store.close();
  const reopened = openStore({ path });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getRun(run.id), finished);
  assert.equal(reopened.snapshot().tasks.at(-1).id, task.id);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700);
});

test('field, type, date, version, evidence and account violations cause no writes or audit events', (t) => {
  const { store, run, context } = fixture(t);
  const initial = store.snapshot();
  const invalid = [
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { accountId: 'acct_lantern' } }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { version: 88 } }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: {} }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { stage: 'signed' } }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { amount: '48000' } }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { amount: 48.5 } }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { amount: -1 } }],
    ['INVALID_ARGUMENT', { ...updateArgs(), changes: { nextStep: ' ' } }],
    ['INVALID_DATE', { ...updateArgs(), changes: { amount: 48000, closeDate: '2026-02-30' } }],
    ['INVALID_DATE', { ...updateArgs(), changes: { closeDate: '11/20/2026' } }],
    ['VERSION_CONFLICT', { ...updateArgs(), expectedVersion: 2 }],
    ['INVALID_ARGUMENT', { ...updateArgs(), expectedVersion: '1' }],
    ['INVALID_EVIDENCE', { ...updateArgs(), evidence: [] }],
    ['INVALID_EVIDENCE', { ...updateArgs(), evidence: ['made_up_source'] }],
    ['INVALID_EVIDENCE', { ...updateArgs(), evidence: ['tl_systems_pilot'] }],
    ['INVALID_EVIDENCE', { ...updateArgs(), evidence: [expected.meetingId, expected.meetingId] }],
    ['SCOPE_MISMATCH', { ...updateArgs(), changes: { championContactId: 'contact_systems_mara' } }],
    ['SCOPE_MISMATCH', { ...updateArgs(), dealId: 'deal_systems_rollout', expectedVersion: 3 }],
    ['INVALID_ARGUMENT', { ...updateArgs(), unexpected: true }],
  ];
  for (const [code, args] of invalid) {
    assert.throws(() => store.executeTool('update_deal', args, context), { code });
    assert.deepEqual(store.snapshot(), initial, `Rejected ${code} must not partially mutate state`);
    assert.deepEqual(store.getRun(run.id).events, [], `Rejected ${code} must not claim a mutation`);
  }
});

test('task validation rejects impossible dates, cross-account evidence, extras and conflicting duplicates', (t) => {
  const { store, run, context } = fixture(t);
  const initial = store.snapshot();
  for (const [code, args] of [
    ['INVALID_DATE', { ...taskArgs(), dueDate: '2026-02-29' }],
    ['INVALID_ARGUMENT', { ...taskArgs(), title: '' }],
    ['INVALID_ARGUMENT', { ...taskArgs(), body: 123 }],
    ['INVALID_ARGUMENT', { ...taskArgs(), sendEmail: true }],
    ['INVALID_EVIDENCE', { ...taskArgs(), evidence: ['tl_lantern_delivery'] }],
    ['SCOPE_MISMATCH', { ...taskArgs(), dealId: 'deal_lantern_sensors' }],
  ]) {
    assert.throws(() => store.executeTool('create_follow_up_task', args, context), { code });
    assert.deepEqual(store.snapshot(), initial);
    assert.equal(store.getRun(run.id).events.length, 0);
  }
  const task = store.executeTool('create_follow_up_task', taskArgs(), context);
  const after = store.snapshot();
  assert.deepEqual(store.executeTool('create_follow_up_task', taskArgs(), context), task);
  assert.throws(() => store.executeTool('create_follow_up_task', { ...taskArgs(), body: 'A conflicting description.' }, context), { code: 'DUPLICATE_TASK' });
  assert.deepEqual(store.snapshot(), after);
  assert.equal(store.getRun(run.id).events.length, 1);
  const completed = store.snapshot().tasks.find(task => task.dealId === expected.dealId && task.status === 'completed');
  assert.ok(completed);
  const { dealId, title, dueDate, body, evidence } = completed;
  assert.throws(() => store.executeTool('create_follow_up_task', { dealId, title, dueDate, body, evidence }, context), { code: 'DUPLICATE_TASK' });
  assert.deepEqual(store.snapshot(), after);
  assert.equal(store.getRun(run.id).events.length, 1);
});

test('a later run reuses an identical committed task without another mutation', (t) => {
  const { store, run, context } = fixture(t);
  const args = { ...taskArgs(), evidence: [expected.meetingId, 'tl_maple_tentative'] };
  const task = store.executeTool('create_follow_up_task', args, context);
  store.finishRun(run.id, { status: 'failed', error: 'Synthetic failure after the task was committed.' });
  const retry = store.createRun({ meetingId: expected.meetingId, mode: 'offline' });
  const persisted = store.snapshot();
  assert.deepEqual(store.executeTool('create_follow_up_task', { ...args, evidence: [...args.evidence].reverse() }, { runId: retry.id }), task);
  assert.deepEqual(store.snapshot(), persisted);
  assert.equal(store.getRun(retry.id).events.length, 0);
  assert.throws(() => store.executeTool('create_follow_up_task', { ...args, evidence: [expected.meetingId] }, { runId: retry.id }), { code: 'DUPLICATE_TASK' });
  assert.equal(store.getRun(run.id).events.filter(event => event.type === 'mutation').length, 1);
});

test('optimistic versions detect stale writes across independent SQLite connections', (t) => {
  const { store, path, run, context } = fixture(t);
  const second = openStore({ path });
  t.after(() => second.close());
  const observed = second.executeTool('get_deal', { dealId: expected.dealId });
  store.executeTool('update_deal', updateArgs(), context);
  const after = store.snapshot();
  assert.throws(() => second.executeTool('update_deal', { ...updateArgs(), expectedVersion: observed.version, changes: { amount: 52000 } }, context), { code: 'VERSION_CONFLICT' });
  assert.deepEqual(second.snapshot(), after);
  assert.equal(second.getRun(run.id).events.length, 1);
});

test('mutations require an active run and cannot continue after completion', (t) => {
  const { store, run, context } = fixture(t);
  assert.throws(() => store.executeTool('update_deal', updateArgs()), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => store.createRun({ meetingId: expected.meetingId, mode: 'offline' }), { code: 'RUN_ACTIVE' });
  assert.throws(() => store.reset(), { code: 'RUN_ACTIVE' });
  store.finishRun(run.id, { status: 'failed', error: { code: 'SYNTHETIC_FAILURE', message: 'A deliberate synthetic failure.' } });
  const after = store.snapshot();
  assert.throws(() => store.executeTool('update_deal', updateArgs(), context), { code: 'RUN_FINISHED' });
  assert.throws(() => store.executeTool('create_follow_up_task', taskArgs(), context), { code: 'RUN_FINISHED' });
  assert.throws(() => store.appendEvent(run.id, { type: 'late', stage: 'tool', data: {} }), { code: 'RUN_FINISHED' });
  assert.deepEqual(store.snapshot(), after);
  assert.equal(store.getRun(run.id).after.deals.length, 5);
});

test('reset restores exact seeds, removes runs/audits, and allows a fresh run', (t) => {
  const { store, run, context } = fixture(t);
  const initial = store.snapshot();
  store.executeTool('update_deal', updateArgs(), context);
  store.executeTool('create_follow_up_task', taskArgs(), context);
  store.finishRun(run.id, { status: 'succeeded' });
  assert.equal(store.listRuns().length, 1);
  assert.deepEqual(store.reset(), initial);
  assert.deepEqual(store.snapshot(), initial);
  assert.deepEqual(store.listRuns(), []);
  assert.throws(() => store.getRun(run.id), { code: 'NOT_FOUND' });
  assert.equal(store.createRun({ meetingId: expected.meetingId, mode: 'offline' }).status, 'running');
});

test('read tools reject unknown keys, unknown tools, malformed IDs and absent records', (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.executeTool('get_field_definitions', { includeSecrets: true }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => store.executeTool('search_accounts', { query: '' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => store.executeTool('get_deal', { dealId: "x' OR 1=1" }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => store.executeTool('get_account', { accountId: 'does_not_exist' }), { code: 'NOT_FOUND' });
  assert.throws(() => store.executeTool('send_email', {}), { code: 'UNKNOWN_TOOL' });
  assert.throws(() => store.executeTool('toString', {}), { code: 'UNKNOWN_TOOL' });
});
