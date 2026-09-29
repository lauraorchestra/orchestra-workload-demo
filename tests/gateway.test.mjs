import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.mjs';
import { createModel } from '../src/model.mjs';
const stages = ['extractMeetingFacts', 'reconcileDeal', 'assessDealReadiness', 'draftFollowUp'];
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'invented-gateway-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gateway = { organizationId: 'synthetic-org', origin: 'https://gateway.example.invalid', project: 'synthetic-project', environment: 'test', workloads: Object.fromEntries(stages.map((s,i) => [s, `synthetic-task-${i}`])) };
  const path = join(dir, 'gateway.json'); writeFileSync(path, JSON.stringify(gateway), { mode: 0o600 });
  const env = { CRM_GATEWAY_CONFIG: path, CRM_ALLOW_LIVE: '1', UNDERSTUDY_API_KEY: 'synthetic-test-key', UNDERSTUDY_ORG_ID: gateway.organizationId, UNDERSTUDY_GATEWAY_URL: gateway.origin };
  return { env, gateway, path };
}
test('gateway configuration derives SDK prefix and never falls back to native credentials', t => {
  const {env} = setup(t);
  const config = readConfig(env);
  assert.equal(config.provider, 'understudy');
  assert.equal(config.baseURL, 'https://gateway.example.invalid/v1');
  assert.equal(config.model, 'gpt-4.1-mini');
  assert.equal(config.liveReady, true);
  assert.throws(() => readConfig({...env, UNDERSTUDY_API_KEY: '', OPENAI_API_KEY: 'synthetic-native-key'}), /credential organization/);
  assert.throws(() => readConfig({...env, UNDERSTUDY_ORG_ID: 'synthetic-other-org'}), /organization/);
  assert.throws(() => readConfig({...env, UNDERSTUDY_GATEWAY_URL: env.UNDERSTUDY_GATEWAY_URL+'/v1'}), /origin/);
  assert.equal(readConfig({CRM_ALLOW_LIVE:'1', OPENAI_API_KEY:'synthetic-native-key'}).liveReady, false);
  assert.equal(readConfig({...env, CRM_PROVIDER:'understudy', OPENAI_API_KEY:'synthetic-native-key', OPENAI_BASE_URL:'https://other.example.invalid'}).apiKey, env.UNDERSTUDY_API_KEY);
});
test('actual SDK preserves protocol/model and concurrent stage attribution with exact receipts', async t => {
  const {env, gateway} = setup(t);
  const requests = [], events = [];
  const complete = createModel({ mode: 'live', config: readConfig(env), onEvent: e => events.push(e), fetch: async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = await req.json();
    requests.push({url:req.url,headers:req.headers,body});
    return new Response(JSON.stringify({id:'synthetic-completion',object:'chat.completion',created:1,model:'synthetic-response-model',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'{"ok":true}'}}]}), {headers:{'content-type':'application/json','x-understudy-request-id':`synthetic-${req.headers.get('x-lab-stage')}`,'x-understudy-environment':'test','x-understudy-effective-model':body.model,'x-understudy-route':'managed'}});
  }});
  await Promise.all(stages.map(s => complete(s,[{role:'user',content:'Synthetic transport exercise.'}],{json:true})));
  assert.equal(requests.length,4);
  const traces = new Set();
  for (const req of requests) {
    const stage = req.headers.get('x-lab-stage');
    assert.equal(req.url, 'https://gateway.example.invalid/v1/chat/completions');
    assert.equal(req.headers.get('x-understudy-project'),gateway.project);
    assert.equal(req.headers.get('x-understudy-workload'),gateway.workloads[stage]);
    assert.equal(req.headers.get('x-understudy-environment'),'test');
    assert.equal(req.headers.get('authorization'),'Bearer synthetic-test-key');
    assert.equal(req.body.model,'gpt-4.1-mini');
    assert.deepEqual(req.body.response_format,{type:'json_object'});
    const trace = req.headers.get('traceparent'); assert.match(trace,/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/); traces.add(trace.split('-')[1]);
  }
  assert.equal(traces.size,1);
  assert.equal(events.filter(e=>e.type==='llm_response').length,4);
  for (const request of events.filter(e=>e.type==='llm_request')) assert.equal(events.find(e=>e.type==='llm_response' && e.stage===request.stage).data.callIndex, request.data.callIndex);
  assert.ok(events.filter(e=>e.type==='llm_response').every(e=>e.data.requestId===`synthetic-${e.stage}` && e.data.environment==='test'));
  assert.ok(events.filter(e=>e.type==='llm_response').every(e=>e.data.effectiveModel==='gpt-4.1-mini'));
  await assert.rejects(complete('unmappedStage',[]),/No workload mapping/);
  assert.equal(requests.length,4);
});
test('missing gateway environment acknowledgment fails without automatic inference retry', async t => {
  const {env} = setup(t); let calls=0;
  const complete = createModel({mode:'live',config:readConfig(env),onEvent:()=>{},fetch:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'OK'}}]}),{headers:{'content-type':'application/json','x-understudy-request-id':'synthetic-existing-id'}});}});
  await assert.rejects(complete('extractMeetingFacts',[{role:'user',content:'Synthetic.'}]),error => /not confirmed/.test(error.message) && error.fatalModelError === true);
  assert.equal(calls,1);
});
test('truncated output stops with its receipt and HTTP errors retain safe request metadata', async t => {
  const {env} = setup(t); const config=readConfig(env); const events=[]; let calls=0;
  const complete=createModel({mode:'live',config,onEvent:e=>events.push(e),fetch:async()=>{
    calls++;
    if(calls===1) return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{role:'assistant',content:'{"partial":'}}]}),{headers:{'content-type':'application/json','x-understudy-request-id':'synthetic-truncated','x-understudy-environment':'test'}});
    return new Response(JSON.stringify({error:{message:'Synthetic body must stay out of logs',code:'synthetic_failure'}}),{status:400,headers:{'content-type':'application/json','x-understudy-request-id':'synthetic-rejected','x-understudy-environment':'test'}});
  }});
  await assert.rejects(complete('extractMeetingFacts',[]),/2400-token limit/);
  assert.equal(events.find(e=>e.type==='llm_response').data.requestId,'synthetic-truncated');
  await assert.rejects(complete('extractMeetingFacts',[]),/HTTP 400/);
  assert.equal(events.at(-1).data.requestId,'synthetic-rejected');
  assert.equal(events.at(-1).data.environment,'test');
  assert.equal(calls,2);
  assert.ok(!JSON.stringify(events).includes('Synthetic body must stay out of logs'));
});
