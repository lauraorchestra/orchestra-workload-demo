import { readConfig } from '../src/config.mjs';
import { fileURLToPath } from 'node:url';

const [action, ...args] = process.argv.slice(2);
if (!['serve', 'run'].includes(action) || (action === 'serve' && args.length)) throw new Error('Use serve or run [--meeting <id>].');
if (args.some(arg => ['--mode', '--reset', '--recover'].includes(arg))) throw new Error('This command runs live OpenAI inference; use the normal offline, reset or recovery command instead.');

process.env.CRM_PROVIDER = 'openai';
process.env.CRM_ALLOW_LIVE = '1';
process.env.CRM_MODE = 'live';
process.env.CRM_MODEL ||= 'gpt-4o';
if (!readConfig().liveReady) throw new Error('Set OPENAI_API_KEY in the environment before running direct OpenAI inference.');

// Keep the application in this process so its shutdown handlers receive signals.
const target = new URL(action === 'serve' ? '../src/server.mjs' : '../src/run.mjs', import.meta.url);
process.argv = [process.execPath, fileURLToPath(target), ...args];
await import(target.href);
