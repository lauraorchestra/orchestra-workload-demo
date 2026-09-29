"use strict";

const $ = (id) => document.getElementById(id);
const list = (value) => Array.isArray(value) ? value : [];
const terminal = (status) => Boolean(status) && !["running", "pending", "queued", "starting"].includes(status);
const state = { data: null, accountId: null, dealId: null, meetingId: null, mode: "offline", run: null, busy: false, polling: null, runRequest: 0, loadingRunId: null };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function textValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function titleCase(value) { return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function initials(value) { return String(value || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function date(value, withTime = false) {
  if (!value) return "Date unavailable";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}
function time(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function amount(value) { return Number.isFinite(value) ? currency.format(value) : "—"; }
function errorMessage(error) { return typeof error === "string" ? error : error?.message || error?.error || textValue(error); }
function setError(id, value) { const node = $(id); node.textContent = value ? errorMessage(value) : ""; node.hidden = !value; }
function statusPill(status) {
  const safeStatus = ["running", "pending", "completed", "success", "succeeded", "failed", "error", "cancelled"].includes(status) ? status : "idle";
  return element("span", `status-pill status-${safeStatus}`, status === "succeeded" ? "Completed" : titleCase(status || "Ready"));
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, headers: { "Content-Type": "application/json", ...options.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(body?.error || body?.message || `Request failed (${response.status}).`));
    if (!body) throw new Error("The local server returned an unreadable response.");
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The local server did not respond in time. The run may still be active; refresh to reconnect.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function getAccount() { return list(state.data?.accounts).find((account) => account.id === state.accountId); }
function getMeeting() { return list(state.data?.meetings).find((meeting) => meeting.id === state.meetingId); }
function accountForMeeting(meeting) {
  if (!meeting) return null;
  const accounts = list(state.data?.accounts);
  if (meeting.accountId) return accounts.find((account) => account.id === meeting.accountId) || null;
  const hint = String(meeting.accountHint || "").toLowerCase();
  const matching = accounts.filter((account) => account.id === meeting.accountHint || (hint && String(account.name).toLowerCase() === hint));
  return matching.length === 1 ? matching[0] : null;
}

function renderAccounts() {
  const accounts = list(state.data?.accounts);
  $("account-count").textContent = accounts.length;
  const nodes = accounts.map((account) => {
    const button = element("button", `account-button${account.id === state.accountId ? " active" : ""}`);
    button.type = "button";
    button.setAttribute("aria-current", account.id === state.accountId ? "true" : "false");
    button.append(element("span", "account-mini-avatar", initials(account.name)), element("span", "", account.name || "Unnamed account"));
    button.addEventListener("click", () => {
      state.accountId = account.id;
      state.dealId = null;
      const matchingMeeting = list(state.data?.meetings).find((meeting) => accountForMeeting(meeting)?.id === account.id);
      state.meetingId = matchingMeeting?.id || null;
      renderWorkspace();
    });
    return button;
  });
  $("account-list").replaceChildren(...(nodes.length ? nodes : [element("p", "sidebar-placeholder", "No accounts available.")]));
  const account = getAccount();
  $("account-title").textContent = account?.name || "Your account workspace";
  $("account-avatar").textContent = initials(account?.name);
  $("account-description").textContent = [account?.industry, account?.website || account?.domain].filter(Boolean).join(" · ") || "Invented account · Local synthetic records";
  const deals = list(state.data?.deals).filter((deal) => deal.accountId === state.accountId);
  const openDeals = deals.filter((deal) => !["won", "lost"].includes(deal.stage));
  const stats = [[amount(openDeals.reduce((sum, deal) => sum + (Number.isFinite(deal.amount) ? deal.amount : 0), 0)), "Open pipeline"], [String(deals.length).padStart(2, "0"), deals.length === 1 ? "Deal" : "Deals"]];
  $("account-stats").replaceChildren(...stats.map(([value, label]) => { const node = element("div", "account-stat"); node.append(element("strong", "", value), element("span", "", label)); return node; }));
}

function renderDeals() {
  const deals = list(state.data?.deals).filter((deal) => deal.accountId === state.accountId);
  if (!deals.some((deal) => deal.id === state.dealId)) state.dealId = deals[0]?.id || null;
  $("deals-count").textContent = deals.length;
  const nodes = deals.map((deal) => {
    const button = element("button", `deal-button${deal.id === state.dealId ? " active" : ""}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(deal.id === state.dealId));
    const content = element("span", "deal-button-content");
    content.append(element("span", "deal-button-name", deal.name || "Untitled deal"), element("span", "deal-button-meta", `${amount(deal.amount)} · Closes ${date(deal.closeDate)}`));
    const safeStage = ["won", "lost", "negotiation"].includes(deal.stage) ? deal.stage : "default";
    button.append(element("span", "deal-dot"), content, element("span", `stage-pill stage-${safeStage}`, deal.stage || "Unknown stage"));
    button.addEventListener("click", () => { state.dealId = deal.id; renderDeals(); });
    return button;
  });
  $("deal-list").replaceChildren(...(nodes.length ? nodes : [element("p", "empty-state", "No deals for this account.")]));
  const selected = deals.find((deal) => deal.id === state.dealId);
  const detail = $("deal-detail");
  detail.hidden = !selected;
  detail.replaceChildren();
  if (!selected) return;
  const champion = list(state.data?.contacts).find((contact) => contact.id === selected.championContactId);
  for (const [label, value] of [["Next step", selected.nextStep || "No next step recorded"], ["Champion", champion?.name || (selected.championContactId ? "Contact unavailable" : "Not yet identified")]]) {
    const row = element("dl", "detail-row"); row.append(element("dt", "", label), element("dd", "", value)); detail.append(row);
  }
}

function renderMeetings() {
  const meetings = list(state.data?.meetings).filter((meeting) => accountForMeeting(meeting)?.id === state.accountId);
  if (!meetings.some((meeting) => meeting.id === state.meetingId)) state.meetingId = meetings[0]?.id || null;
  const select = $("meeting-select");
  select.replaceChildren(...meetings.map((meeting) => { const option = element("option", "", meeting.title || "Untitled meeting"); option.value = meeting.id; return option; }));
  if (!meetings.length) { const option = element("option", "", "No meetings for this account"); option.value = ""; select.append(option); }
  select.value = state.meetingId || "";
  select.disabled = !meetings.length || state.busy;
  const meeting = getMeeting();
  $("meeting-note").textContent = meeting?.note || "No meeting notes are available for this account. Select an account with a meeting to run follow-through.";
  $("meeting-meta").replaceChildren(...(meeting ? [element("span", "", date(meeting.occurredAt, true)), element("span", "", "·"), element("span", "", meeting.accountHint || getAccount()?.name || "Synthetic meeting")] : []));
}

function renderContacts() {
  const contacts = list(state.data?.contacts).filter((contact) => contact.accountId === state.accountId);
  $("contact-list").replaceChildren(...(contacts.length ? contacts.map((contact) => {
    const row = element("div", "contact-row");
    const info = element("div", "contact-info");
    info.append(element("strong", "", contact.name || "Unnamed contact"), element("small", "", contact.email || "No email recorded"));
    row.append(element("span", "person-avatar", initials(contact.name)), info, element("span", "contact-role", contact.role || "Contact"));
    return row;
  }) : [element("p", "empty-state", "No contacts for this account.")]));
}

function budgetLabel(config) {
  const budget = config.budget || config.limits || {};
  const values = [];
  const maxCalls = config.maxModelCalls ?? config.maxLlmCalls ?? config.maxCalls ?? config.maxRequests ?? budget.maxModelCalls ?? budget.maxLlmCalls ?? budget.maxCalls ?? budget.maxRequests;
  const maxTools = config.maxToolCalls ?? budget.maxToolCalls;
  const maxTokens = config.maxOutputTokens ?? budget.maxOutputTokens;
  if (maxCalls !== undefined) values.push(`${maxCalls} model calls`);
  if (maxTools !== undefined) values.push(`${maxTools} tool calls`);
  if (maxTokens !== undefined) values.push(`${maxTokens} output tokens / call`);
  if (values.length) return values.join(" · ");
  return typeof config.budget === "number" ? `${config.budget} requests` : "Bounded by runner · limits not exposed";
}

function renderControls() {
  const config = state.data?.config || {};
  $("agent-goal").textContent = state.data?.agent?.goal || "Current agent goal is unavailable. Saved runs retain the exact request in Run explorer.";
  $("agent-system-prompt").textContent = state.data?.agent?.systemPrompt || "Current system prompt is unavailable. Saved runs retain the exact request in Run explorer.";
  const active = state.run && !terminal(state.run.status);
  state.busy = Boolean(active || state.loadingRunId);
  document.querySelectorAll('input[name="mode"]').forEach((input) => { input.checked = input.value === state.mode; input.disabled = state.busy; });
  $("model-value").textContent = state.mode === "offline" ? "Fixture responses · no LLM requests" : config.model || "No model configured";
  $("budget-value").textContent = state.mode === "offline" ? "0 live model calls" : budgetLabel(config);
  $("live-readiness").textContent = config.liveReady ? `Live configuration is ready. Configured model: ${config.model || "unspecified"}. ${config.provider === "openai" ? "Requests go directly to OpenAI." : "Requests use the configured Orchestra gateway."}` : "Real-model mode is unavailable until the local server has verified live configuration.";
  $("mode-explanation").textContent = state.mode === "offline" ? "Offline mode exercises transport using fixture responses. It does not prove live model behavior." : "The model chooses its next step using one shared conversation. Tools validate local writes; a completed run is not a correctness score. Every request and tool result is journaled.";
  $("run-button").disabled = !state.data || !state.meetingId || accountForMeeting(getMeeting())?.id !== state.accountId || state.busy || (state.mode === "live" && !config.liveReady);
  $("run-button-label").textContent = state.busy ? "Follow-through is running…" : state.mode === "live" ? "Run with real model" : "Run fixture follow-through";
  $("reset-button").disabled = state.busy || !state.data;
  $("meeting-select").disabled = state.busy || !list(state.data?.meetings).length;
  const status = statusPill(state.run?.status || "idle"); status.id = "run-status"; status.setAttribute("aria-live", "polite"); if (!state.run) status.textContent = "Ready";
  $("run-status").replaceWith(status);
}

function eventDescription(event) {
  const data = event.data;
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const message = data.message || data.error?.message || (typeof data.error === "string" ? data.error : null) || data.summary;
  if (message) return typeof message === "string" ? message : textValue(message);
  const tool = data.name || data.toolName || data.tool;
  if (tool) return typeof tool === "string" ? tool : textValue(tool);
  if (data.model) return String(data.model);
  if (data.changes && typeof data.changes === "object") return `Updated ${Object.keys(data.changes).map(titleCase).join(", ")}`;
  return "";
}

function renderTimeline() {
  if (!state.run) return;
  const run = state.run;
  const events = list(run.events);
  $("event-count").textContent = `${events.length} ${events.length === 1 ? "EVENT" : "EVENTS"}`;
  $("run-metadata").hidden = false;
  $("run-metadata").replaceChildren(element("span", "", `${run.mode === "live" ? "Real model" : "Fixture / offline"} · ${date(run.startedAt, true)}`), element("span", "", run.finishedAt ? `Finished ${time(run.finishedAt)}` : "Following the execution journal…"));
  const debugLink = element("a", "run-debug-link", "Explore prompts, responses and tools →");
  debugLink.href = `/debug?run=${encodeURIComponent(run.id)}`;
  $("run-metadata").append(debugLink);
  const timeline = $("timeline");
  const wasAtBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 60;
  const openDetails = new Set(Array.from(timeline.querySelectorAll("details[open]")).map((node) => node.dataset.eventId));
  const nodes = events.map((event, index) => {
    const kind = String(event.type || "event");
    const style = /error|fail/i.test(kind) || event.data?.error ? "event-error" : /mutation|updated|created|write/i.test(kind) ? "event-mutation" : "";
    const item = element("article", `timeline-item ${style}`);
    const heading = element("div", "timeline-event-heading");
    heading.append(element("strong", "", titleCase(kind)), element("time", "", time(event.at)));
    item.append(element("span", "timeline-marker"), heading);
    if (event.stage) item.append(element("p", "timeline-stage", event.stage));
    const description = eventDescription(event);
    if (description) item.append(element("p", "timeline-description", description.length > 250 ? `${description.slice(0, 247)}…` : description));
    if (event.data !== undefined && event.data !== null) {
      const details = element("details", "event-details"); details.dataset.eventId = String(event.id ?? index); details.open = openDetails.has(details.dataset.eventId);
      details.append(element("summary", "", "Inspect event"), element("pre", "", textValue(event.data)));
      item.append(details);
    }
    return item;
  });
  timeline.replaceChildren(...(nodes.length ? nodes : [element("p", "empty-state", terminal(run.status) ? "This run has no journaled events." : "Run started. Waiting for the first event…")]));
  if (wasAtBottom && !terminal(run.status)) timeline.scrollTop = timeline.scrollHeight;
  setError("run-error", run.error);
  renderOutcome();
  renderControls();
}

function fieldLabel(key) { return ({ stage: "Stage", amount: "Deal amount", closeDate: "Close date", nextStep: "Next step", championContactId: "Champion", notes: "Notes", name: "Deal name" })[key] || titleCase(key.replace(/([a-z])([A-Z])/g, "$1 $2")); }
function fieldValue(key, value, snapshot) {
  if (key === "amount") return amount(value);
  if (key === "closeDate") return value ? date(value) : "—";
  if (key === "championContactId") return list(snapshot?.contacts).find((contact) => contact.id === value)?.name || textValue(value);
  if (key === "stage") return value ? titleCase(value) : "—";
  return textValue(value);
}

function renderOutcome() {
  const run = state.run;
  $("outcome-card").hidden = !run || !terminal(run.status);
  if (!run || !terminal(run.status)) return;
  $("outcome-mode").textContent = run.mode === "live" ? "REAL MODEL RUN" : "FIXTURE RESULTS · NOT LIVE PROOF";
  const summary = typeof run.summary === "string" ? run.summary : run.summary?.message || run.summary?.summary || run.summary?.text || "";
  $("run-summary").textContent = summary;
  $("run-summary").hidden = !summary;
  $("outcome-explanation").textContent = run.status === "succeeded" ? "Completed means the agent loop ended. Review its response and the saved changes; no change or a request for clarification can be a valid outcome." : "The run stopped before completing. Earlier local writes can still be present; inspect the recorded changes and error.";
  if (!run.before || !run.after) {
    $("deal-changes").replaceChildren();
    $("created-tasks").replaceChildren();
    $("no-changes").hidden = false;
    $("no-changes").textContent = "Final database snapshots are unavailable for this run; changes cannot be verified here.";
    return;
  }
  const beforeDeals = list(run.before?.deals);
  const afterDeals = list(run.after?.deals);
  const groups = [];
  let totalChanges = 0;
  for (const deal of afterDeals) {
    const previous = beforeDeals.find((item) => item.id === deal.id);
    const keys = [...new Set([...Object.keys(previous || {}), ...Object.keys(deal)])].filter((key) => !["id", "accountId", "version", "createdAt", "updatedAt"].includes(key) && JSON.stringify(previous?.[key]) !== JSON.stringify(deal[key]));
    if (!keys.length) continue;
    totalChanges += keys.length;
    const group = element("div", "change-group");
    group.append(element("h3", "", `${deal.name || "Deal"} · ${keys.length} ${keys.length === 1 ? "field updated" : "fields updated"}`));
    const table = element("table", "change-table");
    const head = element("thead"); const heading = element("tr");
    for (const title of ["Field", "Before", "After"]) { const cell = element("th", "", title); cell.scope = "col"; heading.append(cell); }
    head.append(heading); const body = element("tbody");
    for (const key of keys) { const row = element("tr"); row.append(element("td", "", fieldLabel(key)), element("td", "", fieldValue(key, previous?.[key], run.before)), element("td", "", fieldValue(key, deal[key], run.after))); body.append(row); }
    table.append(head, body); group.append(table); groups.push(group);
  }
  $("deal-changes").replaceChildren(...groups);
  const beforeTaskIds = new Set(list(run.before?.tasks).map((task) => task.id));
  const tasks = list(run.after?.tasks).filter((task) => !beforeTaskIds.has(task.id));
  $("created-tasks").replaceChildren();
  if (tasks.length) {
    const group = element("div", "task-group");
    group.append(element("h3", "", `${tasks.length} ${tasks.length === 1 ? "follow-up task created" : "follow-up tasks created"}`));
    const grid = element("div", "task-grid");
    for (const task of tasks) {
      const card = element("article", "task-item"); const content = element("div");
      content.append(element("strong", "", task.title || "Follow-up task"));
      if (task.body || task.description) content.append(element("p", "", task.body || task.description));
      const deal = afterDeals.find((item) => item.id === task.dealId);
      content.append(element("small", "", [`Due ${date(task.dueDate)}`, deal?.name, task.status && titleCase(task.status)].filter(Boolean).join(" · ")));
      card.append(element("span", "task-check"), content); grid.append(card);
    }
    group.append(grid); $("created-tasks").append(group);
  }
  $("no-changes").hidden = totalChanges > 0 || tasks.length > 0;
  $("no-changes").textContent = "No deal field changes or new tasks were recorded. Read the response to understand whether no action was needed, clarification was required, or the agent could not finish.";
}

function renderHistory() {
  const runs = list(state.data?.runs);
  $("history-list").replaceChildren(...(runs.length ? runs.map((run) => {
    const button = element("button", `history-button${run.id === state.run?.id ? " active" : ""}`); button.type = "button";
    button.disabled = state.busy && run.id !== state.run?.id;
    const meeting = list(state.data?.meetings).find((item) => item.id === run.meetingId);
    button.append(element("span", "history-meeting", meeting?.title || "Meeting follow-through"), element("span", "history-mode", run.mode === "live" ? "REAL MODEL" : "FIXTURE"), element("span", "history-time", date(run.startedAt, true)), statusPill(run.status));
    button.addEventListener("click", () => { loadRun(run.id).catch((error) => setError("run-error", error)); });
    return button;
  }) : [element("p", "history-empty", "No runs yet. Your next run starts the story.")]));
}

function renderWorkspace() { renderAccounts(); renderDeals(); renderMeetings(); renderContacts(); renderControls(); renderHistory(); }

async function refreshState({ initial = false } = {}) {
  const data = await api("/api/state");
  state.data = data;
  if (!list(data.accounts).some((account) => account.id === state.accountId)) state.accountId = list(data.accounts)[0]?.id || null;
  if (!list(data.meetings).some((meeting) => meeting.id === state.meetingId)) state.meetingId = list(data.meetings)[0]?.id || null;
  if (initial) { state.mode = data.config?.mode === "live" && data.config?.liveReady ? "live" : "offline"; state.accountId = accountForMeeting(getMeeting())?.id || state.accountId; }
  $("connection-status").textContent = "Connected locally";
  setError("page-error", null);
  renderWorkspace();
  if (initial) {
    const running = list(data.runs).find((run) => !terminal(run.status));
    if (running) await loadRun(running.id);
  }
}

function scheduleRunPoll(id, delay = document.hidden ? 3000 : 1250) {
  clearTimeout(state.polling);
  state.polling = setTimeout(async () => {
    if (state.run?.id !== id || terminal(state.run.status)) return;
    try { await loadRun(id); }
    catch (error) {
      if (state.run?.id !== id) return;
      setError("run-error", `Unable to read run progress: ${errorMessage(error)} The runner may still be working. Reconnecting…`);
      $("connection-status").textContent = "Reconnecting to run…";
      scheduleRunPoll(id, 4000);
    }
  }, delay);
}

async function loadRun(id) {
  clearTimeout(state.polling);
  const request = ++state.runRequest;
  const run = await api(`/api/runs/${encodeURIComponent(id)}`);
  if (request !== state.runRequest) return;
  state.run = run;
  state.mode = run.mode === "live" ? "live" : "offline";
  $("connection-status").textContent = "Connected locally";
  renderTimeline(); renderHistory();
  if (terminal(run.status)) {
    await refreshState();
  } else {
    scheduleRunPoll(id);
  }
}

$("meeting-select").addEventListener("change", (event) => {
  state.meetingId = event.target.value;
  const account = accountForMeeting(getMeeting());
  if (account) { state.accountId = account.id; state.dealId = null; }
  renderWorkspace();
});

document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener("change", () => { state.mode = input.value; renderControls(); }));

$("run-button").addEventListener("click", async () => {
  if (state.busy || !state.meetingId || accountForMeeting(getMeeting())?.id !== state.accountId) return;
  state.loadingRunId = "starting";
  state.run = null;
  setError("run-error", null);
  $("outcome-card").hidden = true;
  $("timeline").replaceChildren(element("p", "empty-state", "Starting the follow-through agent…"));
  renderControls(); renderHistory();
  try {
    const result = await api("/api/runs", { method: "POST", body: JSON.stringify({ meetingId: state.meetingId, mode: state.mode }) });
    if (!result.id) throw new Error("The server started no identifiable run.");
    state.loadingRunId = result.id;
    await loadRun(result.id);
  } catch (error) {
    setError("run-error", error);
    $("timeline").replaceChildren(element("p", "empty-state", "The run could not be started or read. See the error above."));
    await refreshState({ initial: true }).catch(() => {});
  } finally { state.loadingRunId = null; renderControls(); renderHistory(); }
});

$("reset-button").addEventListener("click", async () => {
  if (state.busy) return;
  if (!window.confirm("Reset the invented CRM records and clear all local run history?")) return;
  state.loadingRunId = "resetting"; renderControls();
  try {
    await api("/api/reset", { method: "POST", body: "{}" });
    clearTimeout(state.polling); state.runRequest += 1; state.run = null; state.accountId = null; state.dealId = null; state.meetingId = null;
    $("outcome-card").hidden = true; $("run-metadata").hidden = true; $("event-count").textContent = "TOOL TIMELINE";
    $("timeline").replaceChildren(element("p", "empty-state", "Synthetic records restored. Choose a meeting and start a fresh run."));
    setError("run-error", null); await refreshState();
  } catch (error) { setError("page-error", error); }
  finally { state.loadingRunId = null; renderControls(); }
});

refreshState({ initial: true }).catch((error) => {
  setError("page-error", `Could not load the local CRM: ${errorMessage(error)} Reload this page after the local server is available.`);
  $("account-title").textContent = "Workspace is unavailable";
  $("account-description").textContent = "The page is ready, but the local CRM API could not be reached.";
  $("account-list").replaceChildren(element("p", "sidebar-placeholder", "Unable to load accounts."));
  $("deal-list").replaceChildren(element("p", "empty-state", "Deal records are unavailable."));
  $("contact-list").replaceChildren(element("p", "empty-state", "Contact records are unavailable."));
  $("meeting-note").textContent = "Meeting notes will appear when the local API is available.";
  $("connection-status").textContent = "Disconnected";
  renderControls();
});
