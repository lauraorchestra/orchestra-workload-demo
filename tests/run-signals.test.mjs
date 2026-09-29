import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, scenarioExpectations as expected } from '../src/store.mjs';

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`terminal ${signal} preserves partial changes and releases the persisted run lock`, { timeout: 10000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'synthetic-crm-signal-'));
    let store;
    // Exercise the actual terminal entry point with a deliberately pending model.
    // The loader replacement is confined to this subprocess and never uses a key or network.
    const modelURL = new URL('../src/model.mjs', import.meta.url).href;
    const runURL = new URL('../src/run.mjs', import.meta.url).href;
    const pendingModel = `export function createModel() {
      return async () => {
        setInterval(() => {}, 1000);
        process.send('model-pending');
        return new Promise(() => {});
      };
    }`;
    const launcher = `import { registerHooks } from 'node:module';
      registerHooks({ load(url, context, nextLoad) {
        return url === ${JSON.stringify(modelURL)}
          ? { format: 'module', source: ${JSON.stringify(pendingModel)}, shortCircuit: true }
          : nextLoad(url, context);
      }});
      await import(${JSON.stringify(runURL)});`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', launcher], {
      cwd: directory,
      env: { CRM_MODE: 'offline' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    const exited = once(child, 'exit');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      store?.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const ready = await Promise.race([
      once(child, 'message'),
      exited.then(result => { throw new Error(`Terminal exited before the model call: ${JSON.stringify(result)} ${errors}`); }),
    ]);
    assert.equal(ready[0], 'model-pending');

    store = openStore({ path: join(directory, '.local', 'crm.sqlite') });
    const run = store.listRuns()[0];
    assert.equal(run.status, 'running');
    // A previous tool may have already committed before the interrupted model call.
    store.executeTool('update_deal', {
      dealId: expected.dealId, expectedVersion: 1,
      changes: { amount: expected.expectedChanges.amount }, evidence: [run.meetingId],
    }, { runId: run.id });
    assert.equal(child.kill(signal), true);
    const [code, terminatingSignal] = await exited;
    assert.equal(terminatingSignal, null, errors);
    assert.equal(code, signal === 'SIGINT' ? 130 : 143, errors);

    const stopped = store.getRun(run.id);
    assert.equal(stopped.status, 'failed');
    assert.match(stopped.error, new RegExp(`${signal}.*already-applied`));
    assert.ok(stopped.finishedAt);
    assert.deepEqual(stopped.after, store.snapshot());
    assert.notDeepEqual(stopped.after, stopped.before);
    assert.equal(stopped.events.filter(event => event.type === 'mutation').length, 1);
    const next = store.createRun({ meetingId: expected.meetingId, mode: 'offline' });
    assert.equal(next.status, 'running');
    store.finishRun(next.id, { status: 'failed', error: 'Synthetic test cleanup.' });
    assert.doesNotThrow(() => store.reset());
  });
}
