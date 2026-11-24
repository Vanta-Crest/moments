import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeReport } from './record.js';
import { PACKAGE_VERSION } from './internal/protocol.js';
import type { MomentResult } from './types.js';

test('the run sheet claims as proven only what the run verified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moments-sheet-'));
    try {
        const at = '2026-11-24T09:00:00.000Z';
        const result: MomentResult = { schemaVersion: 3, packageVersion: PACKAGE_VERSION, sessionId: 's', runRef: 'r1', journeyId: 'task', journeyTitle: 'Task',
            checkpoints: [{ id: 'created', title: 'Created', covers: ['AJ-01'] }, { id: 'approved', title: 'Approved', covers: ['AJ-02'] }],
            origin: 'http://127.0.0.1:4177', target: 'approved', activity: 'closed', startedAt: at, updatedAt: at,
            observations: [{ checkpointId: 'created', at, provenance: 'native', status: 'passed' }],
            cleanup: 'complete', failures: [{ stage: 'verify', code: 'operation-failed', checkpointId: 'approved', at }], outcome: 'incomplete' };
        const receipt = join(root, 'r1.json');
        await writeFile(receipt, JSON.stringify(result));
        const html = await readFile(await writeReport(receipt, undefined, undefined), 'utf8');
        const summary = /<dt>Proven<\/dt><dd>(.*?)<\/dd>/.exec(html)?.[1] ?? '';
        assert.match(summary, /AJ-01/);
        assert.doesNotMatch(summary, /AJ-02/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
