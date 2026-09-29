import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openStore, scenarioExpectations as expected } from '../src/store.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'synthetic-crm-recovery-'));
  const path = join(directory, '.understudy', 'crm.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, path };
}

test('explicit recovery after SIGKILL preserves partial writes and releases the run lock', { timeout: 15000 }, async (t) => {
  const { directory, path } = fixture(t);
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    const { openStore, scenarioExpectations: expected } = await import(process.argv[1]);
    const store = openStore({ path: process.argv[2] });
    const run = store.createRun({ meetingId: expected.meetingId, mode: 'offline' });
    store.executeTool('update_deal', {
      dealId: expected.dealId, expectedVersion: 1,
      changes: { amount: 48000 }, evidence: [expected.meetingId],
    }, { runId: run.id });
    process.send({ runId: run.id });
    setInterval(() => {}, 1000);
  `, new URL('../src/store.mjs', import.meta.url).href, path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let childError = '';
  child.stderr.on('data', (data) => { childError += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  const message = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Synthetic owner exited before readiness: ${childError}`)));
  });
  const store = openStore({ path });
  t.after(() => store.close());
  const original = store.getRun(message.runId);
  const partial = store.snapshot();
  assert.equal(original.status, 'running');
  assert.equal(partial.deals.find(deal => deal.id === expected.dealId).amount, 48000);
  assert.throws(() => store.recoverAbandonedRuns(), { code: 'RUN_ACTIVE' });
  assert.throws(() => store.createRun({ meetingId: expected.meetingId, mode: 'offline' }), { code: 'RUN_ACTIVE' });
  assert.throws(() => store.reset(), { code: 'RUN_ACTIVE' });
  assert.deepEqual(store.getRun(message.runId), original);

  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  // Death alone must not silently erase or unlock the interrupted run.
  assert.throws(() => store.createRun({ meetingId: expected.meetingId, mode: 'offline' }), { code: 'RUN_ACTIVE' });
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('../src/run.mjs', import.meta.url)), '--recover'], { cwd: directory, encoding: 'utf8', timeout: 5000 });
  assert.deepEqual(JSON.parse(stdout), { recovered: [message.runId] });
  const recovered = store.getRun(message.runId);
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.error.code, 'RUN_ABANDONED');
  assert.ok(recovered.finishedAt);
  assert.deepEqual(recovered.before, original.before);
  assert.deepEqual(recovered.after, partial);
  assert.deepEqual(store.snapshot(), partial);
  assert.deepEqual(recovered.events.slice(0, -1), original.events);
  assert.equal(recovered.events.at(-1).type, 'recovery');
  assert.equal(recovered.events.at(-1).data.ownerPid, child.pid);
  assert.deepEqual(store.recoverAbandonedRuns(), []);
  const next = store.createRun({ meetingId: expected.meetingId, mode: 'offline' });
  store.finishRun(next.id, { status: 'failed', error: 'Synthetic completion.' });
  assert.deepEqual(store.reset(), original.before);
});

test('legacy schema migration preserves run evidence and fails closed without owner metadata', (t) => {
  const { path } = fixture(t);
  const initial = openStore({ path });
  const run = initial.createRun({ meetingId: expected.meetingId, mode: 'offline' });
  initial.appendEvent(run.id, { type: 'tool_call', stage: 'synthetic', data: { name: 'get_deal' } });
  const original = initial.getRun(run.id);
  initial.close();
  const legacy = new DatabaseSync(path);
  legacy.exec('ALTER TABLE runs DROP COLUMN owner_pid; ALTER TABLE runs DROP COLUMN owner_hostname;');
  legacy.close();
  const store = openStore({ path });
  t.after(() => store.close());
  assert.deepEqual(store.getRun(run.id), original);
  assert.throws(() => store.recoverAbandonedRuns(), { code: 'RUN_OWNER_UNKNOWN' });
  assert.deepEqual(store.getRun(run.id), original);
  assert.throws(() => store.reset(), { code: 'RUN_ACTIVE' });
});

test('foreign owner metadata does not authorize local PID recovery', (t) => {
  const { path } = fixture(t);
  const store = openStore({ path });
  t.after(() => store.close());
  const run = store.createRun({ meetingId: expected.meetingId, mode: 'offline' });
  const db = new DatabaseSync(path);
  db.prepare('UPDATE runs SET owner_hostname = ? WHERE id = ?').run('synthetic-other-host.invalid', run.id);
  db.close();
  assert.throws(() => store.recoverAbandonedRuns(), { code: 'RUN_OWNER_UNKNOWN' });
  assert.deepEqual(store.getRun(run.id), run);
});
