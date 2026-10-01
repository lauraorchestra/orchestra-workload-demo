"use strict";

const $ = id => document.getElementById(id);
const array = value => Array.isArray(value) ? value : [];
const activeRun = run => ["running", "pending", "queued", "starting"].includes(run?.status);
const state = { runs: [], nextOffset: 0, hasMore: false, meetings: [], selectedId: null, run: null, items: [], itemKey: null, stage: null, request: 0, timer: null, loading: false };
const knownStages = [
  { id: "meetingFollowThrough", title: "Meeting follow-through agent", description: "One shared conversation. The model chooses which CRM tools to call and when it has enough information to respond." },
  { id: "extractMeetingFacts", title: "Extract meeting facts", description: "Read the notes and identify facts, decisions, and uncertainties." },
  { id: "reconcileDeal", title: "Reconcile the deal", description: "Find the right records and coordinate the CRM tool loop." },
  { id: "assessDealReadiness", title: "Assess deal readiness", description: "Check the proposed sales stage before saving the deal." },
  { id: "draftFollowUp", title: "Draft a follow-up", description: "Write the task for the main agent to save in the CRM." },
];
const stageNames = Object.fromEntries(knownStages.map(stage => [stage.id, stage.title]));
const toolDescriptions = {
  create_follow_up_draft: "Save a prospect follow-up awaiting salesperson approval. This tool cannot approve or send it.",
  search_accounts: "Search the local CRM for candidate accounts. A similar name may belong to a different company.",
  get_account: "Read an account and its contacts to verify the company and people involved.",
  list_deals: "Read the account’s deals to identify the opportunity discussed in the meeting.",
  list_tasks: "Read the deal’s existing tasks before deciding whether another follow-up is needed. An existing task should not be duplicated.",
  get_deal: "Read the deal’s current fields and version before proposing a change.",
  get_timeline: "Read dated account history and its evidence references.",
  get_field_definitions: "Read which CRM fields can be changed and which values they accept.",
  assess_deal_readiness: "This historical tool ran a separate model analysis. It read the deal and history, then asked which sales stage the evidence supported. Its recorded nested steps appear separately in the timeline. New runs use one agent conversation instead.",
  draft_follow_up: "This historical tool read the updated deal and history, then asked a separate model call to draft a task. The draft itself did not save a task or send anything. New runs let the main agent draft tasks directly.",
  update_deal: "Save a change to the local deal. The application validates the allowed fields, record version, account scope and supporting evidence references. The model is responsible for deciding whether the change is justified.",
  create_follow_up_task: "Save a follow-up task in the local CRM. This does not send email or contact anyone.",
};
function node(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = String(text);
  return value;
}
function valueText(value) {
  if (value === undefined) return "Not recorded";
  if (value === null) return "null";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function prettyName(value) { return String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, char => char.toUpperCase()); }
