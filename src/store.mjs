import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve, parse } from 'node:path';
import { homedir, hostname, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { seed, scenarioExpectations } from './seed.mjs';

export { scenarioExpectations };

const stages = ['discovery', 'evaluation', 'proposal', 'negotiation', 'won', 'lost'];
const mutableFields = ['stage', 'amount', 'closeDate', 'nextStep', 'championContactId', 'notes'];
const fieldDefinitions = [
  { name: 'stage', type: 'enum', values: stages, writable: true, description: 'Current sales stage. Negotiation is not a signed or won contract.' },
  { name: 'amount', type: 'integer', unit: 'USD', minimum: 0, writable: true, description: 'Total opportunity amount in whole USD, not cents. Do not combine separate opportunities.' },
  { name: 'closeDate', type: 'date', format: 'YYYY-MM-DD', writable: true, description: 'Target close date; not a task deadline.' },
  { name: 'nextStep', type: 'string', writable: true, description: 'Next agreed action; do not invent dates or completed work.' },
  { name: 'championContactId', type: 'contact ID or null', writable: true, description: 'Existing internal champion contact belonging to this opportunity account.' },
  { name: 'notes', type: 'string', writable: true, description: 'Factual opportunity notes supported by evidence.' },
  { name: 'id', type: 'string', writable: false },
  { name: 'accountId', type: 'string', writable: false },
  { name: 'name', type: 'string', writable: false },
  { name: 'version', type: 'integer', writable: false, description: 'Read current version and pass it as expectedVersion to prevent stale writes.' },
];

const stringSchema = { type: 'string', minLength: 1 };
const dateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'A real calendar date in YYYY-MM-DD format.' };
const evidenceSchema = { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: stringSchema, description: 'IDs of the current meeting and/or retrieved timeline records belonging to the scoped account. Use sources that support this exact action.' };
const changeProperties = {
  stage: { type: 'string', enum: stages }, amount: { type: 'integer', minimum: 0, maximum: 1000000000 }, closeDate: dateSchema,
  nextStep: { type: 'string', minLength: 1, maxLength: 2000 }, championContactId: { type: ['string', 'null'] }, notes: { type: 'string', maxLength: 6000 },
};
function definition(name, description, properties, required = Object.keys(properties)) {
  return { type: 'function', function: { name, description, strict: false, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
export const toolDefinitions = [
  definition('search_accounts', 'Find candidate CRM accounts by name or domain. Similar names can refer to separate businesses. Verify account details and meeting identity before selecting one.', { query: { type: 'string', minLength: 1, maxLength: 200 } }),
  definition('get_account', 'Read account details and its existing contacts to verify identity and select an evidence-supported contact.', { accountId: stringSchema }),
  definition('list_deals', 'List all opportunities for an account. Identify the deal actually discussed and preserve unrelated opportunities.', { accountId: stringSchema }),
  definition('get_deal', 'Read an opportunity and its current optimistic version immediately before updating. Values must be reconciled with the current meeting and dated timeline.', { dealId: stringSchema }),
  definition('get_timeline', 'Read dated historical account records with source IDs. Historical proposals and tentative plans can be superseded by the current meeting; preserve history and do not invent facts.', { accountId: stringSchema }),
  definition('get_field_definitions', 'Read valid fields, data types, stages, and write rules before constructing CRM updates.', {}),
  definition('update_deal', 'Update supported current opportunity fields using source evidence and the version returned by get_deal. Retrieve account, deal, field and historical context first. Only agreed facts belong in changes; the active meeting account is the write boundary. This changes only the local SQLite CRM.', {
    dealId: stringSchema, expectedVersion: { type: 'integer', minimum: 1 }, changes: { type: 'object', minProperties: 1, properties: changeProperties, additionalProperties: false }, evidence: evidenceSchema,
  }),
  definition('create_follow_up_task', 'Create one explicitly agreed local follow-up task on the relevant deal using supporting source IDs. Resolve calendar dates from the meeting; never invent a deadline, send a message, or schedule an external event.', {
    dealId: stringSchema, title: { type: 'string', minLength: 1, maxLength: 200 }, dueDate: dateSchema, body: { type: 'string', minLength: 1, maxLength: 6000 }, evidence: evidenceSchema,
  }),
];

export class StoreError extends Error {
  constructor(code, message) { super(message); this.name = 'StoreError'; this.code = code; }
}
const fail = (code, message) => { throw new StoreError(code, message); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
function object(value, allowed, required = allowed, label = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_ARGUMENT', `${label} must be an object.`);
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('INVALID_ARGUMENT', `${label} contains an unsupported field.`);
  if (required.some((key) => !Object.hasOwn(value, key))) fail('INVALID_ARGUMENT', `${label} is missing a required field.`);
}
function string(value, label, max = 200, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('INVALID_ARGUMENT', `${label} must be ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters.`);
  return value;
}
function id(value, label) { string(value, label); if (!/^[a-zA-Z0-9_-]+$/.test(value)) fail('INVALID_ARGUMENT', `${label} has invalid characters.`); return value; }
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') fail('INVALID_DATE', `${label} must be a calendar date in YYYY-MM-DD format.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('INVALID_DATE', `${label} is not a real calendar date.`);
}
function integer(value, label, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INVALID_ARGUMENT', `${label} must be an integer between ${minimum} and ${maximum}.`); }

function privatePath(path) {
  if (path === ':memory:') return path;
  const destination = resolve(path);
  const parent = dirname(destination);
  if ([parse(parent).root, resolve(homedir()), resolve(tmpdir())].includes(parent)) fail('PRIVATE_DIRECTORY', 'Use a dedicated private directory for the CRM database.');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (lstatSync(parent).isSymbolicLink()) fail('PRIVATE_DIRECTORY', 'The database directory must not be a symbolic link.');
  chmodSync(parent, 0o700);
  if (existsSync(destination)) {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_FILE', 'The database path must be a regular file.');
  } else closeSync(openSync(destination, 'wx', 0o600));
  chmodSync(destination, 0o600);
  for (const suffix of ['-wal', '-shm', '-journal']) if (existsSync(destination + suffix)) chmodSync(destination + suffix, 0o600);
  return destination;
}

export function openStore({ path = resolve('.understudy/crm.sqlite') } = {}) {
  string(path, 'database path', 4096);
  const db = new DatabaseSync(privatePath(path));
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deals (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), version INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id), title TEXT NOT NULL, due_date TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(deal_id, title, due_date));
    CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS timeline (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), mode TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, before_json TEXT NOT NULL, after_json TEXT, summary TEXT, error_json TEXT);
    CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, at TEXT NOT NULL, type TEXT NOT NULL, stage TEXT NOT NULL, data TEXT NOT NULL);
  `);
  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = operation(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(runs)').all().map((column) => column.name));
    if (!columns.has('owner_pid')) db.exec('ALTER TABLE runs ADD COLUMN owner_pid INTEGER');
    if (!columns.has('owner_hostname')) db.exec('ALTER TABLE runs ADD COLUMN owner_hostname TEXT');
  });
  function all(table) { return db.prepare(`SELECT body FROM ${table} ORDER BY rowid`).all().map((row) => JSON.parse(row.body)); }
  function lookup(table, value, label) {
    id(value, label);
    const row = db.prepare(`SELECT body FROM ${table} WHERE id = ?`).get(value);
    if (!row) fail('NOT_FOUND', `${label} was not found.`);
    return JSON.parse(row.body);
  }
  function snapshot() { return { accounts: all('accounts'), contacts: all('contacts'), deals: all('deals'), tasks: all('tasks') }; }
  function insertSeeds() {
    for (const value of seed.accounts) db.prepare('INSERT INTO accounts (id,body) VALUES (?,?)').run(value.id, JSON.stringify(value));
    for (const value of seed.contacts) db.prepare('INSERT INTO contacts (id,account_id,body) VALUES (?,?,?)').run(value.id, value.accountId, JSON.stringify(value));
    for (const value of seed.deals) db.prepare('INSERT INTO deals (id,account_id,version,body) VALUES (?,?,?,?)').run(value.id, value.accountId, value.version, JSON.stringify(value));
    for (const value of seed.tasks) db.prepare('INSERT INTO tasks (id,deal_id,title,due_date,body) VALUES (?,?,?,?,?)').run(value.id, value.dealId, value.title, value.dueDate, JSON.stringify(value));
    for (const value of seed.meetings) db.prepare('INSERT INTO meetings (id,account_id,body) VALUES (?,?,?)').run(value.id, value.accountId, JSON.stringify(value));
    for (const value of seed.timeline) db.prepare('INSERT INTO timeline (id,account_id,body) VALUES (?,?,?)').run(value.id, value.accountId, JSON.stringify(value));
    db.prepare("INSERT OR REPLACE INTO metadata (key,value) VALUES ('seed_version','1')").run();
  }
  if (!db.prepare("SELECT value FROM metadata WHERE key = 'seed_version'").get()) transaction(insertSeeds);
  function runRow(runId) { id(runId, 'runId'); const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId); if (!row) fail('NOT_FOUND', 'runId was not found.'); return row; }
  function getRun(runId) {
    const row = runRow(runId);
    const events = db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY sequence').all(runId).map((event) => ({ id: event.id, at: event.at, type: event.type, stage: event.stage, data: JSON.parse(event.data) }));
    return { id: row.id, meetingId: row.meeting_id, mode: row.mode, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, before: JSON.parse(row.before_json), after: row.after_json ? JSON.parse(row.after_json) : null, events, summary: row.summary, error: row.error_json ? JSON.parse(row.error_json) : null };
  }
  function activeRun(runId) { const row = runRow(runId); if (row.status !== 'running') fail('RUN_FINISHED', 'The run has finished; no further tool mutations are allowed.'); return row; }
  function appendEvent(runId, event) {
    activeRun(runId);
    object(event, ['type', 'stage', 'data']);
    string(event.type, 'event type', 100); string(event.stage, 'event stage', 100);
    let data; try { data = JSON.stringify(event.data); } catch { fail('INVALID_ARGUMENT', 'Event data must be JSON-serializable.'); }
    if (data === undefined) fail('INVALID_ARGUMENT', 'Event data must be JSON-serializable.');
    const stored = { id: `evt_${randomUUID()}`, at: now(), type: event.type, stage: event.stage, data: JSON.parse(data) };
    db.prepare('INSERT INTO events (id,run_id,at,type,stage,data) VALUES (?,?,?,?,?,?)').run(stored.id, runId, stored.at, stored.type, stored.stage, data);
    return stored;
  }
  function scope(runId, deal, evidence) {
    const row = activeRun(runId);
    const meeting = lookup('meetings', row.meeting_id, 'meetingId');
    if (deal.accountId !== meeting.accountId) fail('SCOPE_MISMATCH', 'This deal belongs to a different account than the active meeting.');
    if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 12 || new Set(evidence).size !== evidence.length) fail('INVALID_EVIDENCE', 'Provide 1–12 distinct source IDs supporting the mutation.');
    for (const sourceId of evidence) {
      if (typeof sourceId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sourceId)) fail('INVALID_EVIDENCE', 'Every evidence source must be a valid source ID.');
      if (sourceId === meeting.id) continue;
      const source = db.prepare('SELECT account_id FROM timeline WHERE id = ?').get(sourceId);
      if (!source || source.account_id !== meeting.accountId) fail('INVALID_EVIDENCE', 'Evidence must reference the current meeting or a timeline item belonging to its account.');
    }
  }
  const handlers = {
    search_accounts(args) { object(args, ['query']); string(args.query, 'query'); const query = args.query.trim().toLowerCase(); return { accounts: all('accounts').filter((account) => `${account.name} ${account.domain}`.toLowerCase().includes(query)) }; },
    get_account(args) { object(args, ['accountId']); const account = lookup('accounts', args.accountId, 'accountId'); return { ...account, contacts: all('contacts').filter((contact) => contact.accountId === account.id) }; },
    list_deals(args) { object(args, ['accountId']); lookup('accounts', args.accountId, 'accountId'); return { deals: all('deals').filter((deal) => deal.accountId === args.accountId) }; },
    get_deal(args) { object(args, ['dealId']); return lookup('deals', args.dealId, 'dealId'); },
    get_timeline(args) { object(args, ['accountId']); lookup('accounts', args.accountId, 'accountId'); return { timeline: all('timeline').filter((item) => item.accountId === args.accountId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)) }; },
    get_field_definitions(args) { object(args, []); return { fieldDefinitions: clone(fieldDefinitions) }; },
    update_deal(args, context) {
      object(args, ['dealId', 'expectedVersion', 'changes', 'evidence']);
      integer(args.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
      object(args.changes, mutableFields, [], 'changes');
      if (!Object.keys(args.changes).length) fail('INVALID_ARGUMENT', 'changes must contain at least one writable field.');
      return transaction(() => {
        const before = lookup('deals', args.dealId, 'dealId');
        scope(context.runId, before, args.evidence);
        for (const [field, value] of Object.entries(args.changes)) {
          if (field === 'stage' && !stages.includes(value)) fail('INVALID_ARGUMENT', 'stage is not a supported sales stage.');
          if (field === 'amount') integer(value, 'amount', 0, 1000000000);
          if (field === 'closeDate') date(value, 'closeDate');
          if (field === 'nextStep') string(value, 'nextStep', 2000);
          if (field === 'notes') string(value, 'notes', 6000, true);
          if (field === 'championContactId' && value !== null) {
            const contact = lookup('contacts', value, 'championContactId');
            if (contact.accountId !== before.accountId) fail('SCOPE_MISMATCH', 'The champion contact belongs to a different account.');
          }
        }
        if (before.version !== args.expectedVersion) fail('VERSION_CONFLICT', 'The deal changed since it was read. Read the current deal version before retrying.');
        const after = { ...before, ...args.changes, version: before.version + 1 };
        const result = db.prepare('UPDATE deals SET body = ?, version = ? WHERE id = ? AND version = ?').run(JSON.stringify(after), after.version, before.id, args.expectedVersion);
        if (result.changes !== 1) fail('VERSION_CONFLICT', 'The deal changed since it was read. Read the current deal version before retrying.');
        appendEvent(context.runId, { type: 'mutation', stage: 'tool', data: { tool: 'update_deal', entityType: 'deal', entityId: before.id, before, after, evidence: args.evidence } });
        return after;
      });
    },
    create_follow_up_task(args, context) {
      object(args, ['dealId', 'title', 'dueDate', 'body', 'evidence']);
      string(args.title, 'title', 200); string(args.body, 'body', 6000); date(args.dueDate, 'dueDate');
      return transaction(() => {
        const deal = lookup('deals', args.dealId, 'dealId'); scope(context.runId, deal, args.evidence);
        const title = args.title.trim();
        const duplicate = db.prepare('SELECT body FROM tasks WHERE deal_id = ? AND lower(title) = lower(?) AND due_date = ?').get(deal.id, title, args.dueDate);
        if (duplicate) {
          const existing = JSON.parse(duplicate.body);
          if (existing.status === 'open' && existing.title === title && existing.body === args.body && JSON.stringify([...existing.evidence].sort()) === JSON.stringify([...args.evidence].sort())) return existing;
          fail('DUPLICATE_TASK', 'A task with this title and due date already exists with different content, evidence, or status.');
        }
        const task = { id: `task_${randomUUID()}`, dealId: deal.id, accountId: deal.accountId, title, dueDate: args.dueDate, body: args.body, status: 'open', evidence: [...args.evidence], createdAt: now() };
        db.prepare('INSERT INTO tasks (id,deal_id,title,due_date,body) VALUES (?,?,?,?,?)').run(task.id, task.dealId, task.title, task.dueDate, JSON.stringify(task));
        appendEvent(context.runId, { type: 'mutation', stage: 'tool', data: { tool: 'create_follow_up_task', entityType: 'task', entityId: task.id, before: null, after: task, evidence: args.evidence } });
        return task;
      });
    },
  };
  return {
    overview() { return { ...snapshot(), meetings: all('meetings'), fieldDefinitions: clone(fieldDefinitions) }; },
    getMeeting(meetingId) { return lookup('meetings', meetingId, 'meetingId'); },
    snapshot,
    createRun(args) {
      object(args, ['meetingId', 'mode']); lookup('meetings', args.meetingId, 'meetingId');
      if (!['offline', 'live'].includes(args.mode)) fail('INVALID_ARGUMENT', 'mode must be offline or live.');
      return transaction(() => {
        if (db.prepare("SELECT id FROM runs WHERE status = 'running' LIMIT 1").get()) fail('RUN_ACTIVE', 'A run is already active.');
        const runId = `run_${randomUUID()}`;
        db.prepare('INSERT INTO runs (id,meeting_id,mode,status,started_at,before_json,owner_pid,owner_hostname) VALUES (?,?,?,?,?,?,?,?)').run(runId, args.meetingId, args.mode, 'running', now(), JSON.stringify(snapshot()), process.pid, hostname());
        return getRun(runId);
      });
    },
    recoverAbandonedRuns() {
      return transaction(() => {
        const abandoned = db.prepare("SELECT id,owner_pid,owner_hostname FROM runs WHERE status = 'running'").all();
        for (const row of abandoned) {
          if (row.owner_hostname !== hostname() || !Number.isSafeInteger(row.owner_pid) || row.owner_pid <= 0) fail('RUN_OWNER_UNKNOWN', 'Cannot recover a run with missing or foreign owner metadata. Preserve its database for manual inspection.');
          try { process.kill(row.owner_pid, 0); }
          catch (error) {
            if (error.code === 'ESRCH') continue;
            fail('RUN_OWNER_UNKNOWN', 'Cannot prove the run owner has stopped; recovery was refused.');
          }
          fail('RUN_ACTIVE', 'The run owner is still alive; stop it before attempting recovery.');
        }
        return abandoned.map((row) => {
          const error = { code: 'RUN_ABANDONED', message: 'Run owner exited without finishing. Review already-applied CRM changes before resuming.' };
          appendEvent(row.id, { type: 'recovery', stage: 'run', data: { ...error, ownerPid: row.owner_pid, ownerHostname: row.owner_hostname } });
          db.prepare("UPDATE runs SET status = 'failed', finished_at = ?, after_json = ?, error_json = ? WHERE id = ?").run(now(), JSON.stringify(snapshot()), JSON.stringify(error), row.id);
          return getRun(row.id);
        });
      });
    },
    appendEvent,
    finishRun(runId, result) {
      object(result, ['status', 'summary', 'error'], ['status']);
      if (!['succeeded', 'failed'].includes(result.status)) fail('INVALID_ARGUMENT', 'Terminal status must be succeeded or failed.');
      if (result.summary != null) string(result.summary, 'summary', 30000, true);
      return transaction(() => {
        activeRun(runId);
        let errorJson = null;
        if (result.error != null) { try { errorJson = JSON.stringify(result.error); } catch { fail('INVALID_ARGUMENT', 'Run error must be JSON-serializable.'); } }
        db.prepare('UPDATE runs SET status = ?, finished_at = ?, after_json = ?, summary = ?, error_json = ? WHERE id = ?').run(result.status, now(), JSON.stringify(snapshot()), result.summary ?? null, errorJson, runId);
        return getRun(runId);
      });
    },
    getRun,
    listRuns() { return db.prepare('SELECT id,meeting_id,mode,status,started_at,finished_at,summary,error_json FROM runs ORDER BY rowid DESC LIMIT 100').all().map((row) => ({ id: row.id, meetingId: row.meeting_id, mode: row.mode, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, summary: row.summary, error: row.error_json ? JSON.parse(row.error_json) : null })); },
    executeTool(name, args, context = {}) {
      if (!Object.hasOwn(handlers, name)) fail('UNKNOWN_TOOL', 'The requested database tool does not exist.');
      object(context, ['runId'], [], 'tool context');
      return handlers[name](args, context);
    },
    reset() {
      return transaction(() => {
        if (db.prepare("SELECT id FROM runs WHERE status = 'running' LIMIT 1").get()) fail('RUN_ACTIVE', 'Cannot reset while a run is active.');
        db.exec('DELETE FROM events; DELETE FROM runs; DELETE FROM tasks; DELETE FROM timeline; DELETE FROM meetings; DELETE FROM deals; DELETE FROM contacts; DELETE FROM accounts; DELETE FROM metadata;');
        insertSeeds(); return snapshot();
      });
    },
    close() { db.close(); },
  };
}
