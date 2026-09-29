import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openAppStore, StoreError } from './store.mjs';
import { readConfig, publicConfig } from './config.mjs';
import { runMeeting } from './runner.mjs';

const store = openAppStore({ path: process.env.CRM_DB_PATH });
const config = readConfig();
const port = Number(process.env.CRM_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
let activeRun = null;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function errorStatus(error) {
  if (error instanceof StoreError) {
    if (error.code === 'NOT_FOUND') return 404;
    if (['RUN_ACTIVE', 'VERSION_CONFLICT'].includes(error.code)) return 409;
  }
  return 400;
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16000) throw new Error('Request body too large.');
  }
  return JSON.parse(body || '{}');
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(res, 403, { error: 'Localhost requests only.' });
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Cross-origin writes are disabled.' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Use application/json.' });
    }
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, type] = staticFiles.get(url.pathname);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      return res.end(await readFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url))));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { ...store.overview(), runs: store.listRuns(), config: publicConfig(config), activeRun });
    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
      const run = store.getRun(decodeURIComponent(url.pathname.slice('/api/runs/'.length)));
      return json(res, run ? 200 : 404, run || { error: 'Run not found.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      await readBody(req);
      if (activeRun) return json(res, 409, { error: 'A run is active.' });
      store.reset();
      return json(res, 200, { reset: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/runs') {
      const { meetingId, mode = config.mode } = await readBody(req);
      if (activeRun) return json(res, 409, { error: 'A run is already active.' });
      if (!['offline', 'live'].includes(mode)) return json(res, 400, { error: 'Invalid mode.' });
      if (mode === 'live' && !config.liveReady) return json(res, 400, { error: 'Live inference is not configured/enabled.' });
      if (typeof meetingId !== 'string') return json(res, 400, { error: 'meetingId must be a string.' });
      store.getMeeting(meetingId);
      const promise = runMeeting({ store, meetingId, mode, config, onRunCreated: run => { activeRun = run.id; json(res, 202, { id: run.id }); } });
      promise.catch(error => { if (!res.headersSent) json(res, errorStatus(error), { error: error.message }); }).finally(() => { activeRun = null; });
      return;
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (!res.headersSent) json(res, errorStatus(error), { error: error.message });
    else res.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic CRM lab: http://127.0.0.1:${port} (${config.mode}; live ${config.liveReady ? 'enabled' : 'disabled'})`));
function shutdown() {
  if (activeRun) {
    store.finishRun(activeRun, { status: 'failed', error: 'Application stopped during run; review any already-applied database changes before resuming.' });
    activeRun = null;
    store.close();
    process.exit(1);
  }
  server.close(() => { store.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
