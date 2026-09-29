// Deterministic SDK transport fixture. It never contacts a model or sends network traffic.
// Expected state is used only here and in tests, never in live model context.
import { scenarioExpectations } from './store.mjs';
export function fixtureFetchFor(store, meetingId) {
  const exp = scenarioExpectations.scenarios?.[meetingId] || scenarioExpectations;
  let turn = 0;
  let serial = 0;
  return async function fixtureFetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    const stage = request.headers.get('x-lab-stage');
    const body = await request.json();
    let message;
    const json = value => ({ role: 'assistant', content: JSON.stringify(value) });
    if (stage === 'extractMeetingFacts') {
      message = json({ accountHint: store.getMeeting(meetingId).accountHint, facts: [{ source: meetingId, summary: 'Current meeting supplies revised commercial terms and follow-through actions.' }], uncertainties: ['Compare current statements with account history before writing.'] });
    } else if (stage === 'assessDealReadiness') {
      message = json({ stage: exp.expectedChanges.stage, rationale: 'Current meeting indicates procurement negotiation; security work remains open, so do not mark won.', evidence: [meetingId] });
    } else if (stage === 'draftFollowUp') {
      message = json(exp.expectedTask);
    } else if (stage === 'reconcileDeal') {
      const deal = store.snapshot().deals.find(d => d.id === exp.dealId);
      const steps = [
        ['search_accounts', { query: store.snapshot().accounts.find(a => a.id === exp.accountId).name }],
        ['get_account', { accountId: exp.accountId }],
        ['list_deals', { accountId: exp.accountId }],
        ['get_deal', { dealId: exp.dealId }],
        ['get_timeline', { accountId: exp.accountId }],
        ['get_field_definitions', {}],
        ['assess_deal_readiness', { dealId: exp.dealId }],
        ['update_deal', { dealId: exp.dealId, expectedVersion: deal.version, changes: exp.expectedChanges, evidence: [meetingId] }],
        ['draft_follow_up', { dealId: exp.dealId }],
        ['create_follow_up_task', { dealId: exp.dealId, ...exp.expectedTask, evidence: [meetingId] }],
      ];
      if (turn < steps.length) {
        const [name, args] = steps[turn++];
        message = { role: 'assistant', content: null, tool_calls: [{ id: `fixture_tool_${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
      } else {
        message = { role: 'assistant', content: 'Updated the matched deal from the current meeting and created a local follow-up task. No message was sent; no other account was changed.' };
      }
    } else throw new Error(`Unknown fixture stage: ${stage}`);
    serial++;
    return new Response(JSON.stringify({ id: `fixture_completion_${serial}`, object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': `fixture-request-${serial}` } });
  };
}
