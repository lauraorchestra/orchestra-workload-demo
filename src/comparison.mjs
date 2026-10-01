import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openStore } from './store.mjs';
import { runMeeting } from './runner.mjs';
import { demoExpectations } from './demo-seed.mjs';
import { taskDemos, runTaskDemo, evaluateTask } from './task-demos.mjs';

export function evaluateRun(run) {
  if (taskDemos[run.meetingId]) return evaluateTask(run);
  const exp = demoExpectations[run.meetingId];
  if (!exp || !run.after) return { checks: [], passed: null, notice: 'No scenario checks available. Inspect the actual result.' };
  const before = run.before.deals.find(d => d.id === exp.dealId);
  const after = run.after.deals.find(d => d.id === exp.dealId);
  const checks = [{ name: 'Agent completed', pass: run.status === 'succeeded' }];
  const add = (name, pass) => checks.push({ name, pass: Boolean(pass) });
  for (const [field, expected] of Object.entries(exp.expectedChanges)) {
    if (field === 'nextStep') continue; // wording is free; the prose remains a human review item
    add(`${field}: confirmed value`, after?.[field] === expected);
  }
  const preserved = Object.keys(before).filter(k => !['version', ...Object.keys(exp.expectedChanges)].includes(k));
  add('Unrelated deal fields preserved', preserved.every(k => isDeepStrictEqual(before[k], after?.[k])));
  add('Other opportunities preserved', run.before.deals.filter(d => d.id !== exp.dealId).every(d => isDeepStrictEqual(d, run.after.deals.find(a => a.id === d.id))));
  add('Existing tasks preserved', run.before.tasks.every(t => isDeepStrictEqual(t, run.after.tasks.find(a => a.id === t.id))));
  const tasks = run.after.tasks.filter(t => !run.before.tasks.some(b => b.id === t.id));
  if (exp.expectedTask) add('One agreed task, correct deal and deadline', tasks.length === 1 && tasks[0].dealId === exp.dealId && tasks[0].dueDate === exp.expectedTask.dueDate);
  else add('No invented task or deadline', tasks.length === 0);
  const drafts = run.after.drafts.filter(d => d.meetingId === run.meetingId && d.dealId === exp.dealId);
  add('One draft awaiting salesperson approval', drafts.length === 1 && drafts[0].status === 'needs_review' && drafts[0].approvedAt === null);
  add('Correct prospect recipients', drafts.length === 1 && isDeepStrictEqual([...drafts[0].recipientContactIds].sort(), [...exp.draft.recipientContactIds].sort()));
  return { checks, passed: checks.every(c => c.pass), notice: 'These checks cover saved fields, task counts/deadlines and draft recipients/approval. Draft wording, factual completeness, task meaning and buying-step order require human review. A single scenario does not establish model reliability.' };
}
export function runMetrics(run, pricing) {
  const responses = run.events.filter(e => e.type === 'llm_response').map(e => e.data);
  const live = run.mode === 'live';
  const usageAvailable = live && responses.length > 0 && responses.length === run.events.filter(e => e.type === 'llm_request').length && responses.every(r => Number.isFinite(r.usage?.prompt_tokens) && Number.isFinite(r.usage?.completion_tokens));
  const inputTokens = usageAvailable ? responses.reduce((n, r) => n + r.usage.prompt_tokens, 0) : null;
  const outputTokens = usageAvailable ? responses.reduce((n, r) => n + r.usage.completion_tokens, 0) : null;
  // Do not apply requested-model prices to a gateway's differently served model.
  const priced = usageAvailable && pricing && responses.every(r => r.effectiveModel === r.model);
  return { synthetic: !live, elapsedMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt), modelCalls: run.events.filter(e => e.type === 'llm_request').length, toolCalls: run.events.filter(e => e.type === 'tool_call').length, inputTokens, outputTokens, estimatedCostUSD: priced ? (inputTokens * pricing.input + outputTokens * pricing.output) / 1e6 : null, pricingSource: priced ? 'User-supplied per-million-token rates; estimate excludes cache discounts, infrastructure and other fees.' : null, servedModels: [...new Set(responses.map(r => r.effectiveModel).filter(Boolean))] };
}
export function validateComparison(args, config) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !['meetingId', 'mode', 'baselineModel', 'candidateModel', 'pricing', 'candidateGuidance', 'candidateReplay'].includes(k))) throw new Error('Invalid comparison arguments.');
  if (!demoExpectations[args.meetingId] && !taskDemos[args.meetingId]) throw new Error('Choose a supported demo scenario for a checked comparison.');
  if (!['offline', 'live'].includes(args.mode)) throw new Error('Invalid comparison mode.');
  if (args.mode === 'live' && !config.liveReady) throw new Error('Live inference is not configured/enabled.');
  for (const model of [args.baselineModel, args.candidateModel]) if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model) || (args.mode === 'live' && model === 'fixture-model')) throw new Error('Use a valid model name.');
  if (args.candidateReplay !== undefined && !['complete', 'missed_context'].includes(args.candidateReplay)) throw new Error('Unknown candidate replay.');
  if (args.candidateReplay === 'missed_context' && (args.mode !== 'offline' || args.meetingId !== 'mtg_cedar_explicit' && !taskDemos[args.meetingId])) throw new Error('Failure replay requires a supported demo in offline mode.');
  if (args.candidateGuidance !== undefined && (typeof args.candidateGuidance !== 'string' || args.candidateGuidance.length > 3000)) throw new Error('Candidate guidance must be at most 3000 characters.');
  if (args.pricing !== undefined) {
    if (!args.pricing || typeof args.pricing !== 'object' || Array.isArray(args.pricing) || Object.keys(args.pricing).some(k => !['baseline', 'candidate'].includes(k))) throw new Error('Invalid pricing.');
    for (const value of Object.values(args.pricing)) {
      if (!value || Object.keys(value).some(k => !['input', 'output'].includes(k)) || ![value.input, value.output].every(n => Number.isFinite(n) && n >= 0 && n <= 10000)) throw new Error('Token rates must be finite amounts between 0 and 10000 USD per million.');
    }
  }
}
export async function compareModels({ store, config, args, onCreated }) {
  validateComparison(args, config);
  const comparison = { id: `cmp_${randomUUID()}`, meetingId: args.meetingId, mode: args.mode, status: 'running', startedAt: new Date().toISOString(), baselineModel: args.baselineModel, candidateModel: args.candidateModel, sides: [], candidateGuidance: args.candidateGuidance || '', candidateReplay: args.candidateReplay || 'complete', identicalInstructions: !args.candidateGuidance, baseline: taskDemos[args.meetingId] ? 'Frozen synthetic input and schema; one independent SDK attempt per side.' : 'Fresh versioned synthetic seed; independent database for each side.', identicalStartingState: null };
  store.saveComparison(comparison);
  onCreated?.(comparison);
  try {
    let firstState;
    for (const [side, model] of [['baseline', args.baselineModel], ['candidate', args.candidateModel]]) {
      const isolated = openStore({ path: ':memory:' });
      try {
        const startingState = taskDemos[args.meetingId] ? { taskId: args.meetingId, input: taskDemos[args.meetingId].input, instructions: taskDemos[args.meetingId].system } : { ...isolated.overview(), agent: (await import('./agent.mjs')).crmAgent };
        // No run history or comparison data exists in these freshly seeded stores.
        if (!firstState) { firstState = startingState; comparison.startingStateSHA256 = createHash('sha256').update(JSON.stringify(startingState)).digest('hex'); }
        else comparison.identicalStartingState = isDeepStrictEqual(firstState, startingState);
        const run = taskDemos[args.meetingId] ? await runTaskDemo({ taskId: args.meetingId, mode: args.mode, config: { ...config, model }, guidance: side === 'candidate' ? args.candidateGuidance || '' : '', variant: side === 'candidate' ? args.candidateReplay || 'complete' : 'complete' }) : await runMeeting({ store: isolated, meetingId: args.meetingId, mode: args.mode, config: { ...config, model }, guidance: side === 'candidate' ? args.candidateGuidance || '' : '', offlineVariant: side === 'candidate' ? args.candidateReplay || 'complete' : 'complete' });
        comparison.sides.push({ side, requestedModel: model, run, evaluation: evaluateRun(run), metrics: runMetrics(run, args.pricing?.[side]) });
        store.saveComparison(comparison);
      } finally { isolated.close(); }
    }
    comparison.status = comparison.sides.every(s => s.run.status === 'succeeded') ? 'completed' : 'failed';
  } catch (error) { comparison.status = 'failed'; comparison.error = error.message; }
  comparison.finishedAt = new Date().toISOString();
  store.saveComparison(comparison);
  return comparison;
}
