import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run against the built executable, or supply the installed package's dist/cli.js.
const cli = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'moments-cli-proof-'));
let checks = 0;
const secret = 'DO-NOT-PRINT-CONFIG-SECRET';
const config = `export default {
  baseURL: 'http://127.0.0.1:3100',
  beforeRun: async () => { throw new Error('${secret}'); },
  journeys: [{ id: 'task.flow', title: 'Tasks', checkpoints: [{ id: 'draft', title: 'Draft' }], create() { throw new Error('${secret}'); } }]
};`;
function run(args, cwd, status, contains) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.status, status, `${args.join(' ')}: ${result.stderr}`);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes(contains), `Expected ${contains}: ${output}`);
    assert.ok(!output.includes(secret), 'Raw config errors must remain private');
    checks++;
    return result;
}
try {
    const plain = join(temporary, 'plain'), esm = join(temporary, 'esm'), child = join(plain, 'child');
    await mkdir(child, { recursive: true });
    await mkdir(esm);
    await writeFile(join(plain, 'moments.config.ts'), config);
    await writeFile(join(esm, 'package.json'), '{"type":"module"}');
    await writeFile(join(esm, 'moments.config.ts'), config);
    run(['--help'], temporary, 0, 'Usage:');
    run(['open'], temporary, 2, 'Choose a target');
    run(['list', '--once'], temporary, 2, '--once');
    run(['open', 'task.flow.draft', '--config'], temporary, 2, 'file path');
    run(['list', '--unknown'], temporary, 2, 'Unexpected argument');
    run(['list'], temporary, 2, 'No moments.config.ts');
    run(['list'], child, 2, 'No moments.config.ts');
    run(['list'], plain, 0, 'task.flow.draft');
    run(['list'], esm, 0, 'task.flow.draft');
    run(['list', '--config', '../moments.config.ts'], child, 0, 'task.flow.draft');
    run(['open', 'task.flow.missing'], plain, 2, 'Unknown target');
    run(['open', 'task.flow.draft', '--once'], plain, 1, 'needs attention at admission');
    run(['open', 'task.flow.draft', '--once', '--config', '../moments.config.ts'], child, 1, 'needs attention at admission');
    const receiptDir = join(plain, '.moments', 'runs');
    const receipts = await readdir(receiptDir);
    assert.equal(receipts.length, 2, 'Default output resolves beside the explicit config, not caller cwd');
    assert.equal((await stat(receiptDir)).mode & 0o077, 0);
    for (const file of receipts) {
        const result = JSON.parse(await readFile(join(receiptDir, file), 'utf8'));
        assert.equal(result.outcome, 'incomplete');
        assert.equal(result.cleanup, 'complete');
        assert.equal((await stat(join(receiptDir, file))).mode & 0o077, 0);
    }
    await assert.rejects(stat(join(child, '.moments')), { code: 'ENOENT' });
    const setup = { formatVersion: 1, journeyId: 'task.flow', checkpointId: 'draft',
        setup: { schemaVersion: 1, values: { name: ' Custom name ' } } };
    await writeFile(join(child, 'review.json'), JSON.stringify(setup));
    run(['open', '--setup'], plain, 2, 'file path');
    run(['list', '--setup', 'review.json'], child, 2, '--setup');
    run(['open', '--setup', 'review.json', '--setup', 'review.json'], child, 2, '--setup');
    run(['open', 'task.flow.other', '--setup', 'review.json', '--config', '../moments.config.ts'], child, 2, 'match');
    run(['open', '--setup', 'review.json', '--config', '../moments.config.ts'], child, 2, 'Invalid run setup');
    assert.equal((await readdir(receiptDir)).length, 2, 'Rejected setup cannot reach admission or receipt creation');
    const configured = config.replace("title: 'Tasks', checkpoints", `title: 'Tasks', setup: {
      schemaVersion: 1, fields: [{ key: 'name', label: 'Name', maxLength: 40 }],
      defaults: { name: 'Default' }, parse: values => ({ ok: true, values })
    }, checkpoints`);
    await writeFile(join(plain, 'configured.ts'), configured);
    for (const invalid of [
        { ...setup, extra: 'not allowed' },
        { ...setup, formatVersion: 2 },
        { ...setup, setup: { schemaVersion: 2, values: { name: 'Name' } } },
        { ...setup, setup: { schemaVersion: 1, values: { name: 'Name', password: secret } } },
        { ...setup, setup: { schemaVersion: 1, values: { name: 123 } } },
        { ...setup, setup: { schemaVersion: 1, values: {} } }
    ]) {
        await writeFile(join(child, 'invalid.json'), JSON.stringify(invalid));
        run(['open', '--setup', 'invalid.json', '--config', '../configured.ts'], child, 2, 'Invalid run setup');
    }
    await writeFile(join(child, 'invalid.json'), JSON.stringify({ ...setup, setup: { schemaVersion: 1, values: { name: '   ' } } }));
    run(['open', '--setup', 'invalid.json', '--config', '../configured.ts'], child, 2, 'name: Enter a value.');
    await writeFile(join(child, 'invalid.json'), '{ invalid JSON');
    run(['open', '--setup', 'invalid.json', '--config', '../configured.ts'], child, 2, 'Invalid run setup');
    await writeFile(join(child, 'oversized.json'), ' '.repeat(65537));
    run(['open', '--setup', 'oversized.json', '--config', '../configured.ts'], child, 2, '64 KiB');
    assert.equal((await readdir(receiptDir)).length, 2, 'Malformed and incompatible input has no run effects');
    const diagnostic = run(['open', '--setup', 'review.json', '--config', '../configured.ts', '--once'], child, 1, 'Check the app prerequisites');
    assert.match(diagnostic.stdout, /Run reference: [a-z0-9-]+/);
    const configuredReceipts = await readdir(receiptDir);
    assert.equal(configuredReceipts.length, 3);
    const configuredReceipt = JSON.parse(await readFile(join(receiptDir, configuredReceipts.find(file => !receipts.includes(file))), 'utf8'));
    assert.equal(configuredReceipt.schemaVersion, 2);
    assert.deepEqual(configuredReceipt.setup, { schemaVersion: 1, values: { name: 'Custom name' } });
    assert.equal(configuredReceipt.target, 'draft');
    await writeFile(join(plain, 'broken.ts'), `throw new Error('${secret}');`);
    run(['list', '--config', 'broken.ts'], plain, 2, 'Could not load the config');
    await writeFile(join(plain, 'invalid.ts'), 'export default { baseURL: "invalid" };');
    run(['list', '--config', 'invalid.ts'], plain, 2, 'Invalid Moments config');
    process.stdout.write(`${JSON.stringify({ cli, checks, outcome: 'passed', fixture: 'temporary independent cwd; ESM and no-package-json TypeScript config', assertions: 'help, args, discovery, scoped import, target, admission failure, secret-safe errors, config-relative private receipts, complete setup import, cwd-relative setup file, mismatch and malformed input before effects' })}\n`);
} finally {
    await rm(temporary, { recursive: true, force: true });
}
