import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
if (args.length !== 1 || !['serve', 'run'].includes(args[0])) throw new Error('Use serve or run.');
const path = resolve('.understudy/gateway.json');
const config = JSON.parse(readFileSync(path, 'utf8'));
if (typeof config.credentialReference !== 'string' || !config.credentialReference) throw new Error('Missing saved credential reference; provision through the CLI.');
const child = spawn('understudy', ['keys', 'exec', config.credentialReference, '--', process.execPath, args[0] === 'serve' ? 'src/server.mjs' : 'src/run.mjs', ...(args[0] === 'run' ? ['--mode', 'live'] : [])], {
  stdio: 'inherit', shell: false,
  env: { ...process.env, CRM_GATEWAY_CONFIG: path, CRM_ALLOW_LIVE: '1', CRM_MODE: 'live' },
});
child.on('error', () => { console.error('Could not start the default Understudy CLI.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
