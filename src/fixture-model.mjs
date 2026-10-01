// Deterministic SDK transport fixture. It never contacts a model or sends network traffic.
// Expected state is used only here and in tests, never in live model context.
import { crmAgent } from './agent.mjs';
import { scenarioExpectations } from './store.mjs';

export function fixtureFetchFor(store, meetingId, { variant = 'complete' } = {}) {
  const meeting = store.getMeeting(meetingId);
  let exp = scenarioExpectations.scenarios?.[meetingId]
    || (meetingId === scenarioExpectations.meetingId ? scenarioExpectations : null);
  // Curated failure for presentation: this is not model reasoning, optimization or a benchmark.
  if (variant === 'missed_context') {
    if (meetingId !== 'mtg_cedar_explicit') throw new Error('Missed-context replay is only defined for the explicit Cedar meeting.');
    exp = { ...exp, expectedChanges: { ...exp.expectedChanges, frontierSpendMonthly: 85000, deployment: 'cloud' }, draft: { ...exp.draft, recipientContactIds: ['contact_cedar_nina', 'contact_cedar_eli'], body: 'Hi Nina and Eli,\n\nWe will proceed with the cloud pilot using the earlier $85,000 monthly spending estimate. Nina can start the benchmark while architecture review is still pending.\n\nThanks,\nQuinn' } };
  }
  let steps;
  let writesPlanned = false;
  let appliedChanges = [];
  let lastToolName;
  let readOnlyReason;
  let turn = 0;
  let serial = 0;
  return async function fixtureFetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    const stage = request.headers.get('x-lab-stage');
    if (stage !== crmAgent.stage) throw new Error(`Unknown fixture stage: ${stage}`);
    const body = await request.json();
    const lastMessage = body.messages.at(-1);
    if (lastMessage?.role === 'tool') {
      const result = JSON.parse(lastMessage.content);
      if (result.error) throw new Error('The scripted offline fixture received a tool error; inspect the audit.');
      if (lastToolName === 'get_timeline') appliedChanges = result.appliedChanges || [];
    }
    if (!steps) {
      const state = store.snapshot();
      const account = state.accounts.find(value => value.id === meeting.accountId);
      steps = [
        ['search_accounts', { query: account.name }],
        ['get_account', { accountId: account.id }],
        ['list_deals', { accountId: account.id }],
        ['get_timeline', { accountId: account.id }],
        ['get_field_definitions', {}],
      ];
      // Only the original example has a scripted write oracle. Other meetings
      // exercise read tools without making up an offline model's judgment.
      if (exp) {
        const deal = state.deals.find(value => value.id === exp.dealId);
        steps.push(['get_deal', { dealId: deal.id }], ['list_tasks', { dealId: deal.id }]);
      }
    }
    // Wait for the journaled context reads before planning any fixture writes.
    if (exp && !writesPlanned && turn === steps.length) {
      writesPlanned = true;
      if (appliedChanges.some(change => change.dealId === exp.dealId && Date.parse(change.meetingOccurredAt) > Date.parse(meeting.occurredAt))) {
        readOnlyReason = 'Offline fixture found saved deal changes from a later meeting. It read the CRM without reapplying this older example or creating its follow-up task. Use live mode to reconcile the dated evidence; this fixture does not make model judgments.';
      } else {
        const state = store.snapshot();
        const deal = state.deals.find(value => value.id === exp.dealId);
        const changes = Object.fromEntries(Object.entries(exp.expectedChanges).filter(([field, value]) => deal[field] !== value));
        if (Object.keys(changes).length) steps.push(['update_deal', { dealId: deal.id, expectedVersion: deal.version, changes, evidence: [meetingId] }]);
        const existing = exp.expectedTask && state.tasks.find(task => task.dealId === deal.id
          && task.title === exp.expectedTask.title.trim() && task.dueDate === exp.expectedTask.dueDate
          && task.status === 'open' && task.body === exp.expectedTask.body
          && JSON.stringify([...task.evidence].sort()) === JSON.stringify([meetingId]));
        if (exp.expectedTask && !existing) steps.push(['create_follow_up_task', { dealId: deal.id, ...exp.expectedTask, evidence: [meetingId] }]);
        if (exp.draft) steps.push(['create_follow_up_draft', { dealId: deal.id, ...exp.draft, evidence: meetingId === 'mtg_cedar_explicit' ? [meetingId, 'tl_cedar_people', 'tl_cedar_deploy'] : [meetingId] }]);
      }
    }
    let message;
    if (turn < steps.length) {
      const [name, args] = steps[turn++];
      lastToolName = name;
      message = { role: 'assistant', content: null, tool_calls: [{ id: `fixture_tool_${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
    } else {
      message = { role: 'assistant', content: readOnlyReason || (exp
        ? (variant === 'missed_context' ? 'Curated missed-context fixture: this scripted attempt preserved stale spend and deployment and selected the wrong recipients. It is intentionally incorrect; inspect the outcome checks. No model was called and no email sent.' : 'Offline fixture completed its scripted CRM lookups and any outstanding example updates and follow-up task. Already-matching fields and an existing matching task were left in place. No message was sent. This is a deterministic transport demonstration, not a model judgment.')
        : 'Offline fixture read the account, deals, history, and field definitions. This meeting has no scripted write example, so no records were changed. Use live mode to let the agent decide what this meeting requires; offline results are not model judgments.') };
    }
    serial++;
    return new Response(JSON.stringify({ id: `fixture_completion_${serial}`, object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': `fixture-request-${serial}` } });
  };
}
