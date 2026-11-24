import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResult } from './writer.js';
import { PACKAGE_VERSION } from './internal/protocol.js';
import type { MomentResult } from './types.js';

const at = '2026-11-24T00:00:00.000Z';
const base: MomentResult = { schemaVersion: 3, packageVersion: PACKAGE_VERSION, sessionId: 's1', runRef: 'r2', journeyId: 'task', target: 'created',
    activity: 'preparing', startedAt: at, updatedAt: at, observations: [], cleanup: 'not-attempted', failures: [], outcome: 'pending' };

test('a run started from a catalogue selection keeps its receipt', () => {
    validateResult({ ...base, selection: { requestRef: 'q1', fromRunRef: 'r1', toRunRef: 'r2', target: 'task.created', phase: 'starting' } });
    assert.throws(() => validateResult({ ...base, selection: { requestRef: 'q1', fromRunRef: 'r1', toRunRef: 'other', target: 'task.created', phase: 'starting' } }), /selection/);
});
