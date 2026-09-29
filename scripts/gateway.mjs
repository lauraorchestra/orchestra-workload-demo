import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const [action, ...args] = process.argv.slice(2);
if (!['serve', 'run'].includes(action) || (action === 'serve' && args.length)) throw new Error('Use serve or run [--meeting <id>].');
if (args.some(arg => ['--mode', '--reset', '--recover'].includes(arg))) throw new Error('This command runs live gateway inference; use the normal offline, reset or recovery command instead.');
const path = resolve('.understudy/gateway.json');
const config = JSON.parse(readFileSync(path, 'utf8'));
if (typeof config.credentialReference !== 'string' || !config.credentialReference) throw new Error('Missing saved credential reference; provision through the CLI.');
const child = spawn('understudy', ['keys', 'exec', config.credentialReference, '--', process.execPath, action === 'serve' ? 'src/server.mjs' : 'src/run.mjs', ...args], {
  stdio: 'inherit', shell: false,
  env: { ...process.env, CRM_PROVIDER: 'understudy', CRM_GATEWAY_CONFIG: path, CRM_ALLOW_LIVE: '1', CRM_MODE: 'live' },
});
child.on('error', () => { console.error('Could not start the default Understudy CLI.'); process.exitCode = 1; });
const interrupt = () => child.kill('SIGINT');
const terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
child.on('exit', (code, signal) => {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
