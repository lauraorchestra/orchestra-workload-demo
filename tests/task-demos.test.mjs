import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.mjs';
import { readConfig } from '../src/config.mjs';
import { compareModels, evaluateRun } from '../src/comparison.mjs';
import { taskDemos, publicTaskDemos, evaluateTask } from '../src/task-demos.mjs';

const config = readConfig({});
for (const meetingId of Object.keys(taskDemos)) {
  test(`${meetingId}: isolated comparison, inspectable SDK evidence, no CRM writes`, async t => {
    const store = openStore({ path: ':memory:' }); t.after(() => store.close());
    const before = store.snapshot();
    const comparison = await compareModels({ store, config, args: { meetingId, mode: 'offline', baselineModel: 'fixture-baseline', candidateModel: 'fixture-candidate' } });
    assert.equal(comparison.identicalStartingState, true);
    assert.deepEqual(store.snapshot(), before);
    for (const side of comparison.sides) {
      assert.equal(side.run.status, 'succeeded', side.run.error);
      assert.equal(side.evaluation.passed, true);
      assert.equal(side.metrics.modelCalls, 1);
      assert.equal(side.metrics.toolCalls, 0);
      assert.equal(side.metrics.estimatedCostUSD, null);
      const request = side.run.events.find(e => e.type === 'llm_request').data.request;
      assert.equal(request.messages[1].content, taskDemos[meetingId].input);
      assert.ok(!request.messages[0].content.includes('expected'));
      assert.ok(side.run.events.some(e => e.type === 'llm_response'));
    }
    const fail = await compareModels({ store, config, args: { meetingId, mode: 'offline', baselineModel: 'fixture-baseline', candidateModel: 'fixture-candidate', candidateReplay: 'missed_context' } });
    assert.equal(fail.sides[0].evaluation.passed, true);
    assert.equal(fail.sides[1].evaluation.passed, false);
    assert.equal(fail.sides[1].run.status, 'succeeded');
    if (meetingId === 'demo_classify_inbox') {
      assert.equal(fail.sides[1].run.contractOK, false);
      assert.ok(fail.sides[1].evaluation.checks.some(c => c.name === 'M-01: correct category' && !c.pass));
    }
    const malformed = structuredClone(comparison.sides[0].run);
    for (const output of [{ events: 'invalid', classifications: {} }, { events: [null], classifications: [null] }, null]) {
      malformed.output = output; malformed.contractOK = false;
      assert.equal(evaluateRun(malformed).passed, false);
    }
  });
}
test('public task catalog excludes gold values and scoring rejects duplicate and ungrounded records', () => {
  assert.ok(publicTaskDemos().every(t => !('expected' in t) && !('system' in t)));
  const output = structuredClone(taskDemos.demo_extract_events.expected);
  const run = { meetingId: 'demo_extract_events', status: 'succeeded', contractOK: true, output };
  output.events[2].evidence = 'Invented evidence';
  assert.equal(evaluateTask(run).passed, false);
  output.events[2] = { ...output.events[0] };
  assert.equal(evaluateTask(run).checks.find(c => c.name === 'Every required record included once').pass, false);
});
