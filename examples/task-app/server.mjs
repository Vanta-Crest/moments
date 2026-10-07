import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 4177);
const statePath = process.env.TASK_APP_STATE || join(process.cwd(), '.state/tasks.json');
await mkdir(dirname(statePath), { recursive: true });
let tasks;
try { tasks = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; tasks = []; }
if (!Array.isArray(tasks)) throw Error('Invalid task state');
const faults = new Set();
let sequence = Promise.resolve();
async function persist() {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, JSON.stringify(tasks, null, 2), { mode: 0o600 });
  await rename(temporary, statePath);
}
async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 8192) throw Error('Body too large');
  }
  return JSON.parse(value || '{}');
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function owned(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') return json(res, 200, { ready: true });
  if (url.pathname === '/api/proof/fault' && process.env.TASK_APP_PROOF === '1' && req.method === 'POST') {
    const value = await body(req);
    if (!owned(value.runRef) || typeof value.fail !== 'boolean') return json(res, 400, { error: 'Invalid fault' });
    if (value.fail) faults.add(value.runRef); else faults.delete(value.runRef);
    return json(res, 200, { enabled: value.fail });
  }
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    const runRef = url.searchParams.get('runRef');
    if (runRef && faults.has(runRef) && url.searchParams.get('verify') === '1') return json(res, 503, { error: 'Proof verification unavailable' });
    return json(res, 200, tasks.filter(task => !runRef || task.runRef === runRef));
  }
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const value = await body(req);
    if (!owned(value.runRef) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) return json(res, 400, { error: 'Invalid task' });
    const task = { id: randomUUID(), runRef: value.runRef, title: value.title.trim(), completed: false };
    tasks.push(task); await persist(); return json(res, 201, task);
  }
  const match = /^\/api\/tasks\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
  if (match && req.method === 'PATCH') {
    const value = await body(req);
    const task = tasks.find(task => task.id === match[1] && task.runRef === value.runRef);
    if (!task) return json(res, 404, { error: 'Task missing' });
    if (typeof value.completed !== 'boolean') return json(res, 400, { error: 'Invalid completion' });
    task.completed = value.completed; await persist(); return json(res, 200, task);
  }
  if (url.pathname === '/api/tasks' && req.method === 'DELETE') {
    const runRef = url.searchParams.get('runRef');
    if (!owned(runRef)) return json(res, 400, { error: 'Exact run reference required' });
    tasks = tasks.filter(task => task.runRef !== runRef); faults.delete(runRef);
    await persist(); return json(res, 200, { removed: true });
  }
  const files = { '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'], '/app.js.map': ['app.js.map', 'application/json'] };
  if (files[url.pathname]) {
    const [file, type] = files[url.pathname];
    res.writeHead(200, { 'content-type': type }); return res.end(await readFile(join(process.cwd(), 'public', file)));
  }
  if (url.pathname !== '/') return json(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Task app · Moments example</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
}
const server = createServer((req, res) => {
  sequence = sequence.then(() => handle(req, res)).catch(error => {
    console.error(error.message);
    if (!res.headersSent) json(res, 500, { error: 'Request failed' }); else res.end();
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Task app ready: http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
