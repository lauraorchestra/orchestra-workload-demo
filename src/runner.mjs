import { isDeepStrictEqual } from 'node:util';
import { crmAgent } from './agent.mjs';
import { createModel } from './model.mjs';
import { fixtureFetchFor } from './fixture-model.mjs';
import { toolDefinitions } from './store.mjs';

function parseArguments(content) {
  const parsed = JSON.parse(content || '');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be a JSON object.');
  return parsed;
}

export async function runMeeting({ store, meetingId, mode, config, onRunCreated, offlineFetch }) {
  if (offlineFetch && mode !== 'offline') throw new Error('Fixture transport is only available in offline mode.');
  const meeting = store.getMeeting(meetingId);
  if (!meeting) throw new Error('Meeting not found.');
  const run = store.createRun({ meetingId, mode });
  onRunCreated?.(run);
  const event = value => store.appendEvent(run.id, value);
  const successful = [];
  let toolsUsed = 0;

  function executeTool(call) {
    const name = call.function.name;
    const attemptId = `tool_${++toolsUsed}`;
    event({ type: 'tool_call', stage: crmAgent.stage, data: { attemptId, name, toolCallId: call.id, rawArguments: call.function.arguments } });
    try {
      if (toolsUsed > config.maxToolCalls) throw new Error('Tool-call budget exhausted.');
      const args = parseArguments(call.function.arguments);
      const result = store.executeTool(name, args, { runId: run.id });
      event({ type: 'tool_result', stage: crmAgent.stage, data: { attemptId, name, result } });
      successful.push({ name, result });
      return result;
    } catch (error) {
      event({ type: 'tool_result', stage: crmAgent.stage, data: { attemptId, name, error: error.message } });
      throw error;
    }
  }

  // Verify what the tools saved, without pretending to grade the agent's judgment.
  // A later write to the same deal supersedes its earlier result in this run.
  function confirmPersistedWrites() {
    const deals = new Map();
    const tasks = [];
    for (const call of successful) {
      if (call.name === 'update_deal') deals.set(call.result.id, call.result);
      if (call.name === 'create_follow_up_task') tasks.push(call.result);
    }
    const persisted = store.snapshot();
    for (const [id, expected] of deals) {
      const actual = persisted.deals.find(deal => deal.id === id);
      if (expected.accountId !== meeting.accountId || !isDeepStrictEqual(actual, expected)) throw new Error('A returned deal update does not match the persisted CRM state.');
    }
    for (const expected of tasks) {
      const actual = persisted.tasks.find(task => task.id === expected.id);
      if (expected.accountId !== meeting.accountId || !isDeepStrictEqual(actual, expected)) throw new Error('A returned follow-up task does not match the persisted CRM state.');
    }
    event({ type: 'workflow', stage: crmAgent.stage, data: {
      message: 'Agent conversation completed. Returned writes match the saved CRM; business correctness has not been independently graded.',
      persistedDealResults: deals.size, persistedTaskResults: tasks.length,
    } });
  }

  try {
    event({ type: 'run_context', stage: 'run', data: {
      captureVersion: 2, meeting: JSON.parse(JSON.stringify(meeting)), provider: config.provider,
      model: mode === 'offline' ? 'fixture-model' : config.model, mode,
      agent: { name: crmAgent.name, stage: crmAgent.stage, goal: crmAgent.goal },
      limits: { maxModelCalls: config.maxModelCalls, maxToolCalls: config.maxToolCalls, maxOutputTokens: config.maxOutputTokens },
    } });
    const complete = createModel({ config, mode, fetch: mode === 'offline' ? offlineFetch || fixtureFetchFor(store, meetingId) : undefined, onEvent: event });
    const messages = [
      { role: 'system', content: crmAgent.systemPrompt },
      { role: 'user', content: JSON.stringify({ goal: crmAgent.goal, meeting }) },
    ];
    for (let turn = 0; turn < config.maxModelCalls; turn++) {
      const message = await complete(crmAgent.stage, messages, { tools: toolDefinitions });
      messages.push(message);
      if (!message.tool_calls?.length) {
        if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('Agent ended without a final explanation.');
        confirmPersistedWrites();
        store.finishRun(run.id, { status: 'succeeded', summary: message.content.trim() });
        return store.getRun(run.id);
      }
      for (const call of message.tool_calls) {
        let result;
        try {
          result = executeTool(call);
        } catch (error) {
          event({ type: 'error', stage: crmAgent.stage, data: { tool: call.function?.name, message: error.message } });
          if (/budget exhausted/.test(error.message)) throw error;
          result = { error: error.message, ...(error.code ? { code: error.code } : {}) };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    throw new Error(`Model-call budget exhausted (${config.maxModelCalls}) before the agent finished.`);
  } catch (error) {
    event({ type: 'error', stage: 'run', data: { message: error.message } });
    store.finishRun(run.id, { status: 'failed', error: error.message, summary: 'Run stopped. Inspect the audit for any already-applied local changes.' });
    return store.getRun(run.id);
  }
}
