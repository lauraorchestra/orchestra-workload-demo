import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('HTTP API distinguishes absent resources from malformed inputs without creating runs', { timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'synthetic-crm-http-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], {
    cwd: directory, env: { CRM_MODE: 'offline', CRM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => { throw new Error(`HTTP server exited before readiness: ${errors}`); }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  const absent = await fetch(`${origin}/api/runs/run_missing`);
  assert.equal(absent.status, 404);
  for (const [meetingId, status] of [['mtg_missing', 404], ['invalid/path', 400], [42, 400]]) {
    const response = await fetch(`${origin}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ meetingId, mode: 'offline' }),
    });
    assert.equal(response.status, status, String(meetingId));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.taskDemos.map(t => t.kind), ['extraction', 'classification']);
  assert.ok(state.taskDemos.every(t => !('expected' in t)));
  const post = async (path, value) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(value) });
  const started = await post('/api/runs', { meetingId: 'mtg_cedar_explicit', mode: 'offline' });
  assert.equal(started.status, 202);
  const { id } = await started.json();
  let finished;
  for (let i = 0; i < 40; i++) {
    finished = await (await fetch(`${origin}/api/runs/${id}`)).json();
    if (finished.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(finished.status, 'succeeded');
  const draft = finished.after.drafts[0];
  const review = { expectedVersion: draft.version, subject: draft.subject, body: draft.body, recipientContactIds: draft.recipientContactIds, approve: true };
  assert.equal((await post(`/api/drafts/${draft.id}`, { ...review, recipientContactIds: ['contact_maple_maya'] })).status, 400);
  const approved = await post(`/api/drafts/${draft.id}`, review);
  assert.equal(approved.status, 200); assert.equal((await approved.json()).status, 'approved');
  assert.equal((await post(`/api/drafts/${draft.id}`, review)).status, 409);
  const compared = await post('/api/comparisons', { meetingId: 'mtg_cedar_explicit', mode: 'offline', baselineModel: 'fixture-baseline', candidateModel: 'fixture-candidate' });
  assert.equal(compared.status, 202);
  let current;
  for (let i = 0; i < 40; i++) {
    current = await (await fetch(`${origin}/api/state`)).json();
    if (!current.activeComparison && current.comparisons[0]?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(current.comparisons[0].status, 'completed');
  assert.equal(current.drafts[0].status, 'approved');
  assert.equal(current.comparisons[0].sides[0].run.drafts[0].status, 'needs_review');
  const evidence = await fetch(`${origin}/api/runs/${current.comparisons[0].sides[0].run.id}`);
  assert.equal(evidence.status, 200);
  assert.ok((await evidence.json()).events.some(event => event.type === 'llm_request' && event.data.request));
  const taskStart = await post('/api/comparisons', { meetingId: 'demo_extract_events', mode: 'offline', baselineModel: 'fixture-baseline', candidateModel: 'fixture-candidate' });
  assert.equal(taskStart.status, 202);
  const taskId = (await taskStart.json()).id;
  let taskComparison;
  for (let i = 0; i < 40; i++) {
    const taskState = await (await fetch(`${origin}/api/state`)).json();
    taskComparison = taskState.comparisons.find(c => c.id === taskId);
    if (!taskState.activeComparison && taskComparison?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(taskComparison.sides[0].evaluation.passed, true);
  const taskRun = await (await fetch(`${origin}/api/runs/${taskComparison.sides[0].run.id}`)).json();
  assert.equal(taskRun.output.events.length, 3);
  assert.equal(taskRun.output.events[2].time, null);
});
