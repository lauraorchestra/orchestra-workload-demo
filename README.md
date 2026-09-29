# CRM meeting follow-through lab

A local CRM application with wholly invented accounts, contacts, deals, meeting
notes, timelines and follow-up tasks. One agent receives a goal, the meeting,
one system prompt, and CRM tools. It chooses what to read, which supported changes
to make, and when to finish. It can update several deals, create several tasks,
leave already-correct records alone, or explain what needs clarification. It never
sends email or writes to an external CRM.

The model is GPT-4o when running directly with OpenAI. There is no separate
extraction agent, deal-assessment agent, or drafting agent.

Requires Node.js 24 or newer. Install locked dependencies with `npm ci`, then
`npm start` and open http://127.0.0.1:4317. The initial mode is **offline fixture**:
fixed model replies travel through the real OpenAI SDK, runner and database tools.
This makes the application usable without credentials but does not prove model
quality or gateway integration.

`npm run run:offline` runs the fixture transport in the terminal. `npm run reset`
restores the invented records. The UI displays each tool call and database changes.
`npm test` checks persisted outcomes, mutation validation and failure behavior.

## Understand a run

Open **Run explorer** from the sidebar, or visit `/debug`. Select a run to see
its final response, database changes, and a chronological record of model calls,
tool executions, errors, and writes. New runs show one **Meeting follow-through**
conversation: the model asks for tools, the application executes them, and their
results are returned to the same conversation. Older saved runs retain their
original four-stage history.

The main page also shows the exact current goal and system prompt under **Agent
instructions**. A completed run means the model returned a final response and
the application confirmed its successful writes are still present. It does not
mean an independent evaluator has judged the model's decisions correct. Compare
the meeting, tool results, summary, and actual database changes yourself.

For newly recorded runs, select a model call to read its full system/user prompt,
earlier conversation messages, available tool definitions, request settings, and
the exact API response. Tool steps show their arguments and returned results.
Run history supports loading older pages; viewing a run never executes it again.

Runs created before full capture retain their original events and outcomes, but
their exact prompts and responses are unavailable. The explorer labels this gap;
it does not reconstruct missing evidence. New capture records stay in the same
private, ignored `.understudy` database. API keys and authorization headers are
never included in the capture.

## Run directly with OpenAI

With `OPENAI_API_KEY` already exported in your shell, run:

```sh
npm run start:openai
```

Open http://127.0.0.1:4317 and run a meeting follow-through. This explicitly
enables live OpenAI Chat Completions with `gpt-4o`. The key stays in the server's
environment; do not paste it into the browser, source, or command arguments.
The direct mode fixes the endpoint to `https://api.openai.com/v1` and ignores
gateway configuration and `OPENAI_BASE_URL`. It sends no Understudy credentials
or workload headers. Existing gateway setup and run history remain available.

For one terminal run, use `npm run run:openai`. `CRM_MODEL` can select an
intentional alternative; the direct mode defaults to `gpt-4o`. `npm start` still
defaults to offline fixtures, so having a shell key alone does not enable live
traffic. Stop the server before switching between direct and gateway modes.

For a fresh baseline while preserving an earlier database and its history, choose
a separate private path inside `.understudy` (paths outside it and symbolic links
are rejected):

```sh
CRM_DB_PATH=.understudy/openai-baseline/crm.sqlite npm run start:openai
```

Keep that same `CRM_DB_PATH` when later testing the gateway against this data.
The UI and terminal use `.understudy/crm.sqlite` when it is omitted. Reset and
recovery also act on the selected database.

## Run through Orchestra

Gateway runs preserve OpenAI Chat Completions and default to `gpt-4.1-mini`.
Use `CRM_MODEL=gpt-4o npm run start:gateway` when comparing against the direct
GPT-4o baseline without changing models. `npm run start:gateway` runs the application under the default
`understudy keys exec` command. Its private `.understudy/gateway.json` supplies the
verified organization, gateway origin, project slug, stage-to-workload-name map, test environment,
and saved credential reference. The CLI injects the key directly into the child
process; no key is stored in this app. Missing or mismatched gateway configuration
fails closed. Gateway mode never falls back to a native-provider key.

`npm run run:gateway` executes one bounded real-model run in the terminal using
the same private configuration. Both providers cap each run at 16 model requests and 40
tools by default, with a 2,400-token output limit per request and SDK retries disabled. `CRM_MAX_MODEL_CALLS` can lower this
budget (maximum 20). Live requests are billable. The model controls the tool
sequence; there is no required number of writes or required analysis subroutine.
The audit retains attempted/returned requests, provider request IDs, model
receipts and errors. Gateway runs additionally record workload, trace, environment
and route receipts. Direct OpenAI runs have no Orchestra request logs or workloads
until the application is connected. Fixture results remain explicitly synthetic.
Management IDs are used when checking exact request logs through the CLI;
inference headers use the project slug and workload name. Verify both against
the actual indexed request before accepting attribution.

## Where the agent lives

| File | Responsibility |
| --- | --- |
| `src/agent.mjs` | The agent's name, goal, and single readable system prompt. Start here. |
| `src/runner.mjs` | Starts its conversation, executes chosen tools, returns results, and stops on a final answer or a budget/error. |
| `src/store.mjs` | SQLite tools and validation: account boundary, evidence IDs, field types, current versions, dated changes, duplicate tasks, and no-op updates. |
| `src/model.mjs` | OpenAI SDK requests, provider configuration, request limits, and exact prompt/response capture. |
| `src/seed.mjs` | Invented CRM records and meeting scenarios. |
| `src/server.mjs`, `public/` | Local HTTP API, CRM page, and run explorer. |
| `src/fixture-model.mjs` | Fixed offline replies for exercising transport and storage without a model. |

