import { readFileSync } from 'node:fs';

export function readConfig(env = process.env) {
  const provider = env.CRM_PROVIDER || 'understudy';
  if (!['openai', 'understudy'].includes(provider)) throw new Error('CRM_PROVIDER must be openai or understudy.');
  const model = env.CRM_MODEL || (provider === 'openai' ? 'gpt-4o' : 'gpt-4.1-mini');
  const mode = env.CRM_MODE || 'offline';
  if (!['offline', 'live'].includes(mode)) throw new Error('CRM_MODE must be offline or live.');
  const maxModelCalls = Number(env.CRM_MAX_MODEL_CALLS || 16);
  if (!Number.isInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > 20) throw new Error('Model-call budget must be 1–20.');
  let baseURL;
  let apiKey;
  let gateway = null;
  if (provider === 'openai') {
    apiKey = env.OPENAI_API_KEY;
    baseURL = 'https://api.openai.com/v1';
  } else if (env.CRM_GATEWAY_CONFIG) {
    gateway = JSON.parse(readFileSync(env.CRM_GATEWAY_CONFIG, 'utf8'));
    if (!env.UNDERSTUDY_API_KEY || !env.UNDERSTUDY_ORG_ID || gateway.organizationId !== env.UNDERSTUDY_ORG_ID) throw new Error('Gateway credential organization does not match the application configuration.');
    const origin = new URL(env.UNDERSTUDY_GATEWAY_URL || '');
    if (origin.protocol !== 'https:' || origin.origin !== gateway.origin || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Gateway origin does not match the verified application configuration.');
    if (typeof gateway.project !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gateway.project) || gateway.environment !== 'test') throw new Error('This synthetic lab requires a project slug (not a management ID) and test request environment.');
    for (const stage of ['extractMeetingFacts', 'reconcileDeal', 'assessDealReadiness', 'draftFollowUp']) {
      if (typeof gateway.workloads?.[stage] !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gateway.workloads[stage])) throw new Error(`Missing workload name (not a management ID) for ${stage}.`);
    }
    apiKey = env.UNDERSTUDY_API_KEY;
    baseURL = `${origin.origin}/v1`;
  }
  if (baseURL) {
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use a plain SDK base URL without credentials, query or fragment.');
  }
  return { mode, provider, model, apiKey, baseURL, gateway, maxModelCalls, maxOutputTokens: 2400, maxToolCalls: 40, liveReady: env.CRM_ALLOW_LIVE === '1' && Boolean(apiKey && (provider === 'openai' || gateway)) && model !== 'fixture-model' };
}
export function publicConfig(config) {
  return { mode: config.mode, provider: config.provider, model: config.model, liveReady: config.liveReady, maxModelCalls: config.maxModelCalls, maxToolCalls: config.maxToolCalls, maxOutputTokens: config.maxOutputTokens };
}