function date(value) { const result = new Date(value); return Number.isNaN(result.getTime()) ? value || "Time not recorded" : result.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }); }
function duration(ms) { return Number.isFinite(ms) && ms >= 0 ? ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s` : "Not recorded"; }
function status(statusValue) {
  const known = ["succeeded", "failed", "cancelled", "running", "pending", "queued"].includes(statusValue) ? statusValue : "unknown";
  return node("span", `status status-${known}`, statusValue === "succeeded" ? "Completed" : prettyName(statusValue || "Unknown"));
}
function setNotice(id, message) { $(id).textContent = message || ""; $(id).hidden = !message; }
function missing(text) { return node("p", "missing", text); }
function metadata(entries) {
  const block = node("dl", "metadata");
  for (const [name, value] of entries) { const row = node("div"); row.append(node("dt", "", name), node("dd", "", valueText(value))); block.append(row); }
  return block;
}
function jsonBlock(value) {
  const block = node("div", "json-box");
  const text = valueText(value);
  const copy = node("button", "copy-button", "Copy"); copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }
    catch { copy.textContent = "Select text to copy"; }
    setTimeout(() => { copy.textContent = "Copy"; }, 1800);
  });
  block.append(node("pre", "", text), copy);
  return block;
}
function details(label, content, key) {
  const block = node("details", "subdetails");
  if (key) block.dataset.key = key;
  block.append(node("summary", "", label), content);
  return block;
}
async function api(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.error || `Local server returned ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The local server did not respond. Your saved history has not been changed.");
    throw error;
  } finally { clearTimeout(timer); }
}
function runContext(run) { return array(run?.events).find(event => event.type === "run_context")?.data; }
function meetingTitle(run) {
  return runContext(run)?.meeting?.title || run?.meetingTitle || state.meetings.find(meeting => meeting.id === run?.meetingId)?.title || "Meeting follow-through";
}
function renderRuns() {
  const rows = state.runs.map(run => {
    const button = node("button", `run-item${run.id === state.selectedId ? " active" : ""}`);
    button.type = "button"; button.setAttribute("aria-current", run.id === state.selectedId ? "true" : "false");
    const top = node("span", "run-item-top"); top.append(status(run.status), node("span", "run-mode", run.mode === "offline" ? "Fixture" : "Real model"));
    button.append(top, node("strong", "", meetingTitle(run)), node("small", "", date(run.startedAt)));
    button.addEventListener("click", () => selectRun(run.id));
    return button;
  });
  $("run-list").replaceChildren(...rows);
  $("history-status").textContent = `${state.runs.length} saved ${state.runs.length === 1 ? "run" : "runs"} loaded${state.hasMore ? " · More available" : " · End of history"}`;
  $("load-older").hidden = !state.hasMore;
}
async function loadRuns(reset = false) {
  const offset = reset ? 0 : state.nextOffset;
  const page = await api(`/api/runs?limit=50&offset=${offset}`);
  const runs = array(page.runs);
  if (reset) state.runs = runs;
  else {
    const seen = new Set(state.runs.map(run => run.id));
    state.runs.push(...runs.filter(run => !seen.has(run.id)));
  }
  state.nextOffset = page.nextOffset;
  state.hasMore = Boolean(page.hasMore && page.nextOffset !== null);
  renderRuns();
}
function normalizeStage(value) { return ({ assess_deal_readiness: "assessDealReadiness", draft_follow_up: "draftFollowUp" })[value] || value; }
function makeItems(events) {
  const consumed = new Set();
  const items = events.flatMap((event, index) => {
    if (consumed.has(index)) return [];
    const data = event.data || {};
    let pairIndex = -1;
    if (event.type === "llm_request" && data.callIndex !== undefined) {
      pairIndex = events.findIndex((candidate, other) => other > index && !consumed.has(other) && candidate.type === "llm_response" && candidate.data?.callIndex === data.callIndex);
    } else if (event.type === "tool_call" && data.attemptId !== undefined) {
      pairIndex = events.findIndex((candidate, other) => other > index && !consumed.has(other) && candidate.type === "tool_result" && candidate.data?.attemptId === data.attemptId);
    }
    if (pairIndex >= 0) consumed.add(pairIndex);
    const pair = pairIndex >= 0 ? events[pairIndex] : null;
    const kind = event.type.startsWith("llm_") ? "model" : event.type.startsWith("tool_") ? "tool" : event.type === "mutation" ? "mutation" : event.type === "error" ? "error" : "event";
    return [{ key: String(event.id ?? index), event, index, pair, pairIndex, kind, stage: normalizeStage(event.stage), failed: event.type === "error" || Boolean(data.error || pair?.data?.error) }];
  });
  return items.map((item, index) => ({ ...item, position: index + 1 }));
}
function itemTitle(item) {
  const data = item.event.data || {};
  if (item.event.type === "llm_request") return `${state.run.mode === "offline" ? "Fixture exchange" : "Model call"} ${data.callIndex ?? ""}`.trim();
  if (item.kind === "tool") return data.name || "Tool result";
  if (item.kind === "mutation") return `Saved ${prettyName(data.entityType || data.tool || "CRM change").toLowerCase()}`;
  return ({ facts: "Extracted meeting facts", run_context: "Starting context", workflow: "Application decision", error: "Error recorded", llm_response: "Model response" })[item.event.type] || prettyName(item.event.type);
}
function itemDescription(item) {
  const { event, pair } = item;
  if (event.type === "llm_request") return `${stageNames[item.stage] || prettyName(item.stage)} · ${pair ? "Response recorded" : activeRun(state.run) ? "Awaiting response" : "No response recorded"}`;
  if (event.type === "tool_call") return `${pair?.data?.error ? "Tool failed" : pair ? "Result recorded" : activeRun(state.run) ? "Awaiting result" : "No result recorded"}${pairIndexLabel(item)}`;
  if (event.type === "mutation") return "Actual local database write";
  if (event.type === "error") return "Open to inspect the recorded error";
  return stageNames[item.stage] || prettyName(item.stage || "Application");
}
function pairIndexLabel(item) { return item.pairIndex > item.index + 1 ? ` · finishes at event ${item.pairIndex + 1}` : ""; }
function renderStages() {
  // Display only model stages present in this run, including preserved legacy runs.
  const observed = [...new Set(state.items.filter(item => item.kind === "model").map(item => item.stage).filter(Boolean))];
  const stages = observed.map(id => knownStages.find(stage => stage.id === id) || { id, title: prettyName(id), description: "A model stage recorded by this version of the application." });
  if (state.stage && !observed.includes(state.stage)) state.stage = null;
  $("all-stages").classList.toggle("active", !state.stage);
  $("all-stages").setAttribute("aria-pressed", String(!state.stage));
  $("stage-list").classList.toggle("single-stage", stages.length === 1);
  $("stage-list").replaceChildren(...(stages.length ? stages.map((stage, index) => {
    const items = state.items.filter(item => item.stage === stage.id);
    const modelCount = items.filter(item => item.event.type === "llm_request").length;
    const button = node("button", `stage${state.stage === stage.id ? " active" : ""}`); button.type = "button";
    button.setAttribute("aria-pressed", String(state.stage === stage.id));
    button.append(node("span", "stage-number", stage.id === "meetingFollowThrough" ? "ONE AGENT · SHARED CONVERSATION" : `RECORDED STAGE ${index + 1}`), node("strong", "", stage.title), node("p", "", stage.description), node("span", "count", `${modelCount} model ${modelCount === 1 ? "call" : "calls"} · ${items.length} steps`));
    button.addEventListener("click", () => filterStage(state.stage === stage.id ? null : stage.id));
    return button;
  }) : [node("p", "empty-copy", "No model calls have been recorded yet.")]));
}
function filterStage(stage) { state.stage = stage; renderStages(); renderSteps(); renderDetail(); }
function renderSteps() {
  const items = state.items.filter(item => !state.stage || item.stage === state.stage);
  if (!items.some(item => item.key === state.itemKey)) state.itemKey = items.find(item => item.event.type === "llm_request")?.key || items[0]?.key || null;
  $("step-count").textContent = `${items.length} steps`;
  const scroll = $("step-list").scrollTop;
  $("step-list").replaceChildren(...(items.length ? items.map(item => {
    const button = node("button", `step kind-${item.kind}${item.failed ? " step-failed" : ""}${state.itemKey === item.key ? " active" : ""}`); button.type = "button";
    button.setAttribute("aria-pressed", String(state.itemKey === item.key));
    const content = node("span", "step-text");
    const heading = node("strong"); heading.append(node("span", "step-kind"), document.createTextNode(itemTitle(item)));
    content.append(heading, node("small", "", itemDescription(item)));
    button.append(node("span", "step-number", item.position), content);
    button.addEventListener("click", () => {
      state.itemKey = item.key; renderSteps(); renderDetail();
      if (window.matchMedia("(max-width: 900px)").matches) $("step-detail").scrollIntoView({ behavior: "auto", block: "start" });
    });
    return button;
  }) : [node("p", "empty-copy", "No steps recorded for this stage.")]));
  $("step-list").scrollTop = scroll;
}
function structuredContent(value) {
  if (Array.isArray(value)) {
    if (!value.length) return node("p", "plain-content", "[]");
    const list = node("ol", "context-list");
    for (const entry of value) { const item = node("li"); item.append(structuredContent(entry)); list.append(item); }
    return list;
  }
  if (value && typeof value === "object") {
    if (!Object.keys(value).length) return node("p", "plain-content", "{}");
    const fields = node("dl", "context-fields");
    for (const [key, entry] of Object.entries(value)) {
      const field = node("div");
      field.append(node("dt", "", prettyName(key)), node("dd"));
      field.lastChild.append(structuredContent(entry)); fields.append(field);
    }
    return fields;
  }
  return node("pre", "plain-content", valueText(value));
}
function messageContent(content, key) {
  let parsed;
  if (typeof content === "string") { try { parsed = JSON.parse(content); } catch { /* Ordinary text stays exact. */ } }
  if (!parsed || typeof parsed !== "object") return node("pre", "plain-content", valueText(content));
  const block = node("div");
  block.append(node("p", "context-format-label", "Formatted JSON for reading · original message text below"), structuredContent(parsed), details("Exact original message text", jsonBlock(content), key));
  return block;
}
function messageCard(message, index, source = "prompt") {
  const role = String(message?.role || "unknown");
  const card = node("article", `message message-role-${["system", "assistant", "tool", "user", "developer"].includes(role) ? role : "unknown"}`);
  const roleDescription = { system: "App instructions", developer: "App instructions", user: "Input supplied by the app", assistant: "Earlier model response", tool: "Result returned by the app" }[role] || "Recorded message";
  card.append(node("div", "message-heading", `${index + 1}. ${prettyName(role)} · ${roleDescription}`));
  const body = node("div", "message-body");
  if (message.tool_call_id) body.append(node("p", "", `Responding to tool call: ${message.tool_call_id}`));
  if (message.name) body.append(node("p", "", `Name: ${message.name}`));
  if (message.content !== null && message.content !== undefined && message.content !== "") body.append(messageContent(message.content, `${source}-${index}-original`));
  else body.append(node("p", "", message.tool_calls?.length ? "No text content; this message requests tools." : "No text content recorded."));
  if (message.refusal) { body.append(node("p", "", "Refusal"), node("pre", "plain-content", valueText(message.refusal))); }
  for (const tool of array(message.tool_calls)) body.append(toolRequest(tool));
  const extra = Object.fromEntries(Object.entries(message).filter(([key]) => !["role", "content", "tool_calls", "tool_call_id", "name", "refusal"].includes(key)));
  if (Object.keys(extra).length) body.append(details("Other recorded message fields", jsonBlock(extra)));
  card.append(body);
  return card;
}
function toolRequest(tool) {
  const block = node("div", "tool-block");
  block.append(node("h4", "", `Requested tool: ${tool.function?.name || tool.type || "Unnamed"}`));
  if (tool.id) block.append(node("p", "small muted", `Tool call ID: ${tool.id}`));
  block.append(jsonBlock(tool.function?.arguments ?? tool));
  return block;
}
function renderModelDetail(body, item) {
  const data = item.event.data || {};
  const responseData = item.pair?.data || (item.event.type === "llm_response" ? data : null);
  const request = data.request;
  body.append(node("p", "detail-explanation", state.run.mode === "offline" ? "This exchange uses a deterministic fixture response. It makes no inference request to a real model." : "The application sends the messages below to the model. The model returns text, requested tool calls, or both. Request messages include earlier tool results when continuing a conversation."));
  body.append(metadata([["Requested model", request?.model || data.model], ["Returned model", responseData?.effectiveModel || responseData?.response?.model], ["Provider", data.provider || runContext(state.run)?.provider], ["Time waiting for response", duration(responseData?.durationMs)], ["Finish reason", responseData?.finishReason], ["Provider request ID", responseData?.requestId]]));
  if (item.event.type === "llm_request") {
    if (Array.isArray(request?.messages)) {
      const prompt = node("div");
      prompt.append(node("p", "small muted", `${request.messages.length} messages, in the order sent. “User” is the application’s supplied context; it does not necessarily mean a person typed this text.`));
      request.messages.forEach((message, index) => prompt.append(messageCard(message, index)));
      const settings = Object.fromEntries(Object.entries(request).filter(([key]) => !["messages", "tools"].includes(key)));
      prompt.append(details("Model settings", jsonBlock(settings), "model-settings"));
      if (request.tools !== undefined) prompt.append(details(`Available tool definitions (${array(request.tools).length})`, jsonBlock(request.tools), "tool-definitions"));
      body.append(details(`Prompt · exact messages sent (${request.messages.length} messages)`, prompt, "full-prompt"));
    } else body.append(missing("The exact prompt was not recorded for this call. It cannot be recovered from the message count or today’s application code."));
  }
  body.append(node("h4", "", "Model response"));
  if (responseData?.response) {
    const response = responseData.response;
    if (array(response.choices).length) {
      for (const choice of response.choices) {
        if (choice.message) {
          const card = messageCard(choice.message, choice.index ?? 0, "response");
          card.querySelector(".message-heading").textContent = `Assistant · Returned response${response.choices.length > 1 ? ` (choice ${choice.index})` : ""}`;
          body.append(card);
        } else body.append(jsonBlock(choice));
      }
    } else body.append(jsonBlock(response));
  } else body.append(missing(responseData ? "Response metadata was recorded, but the exact response text and requested tools were not recorded for this older call." : activeRun(state.run) ? "No response has been recorded yet. This view updates while the selected run is active." : "No successful response was recorded for this call. Check the timeline’s error events for available failure details."));
  if (responseData?.usage) body.append(details("Token usage reported by the response", jsonBlock(responseData.usage), "token-usage"));
}
function renderToolDetail(body, item) {
  const data = item.event.data || {};
  const result = item.pair?.data || (item.event.type === "tool_result" ? data : null);
  body.append(node("p", "detail-explanation", toolDescriptions[data.name] || "A recorded application tool invocation. The arguments are what was requested; the result is what the application returned."));
  body.append(metadata([["Tool", data.name], ["Attempt ID", data.attemptId], ["Model’s tool call ID", data.toolCallId], ["Result event", item.pair ? `${item.pairIndex + 1} · ${date(item.pair.at)}` : result ? date(item.event.at) : activeRun(state.run) ? "Awaiting result" : "Not recorded"]]));
  if (item.event.type === "tool_call") {
    body.append(node("h4", "", "Arguments passed to the tool"));
    if (data.rawArguments !== undefined || data.arguments !== undefined) body.append(jsonBlock(data.rawArguments ?? data.arguments));
    else body.append(missing("Arguments were not recorded for this tool call."));
  }
  body.append(node("h4", "", result?.error ? "Tool error" : "Result returned by the tool"));
  if (result && (result.result !== undefined || result.error !== undefined)) body.append(jsonBlock(result.error ?? result.result));
  else body.append(missing(activeRun(state.run) ? "The tool has not returned a recorded result yet." : "No result was recorded for this tool call."));
}
function changeTable(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
  if (!keys.length) return node("p", "small muted", "No field differences between these recorded values.");
  const wrapper = node("div", "table-wrap"), table = node("table", "changes"), head = node("thead"), heading = node("tr"), body = node("tbody");
  ["Field", "Before", "After"].forEach(text => heading.append(node("th", "", text))); head.append(heading);
  for (const key of keys) { const row = node("tr"); row.append(node("td", "", prettyName(key)), node("td", "", before && Object.hasOwn(before, key) ? valueText(before[key]) : "Not present"), node("td", "", after && Object.hasOwn(after, key) ? valueText(after[key]) : "Not present")); body.append(row); }
  table.append(head, body); wrapper.append(table); return wrapper;
}
function renderDetail() {
  const item = state.items.find(entry => entry.key === state.itemKey);
  const root = $("step-detail");
  const oldKey = root.dataset.itemKey;
  const openKeys = new Set(Array.from(root.querySelectorAll("details[open][data-key]")).map(entry => entry.dataset.key));
  const scrollTop = root.querySelector(".detail-body")?.scrollTop || 0;
  root.replaceChildren(); root.dataset.itemKey = item?.key || "";
  if (!item) { root.append(node("p", "empty-copy", "Choose a timeline step to inspect its full recorded details.")); return; }
  const header = node("header", "detail-heading");
  header.append(node("p", "eyebrow", `${item.kind === "model" ? "MODEL EXCHANGE" : item.kind === "tool" ? "TOOL EXECUTION" : item.kind === "mutation" ? "PERSISTED CHANGE" : "APPLICATION EVENT"} · EVENT ${item.index + 1}${item.pair ? ` → ${item.pairIndex + 1}` : ""}`), node("h3", "", itemTitle(item)), node("p", "", `${stageNames[item.stage] || prettyName(item.stage)} · ${date(item.event.at)}`));
  const body = node("div", "detail-body");
  if (item.kind === "model") renderModelDetail(body, item);
  else if (item.kind === "tool") renderToolDetail(body, item);
  else if (item.kind === "mutation") {
    body.append(node("p", "detail-explanation", "This event records an actual local database write. It is separate from a model’s proposed change and may still exist even if the run later failed."));
    body.append(metadata([["Tool", item.event.data?.tool], ["Record type", item.event.data?.entityType], ["Record ID", item.event.data?.entityId]]));
    body.append(changeTable(item.event.data?.before, item.event.data?.after));
  } else {
    const explanations = { facts: "These are the facts parsed from the extraction model’s output and supplied to the main agent.", workflow: "This decision was made by application code, not generated by the model.", error: "This is the recorded error. Earlier database writes are not automatically undone; check the outcome snapshots above.", run_context: "The meeting and configuration recorded when this run started. This describes that run, not the current server settings." };
    if (explanations[item.event.type]) body.append(node("p", "detail-explanation", explanations[item.event.type]));
    body.append(jsonBlock(item.event.data));
  }
  body.append(details("Full recorded event JSON", jsonBlock(item.pair ? { started: item.event, finished: item.pair } : item.event), "raw-events"));
  root.append(header, body);
  if (oldKey === item.key) {
    root.querySelectorAll("details[data-key]").forEach(entry => { entry.open = openKeys.has(entry.dataset.key); });
    body.scrollTop = scrollTop;
  }
}
function renderOutcome() {
  const run = state.run, body = $("outcome-content"), context = runContext(run);
  const opened = new Set(Array.from(body.querySelectorAll("details[open][data-key]")).map(entry => entry.dataset.key));
  body.replaceChildren();
  if (run.summary) body.append(node("h4", "", "Final recorded response / summary"), node("p", "", valueText(run.summary)));
  else body.append(node("p", "muted", activeRun(run) ? "This run is still active. A final summary and final database snapshot are not available yet." : "No final summary was recorded."));
  if (run.status === "succeeded") body.append(node("p", "outcome-explanation", "Completed means the agent loop ended, not that an evaluator verified the answer. Review the response and changes below; making no changes or asking for clarification can be appropriate."));
  if (context?.meeting) body.append(details("Meeting input recorded at the start of this run", jsonBlock(context.meeting), "meeting-input"));
  else body.append(missing("A starting meeting snapshot was not recorded for this older run. Today’s meeting record is not substituted for historical input."));
  if (context) body.append(details("Recorded run configuration and limits", jsonBlock(Object.fromEntries(Object.entries(context).filter(([key]) => key !== "meeting"))), "run-config"));
  body.append(node("h4", "", "What changed in the database"));
  if (!run.before || !run.after) body.append(missing(activeRun(run) ? "The final snapshot is not recorded until the run finishes. Saved-change steps below show writes already recorded during this run." : "Before/after snapshots are unavailable; the final database changes cannot be compared for this run."));
  else {
    let changed = 0;
    const collections = [...new Set([...Object.keys(run.before), ...Object.keys(run.after)])];
    for (const collection of collections) {
      const before = run.before[collection], after = run.after[collection];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (!Array.isArray(before) || !Array.isArray(after)) {
        changed++; body.append(node("h4", "change-title", prettyName(collection)), changeTable({ value: before }, { value: after })); continue;
      }
      const old = new Map(before.map(entry => [entry.id, entry]));
      const next = new Map(after.map(entry => [entry.id, entry]));
      for (const id of new Set([...old.keys(), ...next.keys()])) {
        const previous = old.get(id), current = next.get(id);
        if (JSON.stringify(previous) === JSON.stringify(current)) continue;
        changed++;
        const label = current?.name || current?.title || previous?.name || previous?.title || id;
        body.append(node("h4", "change-title", `${prettyName(collection)} · ${label} · ${!previous ? "Created" : !current ? "Removed" : "Updated"}`), changeTable(previous, current));
      }
    }
    if (!changed) body.append(node("p", "muted", "The before and after snapshots contain no database changes. Read the final response to see whether nothing was needed, the evidence was ambiguous, or the agent could not complete the work."));
    body.append(details("Full database snapshots (before and after)", jsonBlock({ before: run.before, after: run.after }), "snapshots"));
  }
  body.querySelectorAll("details[data-key]").forEach(entry => { entry.open = opened.has(entry.dataset.key); });
}
function renderRun() {
  const run = state.run, events = array(run.events), context = runContext(run);
  $("empty-state").hidden = true; $("run-content").hidden = false;
  $("run-title").textContent = meetingTitle(run);
  $("run-meta").textContent = `${run.mode === "offline" ? "Offline fixture · No live inference" : "Real model run"} · Started ${date(run.startedAt)} · ${run.id}`;
  $("run-status").replaceChildren(status(run.status));
  setNotice("run-error", run.error ? `This run failed: ${valueText(run.error)}\nAny earlier saved changes may still be present. Inspect the outcome and timeline.` : null);
  const requests = events.filter(event => event.type === "llm_request");
  const responses = events.filter(event => event.type === "llm_response");
  const legacyStages = [...new Set([...requests, ...responses].map(event => normalizeStage(event.stage)))].filter(id => knownStages.some(stage => stage.id === id && id !== "meetingFollowThrough"));
  const guide = $("workflow-explanation");
  guide.replaceChildren();
  if (legacyStages.length) {
    guide.append(node("p", "notice info", "This saved run used the earlier application, which split work into separate model stages. Its original prompts, stage names and tool results are preserved. The current application uses one agent conversation; it does not rewrite this history."));
    const list = node("ul", "guide-stages");
    for (const id of legacyStages) { const stage = knownStages.find(entry => entry.id === id); const item = node("li"); item.append(node("strong", "", `${stage.title}. `), document.createTextNode(stage.description)); list.append(item); }
    guide.append(list);
  } else {
    guide.append(node("p", "", "The current app has one agent, one system prompt and one goal. It reads the meeting, uses the available CRM tools in an order it chooses, and keeps the results in one shared conversation. It can make zero or several updates and tasks; there is no required sequence of analysis stages."));
  }
  const missingRequests = requests.filter(event => !event.data?.request).length;
  const missingResponses = responses.filter(event => !event.data?.response).length;
  setNotice("recording-notice", missingRequests || missingResponses ? `This run has incomplete historical recording: ${missingRequests} exact ${missingRequests === 1 ? "prompt" : "prompts"} and ${missingResponses} exact ${missingResponses === 1 ? "response" : "responses"} were not saved. The timeline and tool results remain available. Missing content is not reconstructed; new runs record full exchanges.` : !requests.length && !context ? "This run predates full exchange recording. Any unavailable prompts or model responses are explicitly marked below." : null);
  const calls = requests.length, tools = events.filter(event => event.type === "tool_call").length, writes = events.filter(event => event.type === "mutation").length;
  const elapsed = run.finishedAt ? duration(new Date(run.finishedAt) - new Date(run.startedAt)) : activeRun(run) ? "In progress" : "Unavailable";
  $("run-stats").replaceChildren(...[[calls, run.mode === "offline" ? "Fixture model exchanges" : "Model requests"], [tools, "Tool calls"], [writes, "Saved database changes"], [elapsed, "Run duration"]].map(([value, label]) => { const block = node("div", "stat"); block.append(node("strong", "", value), node("span", "", label)); return block; }));
  state.items = makeItems(events);
  renderOutcome(); renderStages(); renderSteps(); renderDetail();
  $("connection-status").textContent = activeRun(run) ? "Following this run live · Updates every 2.5 seconds" : "Saved run · Refresh to fetch newer runs";
}
function stopPolling() { clearTimeout(state.timer); state.timer = null; }
function schedulePoll() {
  stopPolling();
  if (!activeRun(state.run)) return;
  const id = state.selectedId, request = state.request;
  state.timer = setTimeout(async () => {
    try {
      const run = await api(`/api/runs/${encodeURIComponent(id)}`);
      if (id !== state.selectedId || request !== state.request) return;
      const changed = JSON.stringify(run) !== JSON.stringify(state.run);
      state.run = run;
      const summary = state.runs.find(entry => entry.id === run.id); if (summary) Object.assign(summary, { status: run.status, finishedAt: run.finishedAt });
      if (changed) { renderRun(); renderRuns(); }
      setNotice("page-error", null);
    } catch (error) { if (id === state.selectedId && request === state.request) setNotice("page-error", `Could not refresh this run: ${error.message}`); }
    if (id === state.selectedId && request === state.request) schedulePoll();
  }, 2500);
}
async function selectRun(id, { preserve = false } = {}) {
  stopPolling();
  const request = ++state.request;
  state.selectedId = id;
  if (!preserve) {
    state.run = null; state.stage = null; state.itemKey = null;
    $("run-content").hidden = true; $("empty-state").hidden = false;
    $("empty-state").replaceChildren(node("h2", "", "Opening saved run…"));
    $("outcome-content").replaceChildren();
  }
  const url = new URL(window.location.href); url.searchParams.set("run", id); history.replaceState(null, "", url);
  renderRuns(); setNotice("page-error", null);
  try {
    const run = await api(`/api/runs/${encodeURIComponent(id)}`);
    if (request !== state.request) return;
    state.run = run; renderRun(); schedulePoll();
  } catch (error) {
    if (request !== state.request) return;
    setNotice("page-error", `Could not open this run: ${error.message}`);
    if (error.status === 404) { state.run = null; $("run-content").hidden = true; $("empty-state").hidden = false; }
    if (!state.run) $("empty-state").replaceChildren(node("h2", "", "This run could not be loaded."), node("p", "", "Choose another saved run or refresh to try again. The URL still points to the requested run."));
  }
}
async function refresh() {
  if (state.loading) return;
  state.loading = true; $("refresh").disabled = true; $("load-older").disabled = true;
  const previousId = state.selectedId;
  setNotice("page-error", null);
  try {
    const [app] = await Promise.all([api("/api/state"), loadRuns(true)]);
    state.meetings = array(app.meetings); renderRuns();
    if (previousId && state.selectedId === previousId) await selectRun(previousId, { preserve: true });
    else if (!state.selectedId) {
      const requested = new URL(window.location.href).searchParams.get("run");
      if (requested || state.runs[0]?.id) await selectRun(requested || state.runs[0].id);
    }
  } catch (error) { setNotice("page-error", error.message); }
  finally { state.loading = false; $("refresh").disabled = false; $("load-older").disabled = false; }
}
$("refresh").addEventListener("click", refresh);
$("load-older").addEventListener("click", async () => {
  if (state.loading || !state.hasMore) return;
  state.loading = true; $("load-older").disabled = true;
  try { await loadRuns(); setNotice("page-error", null); }
  catch (error) { setNotice("page-error", error.message); }
  finally { state.loading = false; $("load-older").disabled = false; }
});
$("all-stages").addEventListener("click", () => filterStage(null));
window.addEventListener("pagehide", stopPolling);
window.addEventListener("pageshow", event => { if (event.persisted) schedulePoll(); });
refresh();