The loop is ordinary JavaScript rather than an agent framework: send messages
and tool definitions to the model, append its reply, execute its requested tools,
append their results, and repeat. Tools are ordinary database functions, not
additional agents. This gives the model control over its approach while the
application retains control of permissions, input validation, and budgets.

There are nine tools: `search_accounts`, `get_account`, `list_deals`, `get_deal`,
`get_timeline`, `list_tasks`, `get_field_definitions`, `update_deal`, and
`create_follow_up_task`. Task reads let the agent recognize work that is already
recorded. Exact unchanged deal updates do not increase the version. The database
blocks exact task duplicates; recognizing differently worded duplicates remains
part of the agent's judgment.

The timeline includes changes saved by earlier runs, including partial writes
from failed runs. An older meeting cannot overwrite a field already changed by
a newer meeting. Unchanged fields and unrelated field backfills remain allowed.

The current agent has one inference boundary, `meetingFollowThrough`. Gateway
integration maps it to one workload; individual tool calls are not separate model
workloads. Existing private gateway configurations from the old four-stage app
need an explicit `workloads.meetingFollowThrough` mapping before gateway runs.
Direct OpenAI mode is unaffected.

Runtime data and evidence live in ignored, private `.understudy/`, including
SQLite snapshots, run events and any gateway verification receipts. No credentials
or hosted organization/project/workload identities belong in this source history.

## Reproduce the test locally

```sh
npm ci
npm test
npm run run:offline
npm start
```

Open http://127.0.0.1:4317 to inspect the account, journal, and before/after
records. Before an independent scenario run, use the UI reset or `npm run reset`
while the runner is idle. This restores only the disposable local CRM and clears
its run history. CI runs offline tests on Node 24 and 26; it never calls a model
or needs credentials.

Choose a natural meeting from the UI: a discussion covering two opportunities,
an ambiguous request, or an account that is already up to date. New examples are
added to existing databases without resetting records or run history. These are
independent scenarios, not a chronology to replay in order; running an older
meeting against later records requires judgment about stale evidence.

The original scripted meeting remains available for the deterministic offline
write exercise. Offline replies for the natural scenarios only inspect records
and return an explicit fixture notice; use a real model to judge those scenarios.

## Recover an interrupted run

Normal shutdown records a failed run. A hard kill or machine crash can leave a
run marked active, which blocks new runs and reset. Use `npm run recover` after
the runner has stopped. Recovery checks the stored owner PID on the same host
and proceeds only when the operating system reports that the process no longer
exists. It marks the run failed, keeps any applied CRM changes, preserves its
original snapshot and events, and adds a recovery event and final snapshot.
Review that record before resuming or resetting the disposable CRM.

Recovery never starts inference or replays writes. It refuses live owners,
permission errors, foreign hostnames, and legacy runs without ownership metadata.
A reused PID is conservatively treated as live. Preserve the database for manual
inspection when ownership cannot be established; recovery has no force option.

## Configure an owned gateway test

Install the CLI that provides `projects`, `workloads`, `requests`, and
`keys exec`, then sign in to an Understudy-owned organization. Confirm the
organization in both `understudy whoami` and dashboard Account settings before
creating resources or sending test traffic. Never use a customer organization.

```sh
understudy login
understudy whoami
understudy projects list
```

Reuse an existing project/workload set when appropriate. For a new test project,
the following example creates one workload with capture disabled. The names
are illustrative and must match your private runtime configuration.

```sh
understudy projects create crm-test-lab --name "Synthetic CRM Test Lab"
understudy workloads create meeting-follow-through --project crm-test-lab --no-capture
understudy keys create --name "local-crm-test"
```

The key command saves its secret outside this repository and prints a **Private
credential reference**. Put that reference, never the key value, into the
private configuration. Start from the synthetic template only on a fresh setup;
do not overwrite existing integration settings:

```sh
umask 077
mkdir -p .understudy
chmod 700 .understudy
cp -n config/gateway.example.json .understudy/gateway.json
chmod 600 .understudy/gateway.json
```

Edit `.understudy/gateway.json` locally. Set `organizationId` from the verified
CLI identity and `credentialReference` from key creation. Set `project` to the
project **slug** and each `workloads` entry to its workload **name**, not the
management IDs. Keep `environment` as `test`. These settings contain no API key,
but they are still local integration records and must remain ignored.

Inspect the selected workloads' capture and routing configuration and confirm
the configured model is available before a run. Start the UI with
`npm run start:gateway`, or run once in the terminal with `npm run run:gateway`.
The default model remains `gpt-4.1-mini`; `CRM_MODEL` selects a deliberate
alternative for a separate experiment.

After a real run, inspect the actual database changes as well as the model's
summary. Match **every** recorded gateway request ID to its selected resources:

```sh
understudy requests show <request-id> --project <project-id> --workload <workload-id> --environment test
understudy requests trace <trace-id> --project <project-id> --environment test --all
```

Require matching organization, project, workload, requested/served model and
environment. Allow bounded read retries for indexing; do not resend inference
to make logs appear. Confirm the same trace in the dashboard after checking its
organization. A successful HTTP response alone is insufficient: incorrect
inference names can land in the organization's default workload. Keep exact run
IDs, logs, screenshots, and verification receipts in `.understudy/`.
