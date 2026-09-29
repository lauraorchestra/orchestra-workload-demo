import OpenAI from 'openai';
import { randomBytes } from 'node:crypto';

export function createModel({ config, mode, fetch: fixtureFetch, onEvent }) {
  if (mode === 'live' && !config.liveReady) throw new Error('Live mode requires explicit enablement, a model and an application API key.');
  // The SDK merges ambient custom headers ahead of these explicit defaults.
  // Remove them so this application's selected credentials and scope stay authoritative.
  const ignoredHeaders = Object.fromEntries((process.env.OPENAI_CUSTOM_HEADERS || '').split('\n')
    .filter(line => line.includes(':')).map(line => [line.slice(0, line.indexOf(':')).trim().toLowerCase(), null]));
  const apiKey = mode === 'offline' ? 'synthetic-fixture-key' : config.apiKey;
  const client = new OpenAI({
    apiKey,
    baseURL: mode === 'offline' ? 'http://fixture.invalid/v1' : config.baseURL,
    adminAPIKey: null,
    organization: null,
    project: null,
    defaultHeaders: { ...ignoredHeaders, authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    logLevel: 'off',
    maxRetries: 0,
    timeout: 45000,
    ...(fixtureFetch ? { fetch: fixtureFetch } : {}),
  });
  const traceId = randomBytes(16).toString('hex');
  let calls = 0;
  return async function complete(stage, messages, { tools, json = false } = {}) {
    if (calls >= config.maxModelCalls) throw new Error(`Model-call budget exhausted (${config.maxModelCalls}).`);
    const gateway = mode === 'live' ? config.gateway : null;
    if (gateway && !gateway.workloads[stage]) throw new Error(`No workload mapping for ${stage}.`);
    const callIndex = ++calls;
    const headers = { 'x-lab-stage': stage, ...(gateway ? {
      'x-understudy-project': gateway.project,
      'x-understudy-workload': gateway.workloads[stage],
      'x-understudy-environment': gateway.environment,
      traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`,
    } : {}) };
    const model = mode === 'offline' ? 'fixture-model' : config.model;
    onEvent({ type: 'llm_request', stage, data: { callIndex, model, mode, traceId: gateway ? traceId : null, workload: gateway?.workloads[stage] || null, messageCount: messages.length } });
    try {
      const { data, response } = await client.chat.completions.create({
        model, messages, max_tokens: config.maxOutputTokens, temperature: 0,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...(tools ? { tools, parallel_tool_calls: false } : {}),
      }, { headers }).withResponse();
      const requestId = response.headers.get(gateway ? 'x-understudy-request-id' : 'x-request-id');
      const environment = gateway ? response.headers.get('x-understudy-environment') : null;
      onEvent({ type: 'llm_response', stage, data: { callIndex, model, requestId, traceId: gateway ? traceId : null, workload: gateway?.workloads[stage] || null, environment, effectiveModel: gateway ? response.headers.get('x-understudy-effective-model') : data.model || null, route: gateway ? response.headers.get('x-understudy-route') : null, synthetic: mode === 'offline', usage: data.usage || null, finishReason: data.choices?.[0]?.finish_reason } });
      if (gateway && (!requestId || environment !== gateway.environment)) throw new Error('Gateway request identity or test environment was not confirmed; inspect existing logs before retrying.');
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error(`Model output reached the ${config.maxOutputTokens}-token limit; no truncated response was executed.`);
      if (!choice?.message || !['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('Model did not complete a usable response.');
      return choice.message;
    } catch (error) {
      // SDK errors may include response bodies; keep diagnostic metadata only.
      const safe = error instanceof OpenAI.APIError ? `Model request failed (HTTP ${error.status ?? 'network'}, code ${String(error.code || 'unknown')}).` : error.message;
      onEvent({ type: 'error', stage, data: { message: safe, status: error.status ?? null,
        requestId: error.headers?.get(gateway ? 'x-understudy-request-id' : 'x-request-id') || null,
        environment: gateway ? error.headers?.get('x-understudy-environment') || null : null,
        callIndex, traceId: gateway ? traceId : null, workload: gateway?.workloads[stage] || null,
      } });
      const failure = new Error(safe);
      failure.fatalModelError = true;
      throw failure;
    }
  };
}
