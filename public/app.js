'use strict';
const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const money = (n, digits = 0) => Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n) : 'Unavailable';
const labels = { frontierSpendMonthly: 'Monthly frontier API spend', deployment: 'Deployment requirement', nextStep: 'Next agreed step', pain: 'Customer pain', amount: 'Opportunity amount', closeDate: 'Target close', stage: 'Sales stage', championContactId: 'Champion', buyingProcess: 'Buying process', stakeholderNotes: 'Buying team', notes: 'Deal notes' };
const state = { data: null, meetingId: 'demo_extract_events', usecase: 'extraction', route: 'baseline', output: 'overview', view: 'workspace', comparison: null, run: null, busy: false, initializing: true, timer: null, request: 0, editing: false, guidance: '', candidateReplay: 'complete', routeConfigs: readRouteConfigs() };
function readRouteConfigs() {
  try { const value = JSON.parse(localStorage.getItem('demo-route-configs-v1') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
async function api(url, body) {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'The local app could not complete this request.'); return value;
}
function report(error) { $('page-error').hidden = !error; $('page-error').textContent = error?.message || error || ''; }
function meeting() { return state.data?.meetings.find(m => m.id === state.meetingId); }
function side() { return state.comparison?.sides.find(s => s.side === state.route); }
function currentDraft() { const s = side(); const original = s?.run.drafts?.find(d => d.meetingId === state.meetingId); return s?.reviewedDrafts?.find(d => d.id === original?.id) || original; }
function contactName(id) { return state.data?.contacts.find(c => c.id === id)?.name || id; }
function fieldValue(key, value) { if (key === 'frontierSpendMonthly') return money(value) + ' / month'; if (key === 'amount') return money(value); if (key === 'championContactId') return contactName(value); if (key === 'deployment') return ({ cloud: 'Cloud', on_prem: 'On-premises', hybrid: 'Hybrid', unknown: 'Unknown' })[value] || value; return value ?? 'Not recorded'; }
function changes() { if (!Array.isArray(state.run?.after?.deals) || !Array.isArray(state.run?.before?.deals)) return []; return state.run.after.deals.flatMap(after => { const before = state.run.before.deals.find(d => d.id === after.id); return Object.keys(labels).filter(k => before?.[k] !== after[k]).map(key => ({ key, before: before?.[key], after: after[key] })); }); }
function tasks() { return state.run?.after?.tasks?.filter(t => !(state.run.before.tasks || []).some(b => b.id === t.id)) || []; }
function outputEmpty(message) { const block = el('div', 'empty-result'); block.append(el('span', '', '↗'), el('h3', '', 'One conversation. A complete follow-through.'), el('p', '', message)); return block; }
function renderMeeting() {
  const m = meeting(); if (!m) return;
  const explicit = state.meetingId === 'mtg_cedar_explicit';
  $('meeting-title').textContent = explicit ? 'Architecture & pilot plan' : 'Confirmations needed';
  $('meeting-preview').textContent = explicit ? 'Nina and Sam confirmed a new deployment requirement and the next steps for the pilot. The follow-up needs to carry the buying process forward.' : 'Nina mentioned possible spending and deployment changes. Neither is confirmed. The assistant needs to ask the right questions without rewriting the deal.';
  $('meeting-note').textContent = m.note;
  const highlights = explicit ? ['On-premises deployment is now required.', 'Frontier API spend is $110,000 per month.', 'Sam reviews architecture before Nina starts the benchmark.'] : ['A new spending estimate is still tentative.', 'Deployment is awaiting Sam’s decision.', 'Keep confirmed facts; ask for clarification.'];
  $('meeting-highlights').replaceChildren(...highlights.map(text => { const row = el('div', 'highlight'); row.append(el('span', 'small-check', explicit ? '✓' : '○'), el('span', '', text)); return row; }));
  const count = state.data.timeline.filter(t => t.accountId === m.accountId).length;
  $('context-count').textContent = `${count} dated context sources`;
  document.querySelectorAll('[data-scenario]').forEach(b => { b.classList.toggle('active', b.dataset.scenario === state.meetingId); b.disabled = state.busy; });
}
function renderOutput() {
  if (state.usecase !== 'workflows') { renderStructured(); return; }
  const s = side(); const root = $('output-content'); const draft = currentDraft();
  $('result-state').textContent = s ? s.evaluation.passed ? 'Checks passed' : 'Needs attention' : 'Ready to run';
  $('changes-count').textContent = changes().length; $('tasks-count').textContent = tasks().length;
  document.querySelectorAll('[data-route]').forEach(b => { b.classList.toggle('active', b.dataset.route === state.route); b.setAttribute('aria-pressed', String(b.dataset.route === state.route)); });
  document.querySelectorAll('[data-output]').forEach(b => { b.classList.toggle('active', b.dataset.output === state.output); b.setAttribute('aria-pressed', String(b.dataset.output === state.output)); });
  $('baseline-route-detail').textContent = state.comparison?.mode === 'live' ? state.comparison.baselineModel : 'Scripted demo replay';
  $('candidate-route-detail').textContent = state.comparison?.mode === 'live' ? state.comparison.candidateModel : 'Scripted demo replay';
  const passed = s?.evaluation.checks.filter(c => c.pass).length;
  $('output-checks').textContent = s ? `${passed}/${s.evaluation.checks.length} outcome checks · ${state.comparison.mode === 'offline' ? 'synthetic replay' : 'live run'}` : 'Tool calls · saved state · approval';
  root.replaceChildren();
  if (!s) { root.append(outputEmpty('Run the demo to create a follow-up, reconcile the deal, and capture what happens next.')); return; }
  renderWorkflowExecution(root); return;
}
function renderDraft(root, draft) {
    const head = el('div', 'draft-header', 'To');
    for (const id of draft.recipientContactIds) head.append(el('span', 'recipient-tag', contactName(id)));
    root.append(head, el('div', 'draft-subject', draft.subject), el('div', 'draft-body', draft.body));
    const actions = el('div', 'draft-actions');
    actions.append(el('p', '', draft.status === 'approved' ? 'Approved locally · no email sent' : 'Salesperson approval required before sending'));
    const buttons = el('div'); const edit = el('button', 'text-button', 'Edit draft'); edit.disabled = state.busy; edit.addEventListener('click', () => { state.editing = true; renderOutput(); });
    const approve = el('button', 'primary', draft.status === 'approved' ? 'Approved ✓' : 'Approve draft'); approve.disabled = state.busy || draft.status === 'approved'; approve.addEventListener('click', () => reviewDraft(draft, { subject: draft.subject, body: draft.body, recipientContactIds: draft.recipientContactIds }, true)); buttons.append(edit, document.createTextNode('   '), approve); actions.append(buttons); root.append(actions);
}
function renderWorkflowExecution(root) {
  const run = state.run;
  if (!run) { root.append(outputEmpty('The captured attempt is loading.')); return; }
  const calls = run.events.filter(e => e.type === 'tool_call');
  const results = run.events.filter(e => e.type === 'tool_result' && !e.data.result?.error && !e.data.error);
  const observed = name => results.some(e => e.data.name === name);
  const summary = el('div', 'execution-summary');
  for (const [value, label] of [[calls.length, 'tool calls'], [changes().length, 'field changes'], [tasks().length, 'new tasks']]) {
    const stat = el('div'); stat.append(el('strong', '', value), el('small', '', label)); summary.append(stat);
  }
  root.append(summary);
  const step = (number, title, detail, completed, buttonLabel, action) => {
    const card = el('article', 'execution-step'); const marker = el('span', 'step-number', number);
    const content = el('div', 'step-content'); const head = el('div', 'step-head'); head.append(el('h3', '', title), el('span', 'step-state', completed ? 'Recorded' : 'Not recorded'));
    content.append(head, el('p', '', detail));
    if (buttonLabel) { const button = el('button', 'text-button', buttonLabel); button.addEventListener('click', action); content.append(button); }
    card.append(marker, content); root.append(card); return content;
  };
  const context = results.find(e => e.data.name === 'get_timeline')?.data.result;
  step('01', 'Resolve the context', context ? `${context.timeline?.length || 0} dated sources retrieved alongside account details, current records and tool constraints.` : 'Inspect the trace to see whether the attempt retrieved the required history.', observed('get_timeline') && observed('get_deal'), 'Inspect the input history ↗', openHistory);
  const updated = changes(); const newTasks = tasks();
  const stateStep = step('02', 'Reconcile records & capture the next step', updated.length || newTasks.length ? 'The saved application state shows these changes and commitments.' : 'No fields or commitments were changed. Unconfirmed details remain open questions.', observed('get_deal') && run.status === 'succeeded', null, null);
  const facts = el('div', 'execution-facts');
  for (const c of updated.filter(c => c.key !== 'nextStep')) { const row = el('div'); row.append(el('span', '', labels[c.key]), el('strong', '', fieldValue(c.key,c.after))); facts.append(row); }
  for (const task of newTasks) { const row = el('div'); row.append(el('span', '', 'Next task'), el('strong', '', `${task.title} · ${task.dueDate}`)); facts.append(row); }
  stateStep.append(facts);
  if (updated.length || newTasks.length) {
    const detail = el('details', 'inline-output-details'); detail.append(el('summary', '', 'Expand saved changes & tasks'));
    for (const change of updated) { const row = el('div', 'change-item'); const text = el('div'); text.append(el('strong', '', labels[change.key]), el('p', '', `Previously: ${fieldValue(change.key, change.before)}`), el('p', 'after', `Now: ${fieldValue(change.key, change.after)}`)); row.append(text); detail.append(row); }
    for (const task of newTasks) { const card = el('article', 'next-task'); card.append(el('h3', '', task.title), el('p', '', task.body), el('small', '', `Due ${task.dueDate} · Open task`)); detail.append(card); }
    stateStep.append(detail);
  }
  const draft = currentDraft();
  const draftStep = step('03', 'Prepare the human-reviewed follow-up', draft ? `Draft prepared for ${draft.recipientContactIds.map(contactName).join(' and ')}. ${draft.status === 'approved' ? 'Approved locally; no message sent.' : 'Salesperson approval is still required.'}` : 'This attempt has not recorded a follow-up draft.', Boolean(draft), null, null);
  if (draft) { const details = el('details', 'inline-output-details'); details.open = state.editing; details.append(el('summary', '', 'Expand follow-up draft')); const content = el('div', 'inline-draft'); if (state.editing) renderEditor(content,draft); else renderDraft(content,draft); details.append(content); draftStep.append(details); }
  root.append(el('p', 'muted task-limit', state.comparison.mode === 'offline' ? 'Scripted SDK replay with real local tools. Check the saved results; no live model or external system is involved.' : 'Captured tool actions on synthetic records. Check the saved results and review the draft before acceptance.'));
}
function renderEditor(root, draft) {
  const form = el('form', 'draft-editor');
  const recipients = el('fieldset'); recipients.append(el('legend', '', 'Recipients'));
  for (const c of state.data.contacts.filter(c => c.accountId === draft.accountId)) { const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.value = c.id; input.checked = draft.recipientContactIds.includes(c.id); label.append(input, document.createTextNode(c.name)); recipients.append(label); }
  const subjectLabel = el('label', '', 'Subject'); const subject = el('input'); subject.value = draft.subject; subject.maxLength = 200; subject.required = true; subjectLabel.append(subject);
  const bodyLabel = el('label', '', 'Follow-up'); const body = el('textarea'); body.value = draft.body; body.rows = 8; body.maxLength = 6000; body.required = true; bodyLabel.append(body);
  const save = el('button', 'primary', 'Save · require review'); save.type = 'submit'; const cancel = el('button', 'text-button', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => { state.editing = false; renderOutput(); });
  form.append(recipients, subjectLabel, bodyLabel, save, document.createTextNode('  '), cancel);
  form.addEventListener('submit', e => { e.preventDefault(); reviewDraft(draft, { subject: subject.value, body: body.value, recipientContactIds: [...recipients.querySelectorAll('input:checked')].map(input => input.value) }, false); }); root.append(form);
}
async function reviewDraft(draft, content, approve) {
  try { report(null); await api(`/api/comparisons/${state.comparison.id}/drafts/${draft.id}`, { side: state.route, expectedVersion: draft.version, ...content, approve }); state.editing = false; await refresh(); }
  catch (error) { report(error); }
}
const workloadDescriptions = {
  extraction: { name: 'Extraction', shape: 'Single request · typed event records · source evidence · no tools', context: 'Both models extract the same document into the same event schema. Checks cover the JSON contract, corrected dates, missing values and source evidence.' },
  classification: { name: 'Classification', shape: 'Single request · five allowed labels · three input messages · no tools', context: 'Both models classify the same messages using the same five-label taxonomy. Category correctness and the bare JSON interface are checked separately.' },
  workflows: { name: 'Workflow', shape: 'Multi-turn agent · history retrieval · local tools · saved-state checks', context: 'Both models use the same instructions, tools and independent starting records. The loop includes context reads, scoped writes and a draft that requires human approval.' },
};
function saveRouteConfig() {
  if (!$('baseline-model').value) return;
  state.routeConfigs[state.usecase] = Object.fromEntries(['baseline-model','candidate-model','execution-mode','baseline-input','baseline-output','candidate-input','candidate-output','sample-baseline','sample-candidate','task-volume'].map(id => [id, $(id).value]));
  try { localStorage.setItem('demo-route-configs-v1', JSON.stringify(state.routeConfigs)); } catch { /* still keep session settings */ }
}
function loadRouteConfig(kind) {
  const saved = state.routeConfigs[kind] || { 'baseline-model': state.data.config.model, 'candidate-model': state.data.config.liveReady ? '' : 'fixture-candidate', 'execution-mode': 'offline', 'sample-baseline': '0.024', 'sample-candidate': '0.006', 'task-volume': '100000' };
  for (const id of ['baseline-model','candidate-model','execution-mode','baseline-input','baseline-output','candidate-input','candidate-output','sample-baseline','sample-candidate','task-volume']) $(id).value = typeof saved[id] === 'string' ? saved[id] : ({'execution-mode':'offline','sample-baseline':'0.024','sample-candidate':'0.006','task-volume':'100000'}[id] || '');
}
function renderModelContext() {
  const workload = workloadDescriptions[state.usecase]; const live = $('execution-mode').value === 'live';

  $('model-config-title').textContent = `${workload.name} model configuration`;
  $('model-config-description').textContent = workload.context;
  $('settings-button').setAttribute('aria-label', `Configure ${workload.name.toLowerCase()} models`);
  const root = $('workload-model-summary'); root.replaceChildren();
  const description = el('div', 'model-context-copy'); description.append(el('strong', '', `${workload.name} routes`), el('small', '', workload.shape));
  const routes = el('div', 'model-context-routes');
  for (const route of ['baseline','candidate']) {
    const chip = el('div', `model-config-chip ${route}`); const label = el('small', '', route === 'baseline' ? 'Frontier baseline' : 'Alternative candidate');
    const value = el('strong', '', live ? $(route === 'baseline' ? 'baseline-model' : 'candidate-model').value || 'Choose a model' : 'Scripted demo replay');
    chip.append(label,value); routes.append(chip);
  }
  root.append(description);
}
function economicValues() {
  if (state.comparison?.mode === 'live') {
    const b = state.comparison.sides.find(s => s.side === 'baseline'); const c = state.comparison.sides.find(s => s.side === 'candidate');
    return { baseline: b?.evaluation.passed && b.metrics.estimatedCostUSD !== null ? b.metrics.estimatedCostUSD : null, candidate: c?.evaluation.passed && c.metrics.estimatedCostUSD !== null ? c.metrics.estimatedCostUSD : null, live: true };
  }
  return { baseline: Number($('sample-baseline').value), candidate: Number($('sample-candidate').value), live: false };
}
function renderEconomics() {
  const v = economicValues(); const volume = Number($('task-volume').value); const qualifies = Boolean(state.comparison) && state.comparison.sides.length === 2 && state.comparison.sides.every(s => s.evaluation.passed); const valid = qualifies && [v.baseline, v.candidate].every(n => Number.isFinite(n) && n >= 0);
  $('volume-label').textContent = volume.toLocaleString();
  $('economics-kind').textContent = v.live ? 'PROJECTED FROM THIS LIVE ATTEMPT' : 'ILLUSTRATIVE ECONOMICS';
  $('savings-caption').textContent = v.live ? 'projected monthly difference · outcome-check-passing task' : 'potential monthly savings · planning example';
  $('monthly-savings').textContent = !qualifies ? 'Not qualified' : valid ? money((v.baseline - v.candidate) * volume) : 'Unavailable';
  if (!qualifies) $('savings-caption').textContent = 'Complete the required outcome checks before projecting savings.';
  $('baseline-monthly').textContent = valid ? money(v.baseline * volume) : 'Unavailable'; $('candidate-monthly').textContent = valid ? money(v.candidate * volume) : 'Unavailable';
  $('inline-savings').textContent = !qualifies ? 'Savings withheld until both routes pass.' : valid ? money((v.baseline - v.candidate) * volume) + ' potential monthly difference' : 'Cost comparison unavailable';
  $('inline-savings-note').textContent = v.live ? 'Projected from observed usage and supplied rates; not verified billing.' : 'Illustrative planning example · ' + volume.toLocaleString() + ' accepted tasks / month';
  $('baseline-bar').style.width = valid ? `${Math.min(100, v.baseline / Math.max(v.baseline, v.candidate, .00001) * 100)}%` : '0%';
  $('candidate-bar').style.width = valid ? `${Math.min(100, v.candidate / Math.max(v.baseline, v.candidate, .00001) * 100)}%` : '0%';
  $('sample-baseline').disabled = v.live; $('sample-candidate').disabled = v.live;
  $('assumptions-summary').textContent = v.live ? 'Projection assumptions · not verified billing' : 'Planning assumptions · not measured savings';
  $('economics-note').textContent = v.live ? 'Per-attempt token costs use supplied provider rates. Only outcome-check-passing runs enter this projection; human acceptance, repeated-run reliability, cache discounts, infrastructure and optimization costs are not included.' : 'These per-task costs are illustrative inputs for the demo, not measured model performance. Fixture checks do not establish real model parity.';
}
function renderStudio() {
  const comparison = state.comparison;
  $('comparison-status').textContent = comparison ? comparison.status === 'completed' ? 'Comparison ready' : comparison.status : 'Awaiting comparison';
  const v = economicValues();
  $('route-scorecards').replaceChildren(...['baseline', 'candidate'].map(route => {
    const s = comparison?.sides.find(s => s.side === route); const card = el('article', `scorecard ${route}`); const head = el('div', 'scorecard-head'); const name = el('div', 'scorecard-title'); name.append(el('span', `route-mark ${route === 'candidate' ? 'optimized' : ''}`, route === 'candidate' ? 'o' : 'F'));
    const title = el('div', '', route === 'baseline' ? 'Frontier route' : 'Optimized route'); title.append(el('div', 'model-name', comparison?.mode === 'live' ? s?.requestedModel || 'Pending' : comparison?.candidateReplay === 'missed_context' && route === 'candidate' ? 'Curated failing replay · no live model' : 'Scripted replay · no live model')); name.append(title);
    head.append(name, el('span', 'pill', !s ? 'Ready' : s.evaluation.passed ? 'Outcome checks passed' : 'Needs attention'));
    const metrics = el('div', 'score-metrics'); const rate = v[route];
    const items = [[v.live ? 'Estimated cost / passing task' : 'Illustrative cost / task', Number.isFinite(rate) ? money(rate, 4) : '—'], ['Outcome checks', s ? `${s.evaluation.checks.filter(c => c.pass).length}/${s.evaluation.checks.length}` : '—'], ['Latency', s && v.live ? `${(s.metrics.elapsedMs/1000).toFixed(1)}s` : 'Not measured']];
    for (const [label, value] of items) { const item = el('div'); item.append(el('small', '', label), el('strong', '', value)); metrics.append(item); }
    card.append(head, metrics, el('p', 'scorecard-foot', s ? comparison.mode === 'live' ? `Served: ${s.metrics.servedModels.join(', ') || 'unconfirmed'} · ${s.metrics.modelCalls} calls · Human review remains required.` : 'Synthetic task replay. Costs are planning inputs; model parity is unmeasured.' : 'Run both routes against the same frozen task.')); return card;
  }));
  const baseline = comparison?.sides.find(s => s.side === 'baseline'); const candidate = comparison?.sides.find(s => s.side === 'candidate');
  const table = el('table', 'quality-table'); const head = el('thead'); const row = el('tr'); for (const name of ['Required outcome', 'Frontier', 'Optimized']) { const th = el('th', '', name); th.scope = 'col'; row.append(th); } head.append(row); table.append(head);
  const body = el('tbody'); const keys = [...new Set([...(baseline?.evaluation.checks || []), ...(candidate?.evaluation.checks || [])].map(c => c.name))];
  const readable = { 'frontierSpendMonthly: confirmed value': 'Confirmed spend carried forward', 'deployment: confirmed value': 'Latest deployment decision applied', 'Unrelated deal fields preserved': 'Commercial terms preserved', 'Other opportunities preserved': 'Other deals left untouched', 'Existing tasks preserved': 'Existing commitments preserved', 'One agreed task, correct deal and deadline': 'Agreed action and deadline captured', 'One draft awaiting salesperson approval': 'Draft requires human approval', 'Correct prospect recipients': 'Correct people included', 'No invented task or deadline': 'No invented commitments' };
  for (const key of keys) { const tr = el('tr'); tr.append(el('td', '', readable[key] || key)); for (const s of [baseline, candidate]) { const check = s?.evaluation.checks.find(c => c.name === key); tr.append(el('td', check?.pass === false ? 'fail' : '', check ? check.pass ? '✓' : '×' : '—')); } body.append(tr); } table.append(body);
  $('quality-matrix').replaceChildren(keys.length ? table : el('div', 'empty-result', 'Outcome checks will appear after the first replay.'));
  renderEconomics(); renderModelContext();
}
function renderControls() {
  state.busy = Boolean(state.data?.activeComparison || state.data?.activeRun);
  document.querySelectorAll('[data-usecase]').forEach(b => b.disabled = state.busy || state.initializing); $('workflow-scenario').disabled = state.busy || state.initializing;
  $('run-button').disabled = state.busy; $('run-label').textContent = state.busy ? 'Comparing routes…' : $('execution-mode').value === 'live' ? 'Run live comparison' : 'Run demo replay';
  $('mode-badge').textContent = state.comparison?.mode === 'live' ? 'Live comparison · synthetic data' : 'Synthetic demo replay';
  $('evidence-label').textContent = state.comparison?.mode === 'live' ? 'Real model evidence · user-supplied cost estimates' : 'Scripted replay · illustrative economics';
  $('run-progress').hidden = !state.busy;
  $('refine-run-button').disabled = state.busy;
  $('failure-button').hidden = $('execution-mode').value !== 'offline' || (state.usecase === 'workflows' && state.meetingId !== 'mtg_cedar_explicit');
  $('failure-button').disabled = state.busy;
  $('passing-replay-button').hidden = $('execution-mode').value !== 'offline';
}
async function selectRoute(route) {
  state.route = route; state.editing = false; state.run = null; const request = ++state.request;
  const s = side(); if (s) { try { const run = await api(`/api/runs/${s.run.id}`); if (request !== state.request) return; state.run = run; } catch(error) { report(error); } }
  renderOutput();
}
async function refresh() {
  state.data = await api('/api/state');
  const comparison = state.data.comparisons.filter(c => c.meetingId === state.meetingId).at(-1);
  state.comparison = comparison || null;
  renderMeeting(); renderControls(); renderStudio(); await selectRoute(state.route);
  if ($('inspector').open && !$('comparison-deep').hidden) await openEvidence();
  clearTimeout(state.timer); if (state.busy) state.timer = setTimeout(() => refresh().catch(report), 1600);
}
async function runComparison() {
  if (state.busy) return;
  try {
    report(null); $('run-button').disabled = true;
    const pricing = {};
    for (const route of ['baseline', 'candidate']) { const input = $(`${route}-input`).value; const output = $(`${route}-output`).value; if (input || output) { if (!input || !output) throw new Error('Enter both token rates for a route, or leave both blank.'); pricing[route] = { input: Number(input), output: Number(output) }; } }
    const result = await api('/api/comparisons', { meetingId: state.meetingId, mode: $('execution-mode').value, baselineModel: $('baseline-model').value.trim(), candidateModel: $('candidate-model').value.trim(), candidateGuidance: state.guidance, candidateReplay: state.candidateReplay, ...(Object.keys(pricing).length ? { pricing } : {}) });
    if (!result.id) throw new Error('The server did not create a comparison.'); await refresh();
  } catch(error) { report(error); renderControls(); }
}
function showView() {
  state.view = 'workspace';
  $('workspace-view').hidden = state.usecase !== 'workflows';
  $('structured-view').hidden = state.usecase === 'workflows';
  $('studio-view').hidden = false;
  document.querySelectorAll('[data-usecase]').forEach(b => b.classList.toggle('active', b.dataset.usecase === state.usecase));
  $('page-name').textContent = {extraction:'Extraction',classification:'Classification',workflows:'Workflows'}[state.usecase];
  $('page-title').textContent = {extraction:'Extract the facts. Keep the evidence.',classification:'The right category. The right contract.',workflows:'Complete the work. Preserve the details.'}[state.usecase];
  $('page-subtitle').textContent = {extraction:'Unstructured text becomes typed records your application can use.',classification:'Reliable labels and machine-readable answers for downstream systems.',workflows:'A multi-step example: read history, update records, and prepare a follow-up.'}[state.usecase];
  document.querySelector('.heading .eyebrow').textContent = 'RUN. SWITCH. COMPARE.';
  renderModelContext();
}
function taskDemo() { return state.data?.taskDemos?.find(t => t.id === state.meetingId); }
function renderStructured() {
  const task = taskDemo(); if (!task) return;
  $('task-title').textContent = task.title; $('task-description').textContent = task.description; $('task-input').textContent = task.input; $('task-shape').textContent = task.shape;
  $('task-concerns').replaceChildren(...task.concerns.map(c => el('div', 'highlight', '✓ ' + c)));
  $('task-output-title').textContent = task.kind === 'extraction' ? 'Structured records. Grounded values.' : 'A category for every request.';
  const s = side(); $('task-result-state').textContent = s ? s.evaluation.passed ? 'Checks passed' : 'Needs attention' : 'Ready to run';
  const root = $('task-output'); root.replaceChildren();
  document.querySelectorAll('[data-route]').forEach(b => { b.classList.toggle('active', b.dataset.route === state.route); b.setAttribute('aria-pressed', String(b.dataset.route === state.route)); });
  $('task-checks').textContent = s ? `${s.evaluation.checks.filter(c => c.pass).length}/${s.evaluation.checks.length} outcome checks · ${state.comparison.mode === 'offline' ? 'scripted replay' : 'live attempt'}` : 'Schema · coverage · correctness';
  if (!state.run) { root.append(el('div', 'empty-result', 'Run both routes to inspect the structured output and compare their checks.')); return; }
  if (!state.run.contractOK) root.append(el('p', 'error', 'The output contract failed. Any parsed records below are for inspection only.'));
  const records = state.run.output?.[task.kind === 'extraction' ? 'events' : 'classifications'];
  if (Array.isArray(records)) for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const card = el('article', 'next-task');
    if (task.kind === 'extraction') {
      card.append(el('h3', '', record.name || 'Unnamed event'), el('p', '', `${record.date ?? 'Unknown date'} · ${record.time ?? 'Time unknown'}${record.timezone ? ' ' + record.timezone : ''}`), el('small', '', `Source: ${record.source ?? 'Missing'} · ${record.evidence ?? 'No evidence'}`));
    } else { card.append(el('h3', '', record.id || 'Missing identifier'), el('span', 'category-tag', record.category || 'Missing category')); }
    root.append(card);
  }

  root.append(el('p', 'muted task-limit', state.comparison.mode === 'offline' ? 'Scripted SDK replay. No model was called; these checks are not proof of model reliability.' : 'One live attempt on a frozen synthetic input. Use a representative, repeated eval before deployment.'));
}
async function selectUsecase(kind) {
  if (state.busy) return;
  report(null); state.run = null; ++state.request;
  if (state.configInitialized) saveRouteConfig();
  state.usecase = kind; loadRouteConfig(kind); state.meetingId = { extraction: 'demo_extract_events', classification: 'demo_classify_inbox', workflows: $('workflow-scenario').value }[kind];
  state.route = 'baseline'; state.output = 'overview'; state.editing = false; state.guidance = ''; state.candidateReplay = 'complete'; $('candidate-guidance').value = '';
  const ready = kind === 'workflows' ? state.data.config.liveReady : state.data.config.structuredLiveReady;
  $('execution-mode').querySelector('[value=live]').disabled = !ready;
  if (!ready) $('execution-mode').value = 'offline';
  showView('workspace'); await refresh().catch(report);
}
async function openEvidence() {
  $('comparison-deep').hidden = false;
  $('inspector-title').textContent = workloadDescriptions[state.usecase].name + ' · technical details'; const content = $('inspector-content'); content.replaceChildren();
  const c = state.comparison;
  const explanation = el('section', 'evidence-block'); explanation.append(el('h3', '', 'A controlled comparison'), el('p', '', c ? `${c.identicalStartingState ? 'Identical starting records and history confirmed.' : 'Starting-state equality has not been confirmed.'} ${c.identicalInstructions === false ? 'The candidate includes an explicit operator instruction variant.' : 'Both routes use the same workload instructions.'} ${state.usecase === 'workflows' ? 'Tools mutate isolated synthetic stores.' : 'Each route receives the same frozen synthetic input; gold answers are excluded from live prompts.'} No customer system is connected.` : 'Run a comparison to inspect the exact records, tools and outcomes.'));
  if (c?.startingStateSHA256) { const hash = el('details'); hash.append(el('summary', '', 'Starting-state fingerprint'), el('pre', '', c.startingStateSHA256)); explanation.append(hash); }
  content.append(explanation);
  const task = taskDemo();
  if (task) { const block = el('section', 'evidence-block'); block.append(el('h3', '', 'Output interface'),el('pre', '', task.shape)); if (state.run) block.append(el('h3', '', 'Exact output from this attempt'),el('pre', '', state.run.rawOutput || '(empty)')); content.append(block); }
  for (const s of c?.sides || []) {
    const block = el('section', 'evidence-block'); block.append(el('h3', '', s.side === 'baseline' ? 'Frontier route' : 'Optimized route'), el('p', '', s.evaluation.notice));

    const actions = el('div', 'evidence-actions'); const link = el('a', '', 'Open full run explorer ↗'); link.href = `/debug?run=${encodeURIComponent(s.run.id)}`; actions.append(link); block.append(actions); content.append(block);
  }
  if (state.run) {
    const block = el('section', 'evidence-block'); block.append(el('h3', '', 'Actions in this attempt'));
    for (const event of state.run.events.filter(e => ['llm_request', 'llm_response', 'tool_call', 'tool_result', 'error', 'draft_review'].includes(e.type))) { const details = el('details'); details.append(el('summary', '', `${event.type.replaceAll('_',' ')} · ${event.data.name || event.data.tool || event.stage}`), el('pre', '', JSON.stringify(event.data,null,2))); block.append(details); } content.append(block);
  }
  if (!$('inspector').open) $('inspector').showModal();
}
function openHistory() {
  $('comparison-deep').hidden = true;
  $('inspector-title').textContent = 'The input context'; const content = $('inspector-content'); const input = el('input'); input.type = 'search'; input.placeholder = 'Search spending, deployment, stakeholders…'; input.setAttribute('aria-label', 'Search customer history'); const list = el('div');
  const sources = state.data.timeline.filter(t => t.accountId === meeting().accountId).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
  const render = () => { const query = input.value.toLowerCase(); list.replaceChildren(...sources.filter(t => `${t.title} ${t.body}`.toLowerCase().includes(query)).map(t => { const item = el('details','history-source'); item.append(el('summary','',`${t.occurredAt.slice(0,10)} · ${t.title}`),el('p','',t.body),el('small','',`Source: ${t.id}`)); return item; })); };
  content.replaceChildren(el('p','muted',`${sources.length} dated synthetic sources. New explicit decisions supersede old estimates; the buying sequence remains evidence-backed.`),input,list); input.addEventListener('input',render); render(); $('inspector').showModal();
}
document.querySelectorAll('[data-usecase]').forEach(b => b.addEventListener('click', () => selectUsecase(b.dataset.usecase)));
$('workflow-scenario').addEventListener('change', () => selectUsecase('workflows'));
$('evidence-button').addEventListener('click',openEvidence);
$('history-button').addEventListener('click',openHistory);
$('settings-button').addEventListener('click',() => $('settings').showModal());
$('refine-button').addEventListener('click',() => $('refinement').showModal());
$('failure-button').addEventListener('click', () => { state.candidateReplay = 'missed_context'; state.guidance = ''; runComparison(); });
$('passing-replay-button').addEventListener('click', () => { state.candidateReplay = 'complete'; state.guidance = ''; $('refinement').close(); runComparison(); });
$('checklist-button').addEventListener('click', () => { if (state.usecase !== 'workflows') { $('candidate-guidance').value = state.usecase === 'extraction' ? 'Apply explicit corrections before extracting dates. Include only scheduled events, preserve missing times as null, and cite an exact sentence from the source. Return only the required bare JSON schema.' : 'Distinguish urgent billing from routine billing. Include every input identifier exactly once and use only the allowed category labels. Return bare JSON without fences, prose or extra fields.'; return; } $('candidate-guidance').value = 'Review dated history before writing. Distinguish confirmed customer decisions from estimates. Verify the current buying team, preserve the order of approval steps, and check existing tasks before creating another. Finish with only actions the tools confirmed and a concise follow-up for human approval.'; });
$('refine-run-button').addEventListener('click', () => { state.guidance = $('candidate-guidance').value.trim(); $('refinement').close(); runComparison(); });
$('run-button').addEventListener('click',runComparison);
$('execution-mode').addEventListener('change', () => { if ($('execution-mode').value === 'live') state.candidateReplay = 'complete'; renderControls(); renderModelContext(); });
$('settings').addEventListener('close', () => { saveRouteConfig(); renderModelContext(); });
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('[data-route]').forEach(b => b.addEventListener('click', () => selectRoute(b.dataset.route)));
document.querySelectorAll('[data-output]').forEach(b => b.addEventListener('click', () => { state.output = b.dataset.output; state.editing = false; renderOutput(); }));
document.querySelectorAll('[data-scenario]').forEach(b => b.addEventListener('click', async () => { state.meetingId = b.dataset.scenario; state.route = 'baseline'; state.output = 'overview'; state.editing = false; state.guidance = ''; state.candidateReplay = 'complete'; $('candidate-guidance').value = ''; await refresh().catch(report); }));
for (const id of ['task-volume','sample-baseline','sample-candidate']) $(id).addEventListener('input',() => { saveRouteConfig(); renderStudio(); });
async function init() {
  await refresh(); const config = state.data.config; $('baseline-model').value = config.model; $('candidate-model').value = config.liveReady ? '' : 'fixture-candidate';
  $('execution-mode').querySelector('[value=live]').disabled = !config.liveReady;
  $('provider-status').textContent = config.liveReady ? `${config.provider} is configured. Use models approved and available through that provider. At most ${config.maxModelCalls} calls per route; no automatic retries.` : 'Live models are not configured. The demo uses scripted replies through the same SDK, tools and database checks.';
  showView('workspace');
  await selectUsecase('extraction');
  state.configInitialized = true; state.initializing = false;
  renderControls();
}
init().catch(report);
