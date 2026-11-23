import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Start this finite harness with the repository's host-process guard. Children
// stay in that owned process group; no detached process or shared server is used.
const here = dirname(fileURLToPath(import.meta.url));
const evidence = resolve(process.env.TASK_APP_PROOF_DIR || join(here, '.proof'));
await mkdir(evidence, { recursive: true });
const report = { command: process.argv.join(' '), cwd: here, startedAt: new Date().toISOString(), inputs: {}, runs: [], assertions: [], passed: false };
let scenariosPassed = false;
for (const file of ['package.json', 'package-lock.json', 'app.jsx', 'app.css', 'server.mjs', 'journey.ts', 'moments.config.ts', 'proof.config.ts', 'proof.mjs']) {
  try { report.inputs[file] = createHash('sha256').update(await readFile(join(here, file))).digest('hex'); }
  catch (error) { if (error.code !== 'ENOENT' || file !== 'package-lock.json') throw error; }
}
const cli = join(here, 'node_modules', '.bin', 'moments');
report.installedCli = await realpath(cli);
if (process.env.MOMENTS_TARBALL) {
  report.tarball = { path: resolve(process.env.MOMENTS_TARBALL), sha256: createHash('sha256').update(await readFile(process.env.MOMENTS_TARBALL)).digest('hex') };
}
const children = new Set();
const lifetimes = new Map();
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: here, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.add(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { children.delete(child); resolve({ code, signal, stdout, stderr }); });
  });
  lifetimes.set(child, done);
  return { child, done, stdout: () => stdout, stderr: () => stderr };
}
async function bounded(done, milliseconds = 45000) {
  let timer;
  try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Child exceeded proof deadline')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function waitUntil(operation, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    try { const value = await operation(); if (value) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Proof condition timed out');
}
const server = start(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', TASK_APP_PROOF: '1', TASK_APP_STATE: join(evidence, 'tasks.json') } });
let baseURL;
try {
  baseURL = await waitUntil(() => /Task app ready: (http:\/\/127\.0\.0\.1:\d+)/.exec(server.stdout())?.[1]);
  async function api(path, options) {
    const response = await fetch(`${baseURL}${path}`, options); assert.equal(response.ok, true); return response.json();
  }
  const foreign = await api('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runRef: 'foreign-proof-record', title: 'Preserve another run' }) });
  const unrelatedCwd = join(evidence, 'unrelated-cwd'); await mkdir(unrelatedCwd, { recursive: true });
  async function run(name, args, scenario, expectedCode = 0) {
    const directory = join(evidence, name); await mkdir(directory, { recursive: true });
    const receipts = join(directory, 'receipts');
    const config = join(here, scenario ? 'proof.config.ts' : 'moments.config.ts');
    const fullArgs = [...args, '--config', config];
    const processRun = start(cli, fullArgs, { cwd: unrelatedCwd, env: { ...process.env, TASK_APP_URL: baseURL,
      MOMENTS_OUTPUT_DIR: receipts, TASK_APP_SCENARIO: scenario || '', TASK_APP_EVIDENCE: directory } });
    if (scenario === 'signal') {
      await waitUntil(async () => JSON.parse(await readFile(join(directory, 'signal-ready.json'), 'utf8')), 25000);
      processRun.child.kill('SIGTERM');
    }
    let result;
    try { result = await bounded(processRun.done); }
    catch (error) {
      await writeFile(join(directory, 'stdout.log'), processRun.stdout());
      await writeFile(join(directory, 'stderr.log'), processRun.stderr());
      throw error;
    }
    await writeFile(join(directory, 'stdout.log'), result.stdout); await writeFile(join(directory, 'stderr.log'), result.stderr);
    report.runs.push({ name, args: fullArgs, cwd: unrelatedCwd, code: result.code, signal: result.signal, directory });
    if (args[0] === 'list') {
      assert.equal(result.code, expectedCode, `${name}: ${result.stderr}`);
      for (const checkpoint of ['draft', 'created', 'completed']) assert.match(result.stdout, new RegExp(`task\\.${checkpoint}`));
      return;
    }
    const interactiveProof = ['manual', 'retry', 'controls', 'director'].includes(scenario)
      ? JSON.parse(await readFile(join(directory, 'scenario.json'), 'utf8')) : undefined;
    if (interactiveProof && interactiveProof.passed !== true) {
      // Keep the original browser failure primary, while still verifying and
      // recording cleanup independently of successful-scenario receipt counts.
      try {
        const failedReceipts = (await readdir(receipts)).filter(file => file.endsWith('.json') && file !== 'latest.json');
        assert.ok(failedReceipts.length > 0, 'Failed scenario retains cleanup receipts');
        for (const file of failedReceipts) {
          const receiptPath = join(receipts, file);
          const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
          assert.equal(receipt.activity, 'closed'); assert.equal(receipt.cleanup, 'complete');
          assert.equal((await stat(receiptPath)).mode & 0o077, 0, 'Receipt is private');
          assert.deepEqual(await api(`/api/tasks?runRef=${receipt.runRef}`), []);
        }
        assert.deepEqual(await api('/api/tasks?runRef=foreign-proof-record'), [foreign]);
        report.assertions.push(`${name}: failed scenario retained closed/private receipts, owned cleanup and foreign record`);
      } catch (error) {
        report.runs.at(-1).cleanupAssertionError = String(error);
      }
      throw Error(`${name}: ${interactiveProof.error || 'Interactive scenario did not pass'}`);
    }
    assert.equal(result.code, expectedCode, `${name}: ${result.stderr}`);
    const files = (await readdir(receipts)).filter(file => file.endsWith('.json') && file !== 'latest.json');
    assert.equal(files.length, scenario === 'controls' ? 2 : 1);
    const collected = [];
    for (const file of files) {
      const receiptPath = join(receipts, file);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      assert.equal(receipt.activity, 'closed'); assert.equal(receipt.cleanup, 'complete');
      assert.equal((await stat(receiptPath)).mode & 0o077, 0, 'Receipt is private');
      assert.equal(receipt.outcome, expectedCode === 0 ? 'complete' : 'incomplete');
      assert.deepEqual(await api(`/api/tasks?runRef=${receipt.runRef}`), []);
      collected.push(receipt);
    }
    const receipt = collected[0];
    if (args.includes('--once') && expectedCode === 0) {
      const checkpoints = ['draft', 'created', 'completed'];
      const target = args[1].slice('task.'.length);
      const targetIndex = checkpoints.indexOf(target);
      assert.ok(targetIndex >= 0, 'One-shot proof has a known requested target');
      assert.equal(receipt.journeyId, 'task');
      assert.equal(receipt.target, target, 'Receipt belongs to the requested checkpoint');
      assert.deepEqual(receipt.failures, [], 'Successful one-shot run has no failures');
      assert.deepEqual(receipt.observations.map(({ checkpointId, provenance, status }) => ({ checkpointId, provenance, status })),
        checkpoints.slice(0, targetIndex + 1).map(checkpointId => ({ checkpointId, provenance: 'native', status: 'passed' })),
        'One-shot run enters and verifies each checkpoint in order through its requested target');
      report.assertions.push(`${name}: requested journey/target and ordered native checkpoint verification retained in receipt`);
    }
    assert.deepEqual(await api('/api/tasks?runRef=foreign-proof-record'), [foreign]);
    if (scenario === 'manual' || scenario === 'retry' || scenario === 'controls' || scenario === 'director') {
      const proof = interactiveProof; assert.equal(proof.passed, true, proof.error);
      report.assertions.push(...proof.assertions);
      if (scenario === 'controls') {
        assert.equal(proof.runRefs.length, 2);
        assert.equal(new Set(proof.runRefs).size, 2);
        assert.deepEqual(collected.map(item => item.runRef).sort(), [...proof.runRefs].sort());
        const predecessor = collected.find(item => item.runRef === proof.runRefs[0]);
        const replacement = collected.find(item => item.runRef === proof.runRefs[1]);
        assert.equal(replacement.previousRunRef, predecessor.runRef);
        assert.ok(predecessor.observations.some(item => item.checkpointId === 'completed' && item.status === 'passed'));
        assert.ok(replacement.observations.some(item => item.checkpointId === 'created' && item.status === 'passed'));
        report.assertions.push('Controls replacement retains two linked closed/private receipts, both run-owned cleanups, and the foreign record');
      }
    }
    if (scenario === 'manual') {
      for (const checkpoint of ['created', 'completed']) assert.ok(receipt.observations.some(item => item.checkpointId === checkpoint && item.provenance === 'manual' && item.status === 'passed'));
    }
    if (scenario === 'retry') {
      assert.ok(receipt.failures.some(item => item.stage === 'verify' && item.checkpointId === 'created'));
      assert.ok(receipt.observations.some(item => item.checkpointId === 'created' && item.status === 'passed' && item.provenance === 'manual'));
    }
    if (scenario === 'once-failure') {
      const failure = receipt.failures.find(item => item.stage === 'verify' && item.checkpointId === 'created');
      assert.ok(failure);
      const evidenceFile = join(directory, 'evidence', failure.evidence);
      assert.equal(failure.evidence, `${receipt.runRef}/verify-created.txt`);
      assert.ok(result.stderr.includes(`Checkpoint "Task created" failed at verify: `) && result.stderr.includes(`(evidence: ${evidenceFile})`), result.stderr);
      assert.match(result.stdout, /passed\s+Empty draft\n\s+failed\s+Task created\n/);
      assert.match(await readFile(evidenceFile, 'utf8'), /^URL: http:\/\/127\.0\.0\.1:\d+\/\?run=/m);
      for (const file of [evidenceFile, evidenceFile.replace(/\.txt$/, '.png')]) {
        assert.ok((await stat(file)).size > 0); assert.equal((await stat(file)).mode & 0o077, 0, 'Evidence is private');
      }
      const latest = JSON.parse(await readFile(join(receipts, 'latest.json'), 'utf8'));
      assert.deepEqual(latest, { runRef: receipt.runRef, receipt: join(receipts, `${receipt.runRef}.json`), outcome: 'incomplete', evidence: evidenceFile });
      report.assertions.push('once-failure: CLI names the checkpoint, message and private evidence (URL, screenshot); latest.json points at the run');
    }
    if (scenario === 'signal') assert.ok(receipt.failures.some(item => item.code === 'interrupted'));
    report.assertions.push(`${name}: closed receipt, private file, owned cleanup, foreign record preserved`);
  }
  await run('list', ['list']);
  for (const checkpoint of ['draft', 'created', 'completed']) await run(`once-${checkpoint}`, ['open', `task.${checkpoint}`, '--once']);
  await run('once-failure', ['open', 'task.created', '--once'], 'once-failure', 1);
  await run('manual', ['open', 'task.draft', '--headless'], 'manual');
  // Failure history deliberately remains incomplete even after recovery.
  await run('retry', ['open', 'task.draft', '--headless'], 'retry', 1);
  await run('controls', ['open', 'task.draft', '--headless'], 'controls');
  await run('director', ['open', 'task.draft', '--headless'], 'director');
  await run('signal', ['open', 'task.draft', '--headless'], 'signal', 143);
  scenariosPassed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  const cleanup = await Promise.allSettled([...children].map(async child => {
    try { await bounded(lifetimes.get(child), 5000); }
    catch {
      child.kill('SIGKILL');
      await bounded(lifetimes.get(child), 5000);
    }
  }));
  if (cleanup.some(item => item.status === 'rejected')) {
    report.cleanupError = 'An owned child did not close'; process.exitCode = 1;
  }
  report.cleanup = { ownedChildrenRemaining: children.size };
  if (children.size !== 0) {
    report.cleanupError = 'Owned children remain after teardown'; process.exitCode = 1;
  }
  await bounded(server.done, 5000).then(async result => {
    await writeFile(join(evidence, 'server.stdout.log'), result.stdout);
    await writeFile(join(evidence, 'server.stderr.log'), result.stderr);
    assert.equal(result.code, 0, 'Owned server closes gracefully');
    assert.equal(result.signal, null, 'Owned server is not force-terminated');
  }).catch(error => { report.cleanupError = String(error); process.exitCode = 1; });
  report.passed = scenariosPassed && !report.error && !report.cleanupError && children.size === 0;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, report: join(evidence, 'report.json'), error: report.error }));
}
