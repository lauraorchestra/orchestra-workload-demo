import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, publicConfig } from '../src/config.mjs';
import { createModel } from '../src/model.mjs';

const directEnv = { CRM_PROVIDER: 'openai', CRM_ALLOW_LIVE: '1', OPENAI_API_KEY: 'synthetic-native-key' };

test('direct OpenAI requires explicit selection and never reads gateway config or credentials', () => {
  const config = readConfig({ ...directEnv,
    CRM_GATEWAY_CONFIG: 'synthetic-nonexistent-gateway.json',
    UNDERSTUDY_API_KEY: 'synthetic-gateway-key',
    UNDERSTUDY_GATEWAY_URL: 'https://gateway.example.invalid',
    OPENAI_BASE_URL: 'https://other.example.invalid/v1',
  });
  assert.equal(config.provider, 'openai');
  assert.equal(config.model, 'gpt-4o');
  assert.equal(config.baseURL, 'https://api.openai.com/v1');
  assert.equal(config.apiKey, directEnv.OPENAI_API_KEY);
  assert.equal(config.gateway, null);
  assert.equal(config.liveReady, true);
  assert.equal(config.mode, 'offline');
  assert.equal(readConfig({ ...directEnv, CRM_MODEL: 'synthetic-chosen-model' }).model, 'synthetic-chosen-model');
  assert.equal(readConfig({ ...directEnv, OPENAI_API_KEY: '', UNDERSTUDY_API_KEY: 'synthetic-gateway-key' }).liveReady, false);
  assert.equal(readConfig({ CRM_PROVIDER: 'openai', OPENAI_API_KEY: 'synthetic-native-key' }).liveReady, false);
  assert.equal(readConfig({ CRM_ALLOW_LIVE: '1', OPENAI_API_KEY: 'synthetic-native-key' }).liveReady, false);
  assert.equal(readConfig({ ...directEnv, CRM_MODEL: 'fixture-model' }).liveReady, false);
  assert.throws(() => readConfig({ CRM_PROVIDER: 'unsupported-provider' }), /CRM_PROVIDER/);
  assert.throws(() => readConfig({ ...directEnv, CRM_MAX_MODEL_CALLS: '21' }), /budget/);
  const publicValue = publicConfig(config);
  assert.equal(publicValue.provider, 'openai');
  for (const field of ['apiKey', 'baseURL', 'gateway']) assert.equal(Object.hasOwn(publicValue, field), false);
  assert.ok(!JSON.stringify(publicValue).includes(directEnv.OPENAI_API_KEY));
});

