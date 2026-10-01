import { demoAccount, demoContacts, demoDeal, demoTimeline, demoMeetings, demoExpectations } from './demo-seed.mjs';
// Every person, business, address, amount, and meeting below is wholly invented.
export const seed = {
  accounts: [
    { id: 'acct_maple_works', name: 'Maple Works', domain: 'mapleworks.example.invalid', industry: 'Industrial design', owner: 'Quinn Ellis', notes: 'Synthetic account. Makes modular exhibition fixtures; based in the fictional city of Bellhaven.' },
    { id: 'acct_maple_systems', name: 'Maple Works Systems', domain: 'maplesystems.example.invalid', industry: 'Warehouse software', owner: 'Rowan Vale', notes: 'Synthetic account. Separate business from Maple Works; no shared buying team.' },
    { id: 'acct_lantern', name: 'Lantern Field Labs', domain: 'lanternfield.example.invalid', industry: 'Environmental instruments', owner: 'Quinn Ellis', notes: 'Synthetic account. Produces portable sensors for educational field trips.' },
  ],
  contacts: [
    { id: 'contact_maple_alex', accountId: 'acct_maple_works', name: 'Alex Mercer', email: 'alex@mapleworks.example.invalid', role: 'Operations director' },
    { id: 'contact_maple_maya', accountId: 'acct_maple_works', name: 'Maya Chen', email: 'maya@mapleworks.example.invalid', role: 'IT program manager' },
    { id: 'contact_maple_devon', accountId: 'acct_maple_works', name: 'Devon Ives', email: 'devon@mapleworks.example.invalid', role: 'Procurement lead' },
    { id: 'contact_systems_mara', accountId: 'acct_maple_systems', name: 'Mara Chen', email: 'mara@maplesystems.example.invalid', role: 'Engineering director' },
    { id: 'contact_systems_finn', accountId: 'acct_maple_systems', name: 'Finn Calder', email: 'finn@maplesystems.example.invalid', role: 'Finance manager' },
    { id: 'contact_lantern_eden', accountId: 'acct_lantern', name: 'Eden Shaw', email: 'eden@lanternfield.example.invalid', role: 'Lab operations lead' },
    { id: 'contact_lantern_jules', accountId: 'acct_lantern', name: 'Jules Park', email: 'jules@lanternfield.example.invalid', role: 'Research director' },
  ],
  deals: [
    { id: 'deal_maple_rollout', accountId: 'acct_maple_works', name: 'Studio operations rollout', stage: 'proposal', amount: 64000, closeDate: '2026-10-30', nextStep: 'Send the three-studio proposal to Alex.', championContactId: 'contact_maple_alex', version: 1, notes: 'Synthetic opportunity. Annual subscription for scheduling and inventory workflows.' },
    { id: 'deal_maple_training', accountId: 'acct_maple_works', name: 'Facilitator training package', stage: 'discovery', amount: 9000, closeDate: '2027-01-22', nextStep: 'Revisit training scope after the annual planning meeting.', championContactId: 'contact_maple_alex', version: 1, notes: 'Separate services opportunity. Not bundled into the rollout.' },
    { id: 'deal_systems_rollout', accountId: 'acct_maple_systems', name: 'Warehouse operations rollout', stage: 'evaluation', amount: 78000, closeDate: '2026-12-11', nextStep: 'Complete the warehouse integration pilot with Mara.', championContactId: 'contact_systems_mara', version: 3, notes: 'Different company and buyer from Maple Works.' },
    { id: 'deal_lantern_sensors', accountId: 'acct_lantern', name: 'Field kit coordination', stage: 'negotiation', amount: 36000, closeDate: '2026-11-06', nextStep: 'Confirm the school-term delivery plan with Eden.', championContactId: 'contact_lantern_eden', version: 2, notes: 'Independent synthetic account.' },
  ],
  tasks: [
    { id: 'task_maple_old_proposal', dealId: 'deal_maple_rollout', accountId: 'acct_maple_works', title: 'Send three-studio proposal', dueDate: '2026-10-09', body: 'Send the previous $64,000 scope to Alex for discussion.', status: 'completed', evidence: ['tl_maple_proposal'], createdAt: '2026-10-05T15:00:00.000Z' },
    { id: 'task_maple_training', dealId: 'deal_maple_training', accountId: 'acct_maple_works', title: 'Prepare training discovery agenda', dueDate: '2026-12-03', body: 'Prepare questions for a future, separately priced facilitator workshop.', status: 'open', evidence: ['tl_maple_training'], createdAt: '2026-10-02T16:00:00.000Z' },
    { id: 'task_systems_pilot', dealId: 'deal_systems_rollout', accountId: 'acct_maple_systems', title: 'Review warehouse pilot results', dueDate: '2026-10-19', body: 'Review the integration pilot with Mara Chen.', status: 'open', evidence: ['tl_systems_pilot'], createdAt: '2026-10-08T14:00:00.000Z' },
    { id: 'task_lantern_delivery', dealId: 'deal_lantern_sensors', accountId: 'acct_lantern', title: 'Confirm field kit delivery window', dueDate: '2026-10-20', body: 'Ask Eden to confirm the required school-term delivery window.', status: 'open', evidence: ['tl_lantern_delivery'], createdAt: '2026-10-12T11:00:00.000Z' },
  ],
  timeline: [
    { id: 'tl_maple_discovery', accountId: 'acct_maple_works', dealId: 'deal_maple_rollout', occurredAt: '2026-09-16T15:00:00.000Z', kind: 'meeting', title: 'Initial operations discovery', body: 'Alex Mercer sponsored a potential three-studio rollout. The estimate was $72,000 annually, with a hoped-for October signature. This was an early estimate, not an approved budget.' },
    { id: 'tl_maple_evaluation', accountId: 'acct_maple_works', dealId: 'deal_maple_rollout', occurredAt: '2026-09-25T16:00:00.000Z', kind: 'call', title: 'Evaluation plan agreed', body: 'Alex remained the champion. Two studios participated in evaluation while a third was discussed for the initial contract. Proposal and security questions were outstanding.' },
    { id: 'tl_maple_training', accountId: 'acct_maple_works', dealId: 'deal_maple_training', occurredAt: '2026-10-02T16:00:00.000Z', kind: 'note', title: 'Training is a separate opportunity', body: 'The $9,000 facilitator training package is a separate, early-stage opportunity with a January 2027 target. Do not fold this amount into the annual rollout subscription.' },
    { id: 'tl_maple_proposal', accountId: 'acct_maple_works', dealId: 'deal_maple_rollout', occurredAt: '2026-10-05T15:00:00.000Z', kind: 'proposal', title: 'Three-studio proposal', body: 'Proposal v2 priced three studios at $64,000 per year. CRM moved to proposal, with October 30 as the close date and Alex Mercer as champion. These fields reflect this proposal version.' },
    { id: 'tl_maple_security', accountId: 'acct_maple_works', dealId: 'deal_maple_rollout', occurredAt: '2026-10-08T18:00:00.000Z', kind: 'email_note', title: 'Security review ownership', body: 'Maya Chen, IT program manager, will own the security review. A questionnaire was requested. This note did not approve the review or a contract.' },
    { id: 'tl_maple_tentative', accountId: 'acct_maple_works', dealId: 'deal_maple_rollout', occurredAt: '2026-10-12T14:30:00.000Z', kind: 'call', title: 'Unconfirmed scope reduction', body: 'Alex floated a possible $52,000 two-studio scope and a November 13 signature. Both were tentative and needed confirmation at the October 14 meeting. Alex expected to step out of day-to-day coordination.' },
    { id: 'tl_systems_pilot', accountId: 'acct_maple_systems', dealId: 'deal_systems_rollout', occurredAt: '2026-10-08T14:00:00.000Z', kind: 'meeting', title: 'Warehouse pilot', body: 'Mara Chen is champion for Maple Works Systems. Its warehouse rollout remains in evaluation at $78,000; December 11 is the target close. This company is unrelated to Maple Works.' },
    { id: 'tl_systems_budget', accountId: 'acct_maple_systems', dealId: 'deal_systems_rollout', occurredAt: '2026-10-13T14:00:00.000Z', kind: 'note', title: 'Budget review', body: 'Finn Calder will review warehouse pilot costs. No stage change approved. Mara, not Maya, owns this project.' },
    { id: 'tl_lantern_delivery', accountId: 'acct_lantern', dealId: 'deal_lantern_sensors', occurredAt: '2026-10-12T11:00:00.000Z', kind: 'call', title: 'Delivery planning', body: 'Eden confirmed that the field kit coordination deal remains in negotiation at $36,000. Delivery dates need one more check before a November 6 close.' },
  ],
  meetings: [{
    id: 'mtg_maple_2026_10_21', accountId: 'acct_maple_works', title: 'Maple Works — two opportunities, next steps', accountHint: 'Maple Works (exhibition fixtures; mapleworks.example.invalid)', occurredAt: '2026-10-21T16:00:00.000Z',
    note: `Wholly invented meeting notes — October 21, 2026.

Quinn met with Maya Chen and Alex Mercer at Maple Works, the exhibition-fixture company. Maya said the two-studio operations subscription is still $48,000 annually, with November 20 as the target for signature. She's driving the rollout now; Alex remains the executive sponsor. Security has cleared the questionnaire, and Devon is working through the contract wording. Nothing has been signed yet. Maya asked Quinn to prepare a summary of the remaining contract questions for Devon by October 23, and Quinn agreed. The next conversation should be about those contract questions, rather than another security questionnaire.

Alex then brought up the facilitator training package, which has its own budget. They finished the discovery discussion and agreed on a two-day workshop for $12,000. Alex wants a written proposal before deciding, aiming to make that decision on December 4. Quinn agreed to prepare the workshop outline and quote by October 26. Alex is still the point person for training. The existing December task about a training discovery agenda is old planning work; nobody discussed canceling it on this call.

Maya joked about adding a third studio next year, but said there isn't a budget or schedule for that yet. Quinn closed by repeating the two promised documents and their dates.`,
  }, {
    id: 'mtg_maple_2026_10_22', accountId: 'acct_maple_works', title: 'Maple Works — an unclear hallway update', accountHint: 'Maple Works (exhibition fixtures; mapleworks.example.invalid)', occurredAt: '2026-10-22T17:00:00.000Z',
    note: `Wholly invented meeting notes — October 22, 2026.

Quinn had a short hallway conversation with Alex at Maple Works. Alex said, "I heard phase two might be around fifteen thousand, but I'm not sure whether that was the training idea or something Maya was exploring. Don't hold me to it."

Quinn asked whether there was an approved scope or a target date. Alex didn't know and said he would need to ask the team. He couldn't say who owned this possible work. The conversation ended when Alex had to join another call. No follow-up owner or deadline was agreed, and nobody discussed changing either current opportunity.`,
  }, {
    id: 'mtg_lantern_2026_10_15', accountId: 'acct_lantern', title: 'Lantern Field Labs — a check-in with no new commitments', accountHint: 'Lantern Field Labs (lanternfield.example.invalid)', occurredAt: '2026-10-15T15:00:00.000Z',
    note: `Wholly invented meeting notes — October 15, 2026.

Quinn caught up with Eden Shaw at Lantern Field Labs about field kit coordination. Eden said they're still negotiating the $36,000 plan and aiming for November 6. Eden remains the lead on their side. The school-term delivery window still needs checking, and Quinn already has that follow-up on the calendar for October 20.

Eden hasn't received new information from the schools. They agreed there was no reason to add another reminder for the same delivery question. There were no new commercial terms, promised documents, deadlines, or decisions today.`,
  }, {
    id: 'mtg_maple_2026_10_14', accountId: 'acct_maple_works', title: 'Maple Works — rollout scope and procurement', accountHint: 'Maple Works (exhibition fixtures; mapleworks.example.invalid)', occurredAt: '2026-10-14T16:00:00.000Z',
    note: `Wholly invented meeting notes — October 14, 2026, 11:00–11:45 a.m. Central.

Attendees were Maya Chen (IT program manager), Alex Mercer (operations director), Devon Ives (procurement lead), and our account owner Quinn Ellis. This was Maple Works, the exhibition-fixture company using mapleworks.example.invalid. It was not Maple Works Systems, the warehouse-software company. The deal discussed was the Studio operations rollout. The separate Facilitator training package was mentioned only to confirm that it remains out of scope.

We started by reviewing the old proposal and the notes from Monday. The $64,000 three-studio proposal is superseded. Alex's Monday suggestion of $52,000 was only a negotiating placeholder; it was never an approved budget. The group now agreed on two studios at an annual subscription amount of $48,000. Record the amount as 48000 USD. Do not add the $9,000 training package or any implementation fee to that amount. No third studio is included, and no discount beyond the agreed two-studio amount was discussed.

Maya said the functional evaluation is complete and the business has chosen to proceed, subject to security review and contract terms. Devon opened commercial negotiations during this meeting. Move the rollout opportunity from proposal to negotiation. This is not a signed contract and should not be marked won. There is no evidence of a lost deal or of a failed evaluation. Security approval is still outstanding, so do not state that it is complete.

The prior October 30 target is no longer feasible. Monday's November 13 date was also provisional and is superseded. Devon and Maya agreed that the target close date is November 20, 2026. Procurement will work backward from that date. This is a target for the opportunity record, not a guarantee of signature or a request to schedule an external event.

Alex remains the executive sponsor but is handing day-to-day ownership to Maya. Maya is now the internal champion for this rollout. Use the existing Maya Chen contact on this account. Do not create another contact, assign this to the similarly named Mara Chen at Maple Works Systems, or remove Alex from the contact list. Devon is the procurement lead, not the champion.

Quinn will prepare the security questionnaire for Maya. Create one open follow-up task on the Studio operations rollout titled "Prepare security questionnaire for Maya", due October 16, 2026. Its body should say: "Prepare the security questionnaire for Maya Chen and collect her review before arranging the procurement call with Devon Ives." This is a local task only; no email is to be sent and no meeting invitation is requested. The due date is for preparing the questionnaire, not for closing the opportunity. The old task to send the three-studio proposal is already completed; leave that history as it is.

Record the rollout's next step as: "Complete security review with Maya Chen, then arrange a procurement call with Devon Ives." This sequence matters because Devon asked to see the security review before the next procurement conversation. A later procurement-call date was not agreed, so do not invent one or create a second task for it. Do not change any unrelated deals, including this account's training opportunity or the warehouse rollout at Maple Works Systems.

At the end, Maya repeated the two-studio amount, November 20 target, and champion handoff. Devon confirmed the questionnaire follow-up for October 16. These final confirmations replace the historical proposals and tentative dates in the timeline. Preserve the timeline records as historical evidence; update only the current rollout fields and add the one agreed follow-up task.`,
  }],
};

seed.accounts.unshift(demoAccount);
seed.contacts.push(...demoContacts);
seed.deals.push(demoDeal);
seed.timeline.push(...demoTimeline);
seed.meetings.unshift(...demoMeetings);

// Only deterministic offline tests/fixture transport may read this oracle.
// It must never become model instructions or evidence.
export const scenarioExpectations = Object.freeze({
  scenarios: Object.freeze(demoExpectations),
  meetingId: 'mtg_maple_2026_10_14',
  accountId: 'acct_maple_works',
  dealId: 'deal_maple_rollout',
  expectedChanges: Object.freeze({ stage: 'negotiation', amount: 48000, closeDate: '2026-11-20', nextStep: 'Complete security review with Maya Chen, then arrange a procurement call with Devon Ives.', championContactId: 'contact_maple_maya' }),
  expectedTask: Object.freeze({ title: 'Prepare security questionnaire for Maya', dueDate: '2026-10-16', body: 'Prepare the security questionnaire for Maya Chen and collect her review before arranging the procurement call with Devon Ives.' }),
  preservedDealIds: Object.freeze(['deal_maple_training', 'deal_systems_rollout', 'deal_lantern_sensors']),
});
