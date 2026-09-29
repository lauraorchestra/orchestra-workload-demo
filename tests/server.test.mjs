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
});
