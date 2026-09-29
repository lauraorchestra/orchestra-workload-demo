# Internal application contract

All source and fixtures are invented. SQLite persists under `.understudy/crm.sqlite` by default. `openStore({path})` from `src/store.mjs` returns synchronous methods below, with camelCase JSON objects. Dates are ISO dates/timestamps, amounts integer USD units.

- `overview()` -> `{accounts, contacts, deals, tasks, meetings, fieldDefinitions}`.
- `getMeeting(id)` -> meeting with `{id,title,accountHint,occurredAt,note}` (extra internal scope fields permitted).
- `snapshot()` -> `{accounts,contacts,deals,tasks}`.
- `createRun({meetingId,mode})` -> `{id,meetingId,mode,status,before,...}` persisted initial `status: running`.
- `appendEvent(runId,{type,stage,data})` -> stored event. Event has `id`, `at`, `type`, `stage`, `data`.
- `finishRun(runId,{status,summary,error})` persists `after` snapshot and terminal metadata.
- `getRun(id)` -> run with `{id,meetingId,mode,status,startedAt,finishedAt,before,after,events,summary,error}`.
- `listRuns()` -> recent run summaries.
- `executeTool(name,args,{runId})` supports synchronous deterministic database tools and throws structured/legible errors. It does not dispatch model tools.
- `reset()` restores seeds and clears runs. Server prevents reset during a running job.
- `close()` closes DB.
- exported `toolDefinitions`: OpenAI Chat Completions function-tool schema array for database tools only. Strict JSON argument validation, whitelist fields, version conflicts and evidence required for writes.
- exported `scenarioExpectations`: invented expected field/task outcomes used only by tests, never sent as agent context.

Tool names and arguments:
`search_accounts({query})`, `get_account({accountId})`, `list_deals({accountId})`, `get_deal({dealId})`, `get_timeline({accountId})`, `get_field_definitions({})`, `update_deal({dealId,expectedVersion,changes,evidence})`, `create_follow_up_task({dealId,title,dueDate,body,evidence})`.

A deal includes `id,accountId,name,stage,amount,closeDate,nextStep,championContactId,version`; optional notes permitted. Valid stages: discovery, evaluation, proposal, negotiation, won, lost. A contact includes id/accountId/name/email/role. `evidence` is an array of source references: meeting ID or timeline item IDs. Reject arbitrary invalid field/ID/date/types and evidence not present in the scoped account/meeting. Journal mutations separately from root runner tool-call events.

Runner `runMeeting({store,meetingId,mode,config})` returns terminal run. It creates the run first, uses named model stages, journals LLM and tool operations and bounded errors. No silent success on budget/validation/model failures. An optional callback `onRunCreated(run)` can expose async start ID. Server owns only one in-flight run at a time. Read routes: `/api/state` returns `{...overview(),runs,config:{mode,model,liveReady}}`; `/api/runs/:id` returns full run. `POST /api/runs {meetingId,mode}` returns HTTP202 `{id}`; `POST /api/reset {}` resets seeded data. All bind to loopback. Static UI only uses same-origin APIs.

UI shows all data as synthetic, mode and configured model, meeting detail/input, run controls, tool timeline, final deal/task changes and errors. Distinguish fixture transport mode from real model mode. Model stage names will be discovered during gateway integration, not preassigned to hosted workloads in this contract.
