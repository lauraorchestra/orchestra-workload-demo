import { openStore } from './store.mjs';
import { readConfig } from './config.mjs';
import { runMeeting } from './runner.mjs';
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const known = new Set(['--mode', '--meeting', '--reset']);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) throw new Error('Unknown argument. Use --mode offline|live, --meeting <id>, or --reset.');
  if (args[i] !== '--reset') { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing argument value.'); i++; }
}
const store = openStore();
try {
  if (args.includes('--reset')) {
    if (args.length !== 1) throw new Error('Use --reset by itself.');
    store.reset();
    console.log(JSON.stringify({ reset: true }));
  } else {
    const config = readConfig();
    const mode = value('--mode') || config.mode;
    if (!['offline', 'live'].includes(mode)) throw new Error('Invalid mode.');
    const meetingId = value('--meeting') || store.overview().meetings[0]?.id;
    const run = await runMeeting({ store, meetingId, mode, config });
    const responses = run.events.filter(e => e.type === 'llm_response');
    console.log(JSON.stringify({ id: run.id, status: run.status, mode, modelCalls: run.events.filter(e => e.type === 'llm_request').length, completedModelCalls: responses.length, toolCalls: run.events.filter(e => e.type === 'tool_call').length, stages: [...new Set(responses.map(e => e.stage))], requestIds: responses.map(e => e.data.requestId).filter(Boolean), summary: run.summary, error: run.error }, null, 2));
    if (run.status !== 'succeeded') process.exitCode = 1;
  }
} finally { store.close(); }