test('direct SDK uses GPT-4o tools and continuation with isolated credentials and actual model receipts', async t => {
  const ambient = {
    OPENAI_API_KEY: 'synthetic-wrong-key',
    OPENAI_ADMIN_KEY: 'synthetic-admin-key',
    OPENAI_BASE_URL: 'https://wrong.example.invalid',
    OPENAI_ORG_ID: 'synthetic-wrong-org',
    OPENAI_PROJECT_ID: 'synthetic-wrong-project',
    OPENAI_CUSTOM_HEADERS: 'Authorization: Bearer synthetic-header-key\nContent-Type: text/plain\nAccept: text/plain\nx-understudy-project: synthetic-project\nx-understudy-workload: synthetic-workload\nx-understudy-environment: test\ntraceparent: synthetic-trace\nx-extra-scope: synthetic-scope\nx-lab-stage: wrong-stage',
  };
  const previous = Object.fromEntries(Object.keys(ambient).map(key => [key, process.env[key]]));
  Object.assign(process.env, ambient);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const requests = [], events = [];
  const call = { id: 'synthetic-tool-call', type: 'function', function: { name: 'lookup_deal', arguments: '{"name":"Synthetic deal"}' } };
  const complete = createModel({ mode: 'live', config: readConfig(directEnv), onEvent: e => events.push(e), fetch: async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = await req.json();
    requests.push({ url: req.url, headers: req.headers, body });
    const first = requests.length === 1;
    return new Response(JSON.stringify({ id: 'synthetic-completion', model: 'gpt-4o-2024-08-06', choices: [{ index: 0, finish_reason: first ? 'tool_calls' : 'stop', message: first ? { role: 'assistant', content: null, tool_calls: [call] } : { role: 'assistant', content: 'Synthetic lookup complete.' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: {
      'content-type': 'application/json', 'x-request-id': `synthetic-openai-${requests.length}`,
      'x-understudy-request-id': 'synthetic-unrelated-id', 'x-understudy-effective-model': 'synthetic-unrelated-model', 'x-understudy-environment': 'test', 'x-understudy-route': 'synthetic-unrelated-route',
    } });
  } });
  const messages = [{ role: 'user', content: 'Look up the invented deal.' }];
  const tools = [{ type: 'function', function: { name: 'lookup_deal', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }];
  const first = await complete('reconcileDeal', messages, { tools });
  messages.push(first, { role: 'tool', tool_call_id: call.id, content: '{"deal":"synthetic-deal"}' });
  const second = await complete('reconcileDeal', messages, { tools });
  assert.equal(second.content, 'Synthetic lookup complete.');
  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(req.headers.get('authorization'), 'Bearer synthetic-native-key');
    assert.equal(req.headers.get('content-type'), 'application/json');
    assert.equal(req.headers.get('accept'), 'application/json');
    assert.equal(req.headers.get('x-lab-stage'), 'reconcileDeal');
    assert.equal(req.headers.get('openai-organization'), null);
    assert.equal(req.headers.get('openai-project'), null);
    assert.equal(req.headers.get('traceparent'), null);
    assert.equal(req.headers.get('x-extra-scope'), null);
    assert.equal([...req.headers.keys()].some(name => name.startsWith('x-understudy-')), false);
    assert.equal(req.body.model, 'gpt-4o');
    assert.equal(req.body.parallel_tool_calls, false);
    assert.deepEqual(req.body.tools, tools);
  }
  assert.deepEqual(requests[1].body.messages[1].tool_calls, [call]);
  assert.equal(requests[1].body.messages[2].tool_call_id, call.id);
  for (const [index, event] of events.filter(e => e.type === 'llm_response').entries()) {
    assert.equal(event.data.model, 'gpt-4o');
    assert.equal(event.data.effectiveModel, 'gpt-4o-2024-08-06');
    assert.equal(event.data.requestId, `synthetic-openai-${index + 1}`);
    assert.equal(event.data.environment, null);
    assert.equal(event.data.route, null);
    assert.equal(event.data.workload, null);
    assert.equal(event.data.synthetic, false);
  }
  assert.ok(!JSON.stringify(events).includes('synthetic-native-key'));
});

test('direct HTTP errors retain the OpenAI request ID without response payloads or retries', async () => {
  const events = []; let calls = 0;
  const complete = createModel({ mode: 'live', config: readConfig(directEnv), onEvent: e => events.push(e), fetch: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'Synthetic response body must stay private', code: 'synthetic_limit' } }), { status: 429, headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-openai-failure', 'x-understudy-request-id': 'synthetic-unrelated-id' } });
  } });
  await assert.rejects(complete('extractMeetingFacts', []), error => /HTTP 429/.test(error.message) && error.fatalModelError);
  assert.equal(calls, 1);
  assert.equal(events.at(-1).data.requestId, 'synthetic-openai-failure');
  assert.equal(events.at(-1).data.environment, null);
  assert.ok(!JSON.stringify(events).includes('Synthetic response body must stay private'));
});

test('direct configuration keeps offline transport synthetic and blocks unenabled live inference', async () => {
  const config = readConfig({ CRM_PROVIDER: 'openai' });
  assert.throws(() => createModel({ mode: 'live', config, onEvent: () => {} }), /explicit enablement/);
  const events = [];
  const complete = createModel({ mode: 'offline', config, onEvent: e => events.push(e), fetch: async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    assert.equal(req.url, 'http://fixture.invalid/v1/chat/completions');
    assert.equal(req.headers.get('authorization'), 'Bearer synthetic-fixture-key');
    const body = await req.json();
    assert.equal(body.model, 'fixture-model');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return new Response(JSON.stringify({ model: 'fixture-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  await complete('extractMeetingFacts', [], { json: true });
  assert.equal(events.at(-1).data.synthetic, true);
});

test('OpenAI launcher fails before starting the app when its key is absent or mode is overridden', () => {
  const script = fileURLToPath(new URL('../scripts/openai.mjs', import.meta.url));
  const env = { ...process.env, OPENAI_API_KEY: '', CRM_GATEWAY_CONFIG: 'synthetic-missing-file' };
  const missing = spawnSync(process.execPath, [script, 'run'], { env, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Set OPENAI_API_KEY/);
  const override = spawnSync(process.execPath, [script, 'run', '--mode', 'offline'], { env, encoding: 'utf8' });
  assert.equal(override.status, 1);
  assert.match(override.stderr, /runs live OpenAI inference/);
});
