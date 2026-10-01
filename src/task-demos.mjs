import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createModel } from './model.mjs';

// Independent, invented workload examples. Never include a customer's meeting in these prompts.
export const taskDemos = {
  demo_extract_events: {
    kind: 'extraction', title: 'Extract events from a document', stage: 'eventExtraction',
    description: 'Turn an unstructured planning note into typed event records. Keep source evidence, apply explicit corrections, and leave missing details unknown.',
    input: 'DOCUMENT S-01 · Synthetic release plan\nThe Atlas preview opens on October 8, 2026 at 09:00 UTC.\nThe review workshop was originally scheduled for October 12, 2026. Correction: it moves to October 14, 2026 at 15:30 UTC.\nThe onboarding session is on October 19, 2026; its time has not been confirmed.\nWe discussed a customer briefing but did not agree on a date. Do not treat it as a scheduled event.',
    system: 'Extract only scheduled events from the document. Return only a bare JSON object with one key, events, containing objects with exactly name (string), date (YYYY-MM-DD), time (HH:MM or null), timezone (UTC or null), source (S-01), evidence (an exact supporting sentence from the input). Apply explicit corrections over old dates. Never infer a missing time or timezone. Exclude events with no agreed date. No prose or markdown.',
    shape: '{ events: [{ name, date, time, timezone, source, evidence }] }',
    expected: { events: [
      { name: 'Atlas preview', date: '2026-10-08', time: '09:00', timezone: 'UTC', source: 'S-01', evidence: 'The Atlas preview opens on October 8, 2026 at 09:00 UTC.' },
      { name: 'Review workshop', date: '2026-10-14', time: '15:30', timezone: 'UTC', source: 'S-01', evidence: 'Correction: it moves to October 14, 2026 at 15:30 UTC.' },
      { name: 'Onboarding session', date: '2026-10-19', time: null, timezone: null, source: 'S-01', evidence: 'The onboarding session is on October 19, 2026; its time has not been confirmed.' },
    ] },
    concerns: ['Typed inputs and outputs', 'Evidence and correction handling', 'Missing values remain unknown'],
  },
  demo_classify_inbox: {
    kind: 'classification', title: 'Classify incoming requests', stage: 'requestClassification',
    description: 'Route messages into a fixed label set. Distinguish urgency from topic and preserve a machine-readable output contract.',
    input: 'MESSAGE M-01\nSubject: charged twice\nI got billed twice this morning and it is holding up payroll. Please fix this today.\n\nMESSAGE M-02\nSubject: webhook failures\nOur webhook returns HTTP 500 after the latest deployment. Can engineering investigate?\n\nMESSAGE M-03\nSubject: evaluation request\nWe would like a demo and pricing for a 50-seat deployment.',
    system: 'Classify each message into exactly one label: billing_urgent, billing_normal, technical, sales_lead, or spam. Return only a bare JSON object with key classifications, an array of objects containing exactly id (input message id) and category (one of the five labels). Include each input id exactly once. No prose, markdown, confidence scores or extra keys.',
    shape: '{ classifications: [{ id, category }] }',
    expected: { classifications: [{ id: 'M-01', category: 'billing_urgent' }, { id: 'M-02', category: 'technical' }, { id: 'M-03', category: 'sales_lead' }] },
    concerns: ['Fixed output taxonomy', 'Quality and JSON contract checked separately', 'Same task suite across model routes'],
  },
};
export function publicTaskDemos() {
  return Object.entries(taskDemos).map(([id, { expected, system, ...task }]) => ({ id, ...task }));
}
export function evaluateTask(run) {
  const task = taskDemos[run.meetingId];
  const checks = [{ name: 'Attempt completed', pass: run.status === 'succeeded' }, { name: 'Bare JSON output contract', pass: Boolean(run.contractOK) }];
  const key = task.kind === 'extraction' ? 'events' : 'classifications';
  const rows = Array.isArray(run.output?.[key]) ? run.output[key] : undefined;
  const expected = task.expected[key];
  checks.push({ name: 'Every required record included once', pass: Array.isArray(rows) && rows.length === expected.length && expected.every(e => rows.filter(r => task.kind === 'extraction' ? (typeof r?.name === 'string' ? r.name.toLowerCase() : '') === e.name.toLowerCase() : r?.id === e.id).length === 1) });
  if (task.kind === 'extraction') {
    for (const e of expected) {
      const row = rows?.find(r => (typeof r?.name === 'string' ? r.name.toLowerCase() : '') === e.name.toLowerCase());
      checks.push({ name: `${e.name}: date and time grounded`, pass: Boolean(row && ['date', 'time', 'timezone'].every(k => row[k] === e[k])) });
    }
    checks.push({ name: 'Source evidence matches the document', pass: Array.isArray(rows) && rows.length > 0 && rows.every(r => r?.source === 'S-01' && typeof r.evidence === 'string' && r.evidence.length > 0 && task.input.includes(r.evidence)) });
  } else {
    for (const e of expected) checks.push({ name: `${e.id}: correct category`, pass: rows?.find(r => r?.id === e.id)?.category === e.category });
  }
  return { checks, passed: checks.every(c => c.pass), notice: 'Deterministic checks on one frozen synthetic case: schema, record coverage and required values. Extraction evidence is checked for verbatim presence, not semantic entailment. These examples do not establish production reliability or optimization gains.' };
}
function conforms(output, kind) {
  const key = kind === 'extraction' ? 'events' : 'classifications';
  const fields = kind === 'extraction' ? ['name', 'date', 'time', 'timezone', 'source', 'evidence'] : ['id', 'category'];
  return output && isDeepStrictEqual(Object.keys(output).sort(), [key]) && Array.isArray(output[key]) && output[key].every(r => r && isDeepStrictEqual(Object.keys(r).sort(), fields.slice().sort()) && (kind === 'extraction' ? typeof r.name === 'string' && typeof r.source === 'string' && typeof r.evidence === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && (r.time === null || /^\d{2}:\d{2}$/.test(r.time)) && (r.timezone === null || r.timezone === 'UTC') : typeof r.id === 'string' && ['billing_urgent', 'billing_normal', 'technical', 'sales_lead', 'spam'].includes(r.category)));
}
export async function runTaskDemo({ taskId, mode, config, guidance = '', variant = 'complete' }) {
  const task = taskDemos[taskId];
  const run = { id: `run_${randomUUID()}`, meetingId: taskId, meetingTitle: task.title, mode, status: 'running', startedAt: new Date().toISOString(), events: [], before: { input: task.input }, after: {}, output: null, contractOK: false };
  const onEvent = event => run.events.push({ ...event, seq: run.events.length + 1, occurredAt: new Date().toISOString() });
  onEvent({ type: 'run_context', stage: task.stage, data: { task: { title: task.title, input: task.input, outputShape: task.shape }, operatorGuidance: guidance, replayVariant: variant } });
  const fixtureFetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json();
    const output = structuredClone(task.expected);
    if (variant === 'missed_context') {
      if (task.kind === 'extraction') { output.events[1].date = '2026-10-12'; output.events[2].time = '09:00'; output.events[2].timezone = 'UTC'; }
      else output.classifications[0].category = 'billing_normal';
    }
    let content = JSON.stringify(output);
    // A plausible answer with an invalid interface contract is a separate failure.
    if (task.kind === 'classification' && variant === 'missed_context') content = '```json\n' + content + '\n```';
    return new Response(JSON.stringify({ id: 'fixture-task', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const complete = createModel({ config, mode, ...(mode === 'offline' ? { fetch: fixtureFetch } : {}), onEvent });
    const messages = [{ role: 'system', content: task.system }, { role: 'user', content: task.input + (guidance ? `\n\nOperator guidance:\n${guidance}` : '') }];
    const message = await complete(task.stage, messages);
    run.rawOutput = message.content || '';
    try { run.output = JSON.parse(run.rawOutput); run.contractOK = conforms(run.output, task.kind); } catch { /* retain raw content and show failed contract */ }
    // Parse fenced JSON solely for failure inspection, never accept it as the contract.
    if (!run.output) { try { run.output = JSON.parse(run.rawOutput.replace(/^```json\s*|\s*```$/g, '')); } catch { /* visible invalid response */ } }
    run.after = { output: run.output };
    run.status = 'succeeded';
    run.summary = mode === 'offline' ? 'Curated synthetic replay through the SDK; no model called. Guidance does not alter scripted output.' : 'One bounded model attempt; inspect the output and checks before accepting it.';
  } catch (error) { run.status = 'failed'; run.error = error.message; run.summary = error.message; }
  run.finishedAt = new Date().toISOString();
  return run;
}
