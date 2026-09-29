import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, scenarioExpectations } from '../src/store.mjs';
import { runMeeting } from '../src/runner.mjs';
import { readConfig } from '../src/config.mjs';
function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'synthetic-crm-test-'));
  const store = openStore({ path: join(dir, 'crm.sqlite') });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
test('offline SDK fixture executes real database tools and persists scoped outcomes', async t => {
  const store = isolated(t);
  const before = store.snapshot();
  const run = await runMeeting({ store, meetingId: scenarioExpectations.meetingId, mode: 'offline', config: readConfig({}) });
  assert.equal(run.status, 'succeeded', run.error);
  const after = store.snapshot();
  const changed = after.deals.find(d => d.id === scenarioExpectations.dealId);
  for (const [key, value] of Object.entries(scenarioExpectations.expectedChanges)) assert.deepEqual(changed[key], value, key);
  assert.equal(after.tasks.length, before.tasks.length + 1);
  const task = after.tasks.at(-1);
  for (const [key, value] of Object.entries(scenarioExpectations.expectedTask)) assert.equal(task[key], value, key);
  for (const id of scenarioExpectations.preservedDealIds) assert.deepEqual(after.deals.find(d => d.id === id), before.deals.find(d => d.id === id));
  const responses = run.events.filter(e => e.type === 'llm_response');
  assert.equal(responses.length, 14);
  assert.deepEqual(new Set(responses.map(e => e.stage)), new Set(['extractMeetingFacts', 'reconcileDeal', 'assessDealReadiness', 'draftFollowUp']));
  assert.ok(responses.every(e => e.data.synthetic === true));
  assert.ok(run.events.filter(e => e.type === 'tool_call').length >= 10);
  assert.ok(run.events.some(e => e.type === 'mutation'));
});
test('model budget exhaustion leaves actual CRM data unchanged and run failed', async t => {
  const store = isolated(t);
  const before = store.snapshot();
  const run = await runMeeting({ store, meetingId: scenarioExpectations.meetingId, mode: 'offline', config: readConfig({ CRM_MAX_MODEL_CALLS: '1' }) });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /budget exhausted/);
  assert.deepEqual(store.snapshot(), before);
});
test('unconfigured live mode records failure without inference or database mutation', async t => {
  const store = isolated(t);
  const before = store.snapshot();
  const run = await runMeeting({ store, meetingId: scenarioExpectations.meetingId, mode: 'live', config: readConfig({}) });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /Live mode requires/);
  assert.equal(run.events.filter(e => e.type === 'llm_request').length, 0);
  assert.deepEqual(store.snapshot(), before);
});
