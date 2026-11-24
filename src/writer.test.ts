import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResult } from './writer.js';
import { PACKAGE_VERSION } from './internal/protocol.js';
import type { MomentResult } from './types.js';

const at = '2026-11-24T00:00:00.000Z';
const base: MomentResult = { schemaVersion: 3, packageVersion: PACKAGE_VERSION, sessionId: 's1', runRef: 'r2', journeyId: 'task', journeyTitle: 'Task', checkpoints: [{ id: 'created', title: 'Created' }], origin: 'http://127.0.0.1:4177', target: 'created',
    activity: 'preparing', startedAt: at, updatedAt: at, observations: [], cleanup: 'not-attempted', failures: [], outcome: 'pending' };

// Both ends of a catalogue selection record it: the run that hands over (written first, before
// custody is released) and the run that starts from it.
test('both runs of a catalogue selection keep their receipts', () => {
    const selection = { requestRef: 'q1', fromRunRef: 'r1', toRunRef: 'r2', target: 'task.created', phase: 'cleaning' } as const;
    validateResult({ ...base, runRef: 'r1', selection });
    validateResult({ ...base, runRef: 'r2', selection: { ...selection, phase: 'starting' } });
    assert.throws(() => validateResult({ ...base, runRef: 'r3', selection }), /selection/);
    assert.throws(() => validateResult({ ...base, runRef: 'r1', selection: { ...selection, toRunRef: 'r1' } }), /selection/);
});
