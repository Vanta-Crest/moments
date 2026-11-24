import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { openWithBrowser } from './runner.js';
import type { MomentResult, MomentSession, JourneyDriver } from './types.js';
import { MomentSetupError, validateSetupValues, type MomentSetup, type SetupDefinition } from './setup.js';
// Group and other permission bits. Windows has none: files there are private to the user's profile.
const groupOther = process.platform === 'win32' ? 0 : 0o077;
test('End during replacement admission prevents fresh acquisition', async () => {
    const admitted = latch(), gate = latch();
    let admissions = 0, browsers = 0, drivers = 0;
    const session = await openWithBrowser({
        baseURL: 'http://localhost:3000',
        beforeRun: async () => { if (++admissions === 2) { admitted.release(); await gate.promise; } },
        journeys: [{
            id: 'replacement', title: 'Replacement', checkpoints: [{ id: 'first', title: 'First' }],
            create: () => { drivers++; return { enter: async () => {}, verify: async () => {}, reconcile: async () => 'first', cleanup: async () => 'complete' }; }
        }],
        writeReceipt: async () => {}
    }, { target: 'replacement.first' }, async () => { browsers++; return { page: {} as Page, close: async () => {} }; });
    const view = session.view();
    session.command({ runRef: view.runRef!, revision: view.revision, command: { kind: 'restart', checkpointId: 'first' } });
    await admitted.promise;
    const ending = session.end();
    gate.release();
    const result = await ending;
    assert.equal(browsers, 1);
    assert.equal(drivers, 1);
    assert.equal(result.outcome, 'incomplete');
    assert.equal(result.failures.at(-1)?.code, 'interrupted');
});
test('owned page closing during startup prevents driver acquisition', async () => {
    let drivers = 0, closes = 0;
    const opening = openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => {},
        journeys: [{ id: 'closed', title: 'Closed', checkpoints: [{ id: 'first', title: 'First' }], create: () => { drivers++; throw Error('must not create'); } }],
        writeReceipt: async () => {}
    }, { target: 'closed.first' }, async (_options, _controls, onClose) => {
        onClose();
        return { page: {} as Page, close: async () => { closes++; } };
    });
    await assert.rejects(opening, (error: unknown) => {
        assert.equal((error as { result: MomentResult }).result.failures.at(-1)?.code, 'interrupted');
        return true;
    });
    assert.equal(drivers, 0);
    assert.equal(closes, 1);
});
function latch() { let release!: () => void; const promise = new Promise<void>(r => release = r); return {
    promise, release
}; }
function fixture(options: {
    failWrite?: (r: MomentResult) => boolean;
    enter?: (id: string) => Promise<void>;
    verify?: (id: string) => Promise<void>;
    cleanupFails?: boolean;
    closeFails?: boolean;
    cleanup?: () => Promise<void>;
} = {}) {
    const calls: string[] = [];
    const receipts: MomentResult[] = [];
    let current = 'first';
    const driver: JourneyDriver = {
        enter: async (id) => { calls.push(`enter:${id}`); await options.enter?.(id); current = id; }, verify: async (id) => { calls.push(`verify:${id}`); await options.verify?.(id); }, reconcile: async () => current, cleanup: async () => {
            calls.push('cleanup');
            await options.cleanup?.();
            if (options.cleanupFails)
                throw Error('private');
            return 'complete';
        }
    };
    const config = {
        baseURL: 'http://localhost:3000', beforeRun: async () => { }, journeys: [{
                id: 'journey', title: 'Journey', checkpoints: ['first', 'second', 'third'].map(id => ({
                    id, title: id
                })), create: () => driver
            }], writeReceipt: async (r: MomentResult) => {
            receipts.push(r);
            if (options.failWrite?.(r))
                throw Error('secret');
        }
    };
    const open = () => openWithBrowser(config, { target: 'journey.first' }, async () => {
        calls.push('browser');
        return {
            page: {} as Page, close: async () => {
                calls.push('close');
                if (options.closeFails)
                    throw Error('private');
            }
        };
    });
    return {
        calls, receipts, open
    };
}
for (const phase of ['initial', 'intermediate'] as const)
    test(`writer ${phase} failure cannot skip finalization`, async () => {
        let failed = false;
        const f = fixture({ failWrite: r => {
                const match = phase === 'initial' ? r.activity === 'preparing' : r.observations.length > 0 && r.activity !== 'closing' && r.activity !== 'closed';
                if (match && !failed) {
                    failed = true;
                    return true;
                }
                return false;
            } });
        await assert.rejects(f.open());
        assert.equal(f.calls.includes('browser'), phase !== 'initial');
        if (phase !== 'initial') {
            assert.equal(f.calls.filter(x => x === 'cleanup').length, 1);
            assert.equal(f.calls.filter(x => x === 'close').length, 1);
        }
        assert.equal(failed, true);
    });
test('End waits active entry and stale/busy commands never replay', async () => {
    const entered = latch(), gate = latch();
    const f = fixture({ enter: async (id) => {
            if (id === 'second') {
                entered.release();
                await gate.promise;
            }
        } });
    const s = await f.open();
    const v = s.view();
    const req = {
        runRef: v.runRef!, revision: v.revision, command: { kind: 'continue' as const }
    };
    assert.equal(s.command(req).accepted, true);
    assert.equal(s.command(req).accepted, false);
    await entered.promise;
    const ending = s.end();
    assert.equal(f.calls.includes('cleanup'), false);
    gate.release();
    const r = await ending;
    assert.equal(r.observations.at(-1)?.checkpointId, 'second');
    assert.equal(f.calls.filter(x => x === 'enter:second').length, 1);
});
test('failed destination Check advances position without repeating action and retains failure', async () => {
    let fail = true;
    const f = fixture({ verify: async (id) => {
            if (id === 'second' && fail)
                throw Error('unverified');
        } });
    const s = await f.open();
    const send = (kind: 'continue' | 'check') => { const v = s.view(); return s.command({
        runRef: v.runRef!, revision: v.revision, command: { kind }
    }); };
    send('continue');
    await s.settled();
    assert.equal(s.view().destinationId, 'second');
    assert.equal(send('continue').accepted, false);
    fail = false;
    assert.equal(send('check').accepted, true);
    await s.settled();
    assert.equal(s.view().nextId, 'third');
    assert.equal(f.calls.filter(x => x === 'enter:second').length, 1);
    assert.equal((await s.end()).failures.length, 1);
});
// Completion must describe released custody. These injected boundary faults are
// independent of native financial, sign-out, and SMTP cleanup coverage.
async function assertHeld(session: MomentSession, runRef: string) {
    let completed = false;
    void session.done.then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(completed, false, 'done must stay pending while custody is held');
    assert.equal(session.currentResult().runRef, runRef);
    assert.equal(session.currentResult().activity, 'needs-attention');
    assert.equal(session.currentResult().outcome, 'incomplete');
    assert.deepEqual(session.view().controls, {
        check: false, continue: false, play: false, pause: false, restart: false, end: true
    });
    const view = session.view(), before = session.currentResult();
    for (const command of [
        { kind: 'check' }, { kind: 'continue' }, { kind: 'pause' },
        { kind: 'play', checkpointId: 'third', pace: 'immediate' },
        { kind: 'restart', checkpointId: 'first' }, { kind: 'open', checkpointId: 'first' },
        { kind: 'select', requestRef: 'held-selection', target: 'journey.first' }
    ] as const) {
        assert.equal(session.command({ runRef, revision: view.revision, command }).accepted, false);
    }
    assert.deepEqual(session.currentResult(), before);
    assert.deepEqual(session.view(), view);
}
for (const phase of ['closing', 'final'] as const)
    test(`End ${phase} receipt failure retains custody until explicit retry`, async () => {
        let blocked = true;
        const f = fixture({ failWrite: result => blocked && result.activity === (phase === 'closing' ? 'closing' : 'closed') });
        const s = await f.open(), runRef = s.currentResult().runRef;
        const held = await s.end();
        assert.equal(held.failures.at(-1)?.code, 'persistence-failed');
        assert.equal(held.cleanup, phase === 'closing' ? 'not-attempted' : 'complete');
        await assertHeld(s, runRef);
        assert.equal(f.calls.filter(x => x === 'cleanup').length, phase === 'closing' ? 0 : 1);
        assert.equal(f.calls.includes('close'), false);
        await s.end();
        await assertHeld(s, runRef);
        assert.equal(f.calls.filter(x => x === 'cleanup').length, phase === 'closing' ? 0 : 1);
        assert.equal(f.calls.includes('close'), false);
        blocked = false;
        const finished = await s.end();
        assert.equal(finished.activity, 'closed');
        assert.equal(finished.outcome, 'incomplete');
        assert.equal(await s.done, finished);
        assert.equal(f.calls.filter(x => x === 'cleanup').length, 1);
        assert.equal(f.calls.filter(x => x === 'close').length, 1);
        if (phase === 'final') assert.ok(f.receipts.some(r => r.activity === 'closing' && r.cleanup === 'complete'));
    });

test('cleanup and browser faults retain custody and settle only after release retry', async () => {
    const faults = { cleanupFails: true, closeFails: true }, f = fixture(faults), s = await f.open();
    const runRef = s.currentResult().runRef;
    const cleanupHeld = await s.end();
    assert.deepEqual(cleanupHeld.failures.map(x => x.stage), ['cleanup']);
    assert.equal(cleanupHeld.cleanup, 'incomplete');
    assert.equal(f.calls.includes('close'), false, 'failed cleanup must not release the browser');
    await assertHeld(s, runRef);
    faults.cleanupFails = false;
    const closeHeld = await s.end();
    assert.deepEqual(closeHeld.failures.map(x => x.stage), ['cleanup', 'close']);
    assert.equal(closeHeld.cleanup, 'complete');
    await assertHeld(s, runRef);
    assert.equal(f.calls.filter(x => x === 'cleanup').length, 2);
    assert.equal(f.calls.filter(x => x === 'close').length, 1);
    faults.closeFails = false;
    const v = s.view();
    assert.equal(s.command({ runRef, revision: v.revision, command: { kind: 'end' } }).accepted, true);
    const finished = await s.end();
    assert.equal(await s.done, finished);
    assert.equal(finished.activity, 'closed');
    assert.equal(finished.outcome, 'incomplete');
    assert.deepEqual(finished.failures.map(x => x.stage), ['cleanup', 'close']);
    assert.equal(f.calls.filter(x => x === 'cleanup').length, 2, 'successful cleanup is not replayed');
    assert.equal(f.calls.filter(x => x === 'close').length, 2, 'the same retained browser is retried');
    assert.equal(f.calls.filter(x => x === 'browser').length, 1);
});

test('failed browser close and failed held receipt preserve both failures until End retry', async () => {
    let blockHeldReceipt = true;
    const faults = { closeFails: true, failWrite: (result: MomentResult) => blockHeldReceipt
        && result.activity === 'needs-attention' && result.failures.some(failure => failure.stage === 'close') };
    const f = fixture(faults), s = await f.open(), runRef = s.currentResult().runRef;
    const held = await s.end();
    assert.deepEqual(held.failures.map(failure => failure.stage), ['close', 'persist']);
    assert.equal(held.failures.at(-1)?.code, 'persistence-failed');
    assert.equal(held.cleanup, 'complete');
    await assertHeld(s, runRef);
    assert.equal(f.calls.filter(call => call === 'cleanup').length, 1);
    assert.equal(f.calls.filter(call => call === 'close').length, 1);
    faults.closeFails = false; blockHeldReceipt = false;
    const finished = await s.end();
    assert.equal(await s.done, finished);
    assert.equal(finished.activity, 'closed');
    assert.equal(finished.outcome, 'incomplete');
    assert.deepEqual(finished.failures.map(failure => failure.stage), ['close', 'persist']);
    assert.equal(f.calls.filter(call => call === 'cleanup').length, 1);
    assert.equal(f.calls.filter(call => call === 'close').length, 2);
});

test('overlapping End retries share one cleanup and release operation', async () => {
    const cleaning = latch(), gate = latch();
    const f = fixture({ cleanup: async () => { cleaning.release(); await gate.promise; } }), s = await f.open();
    const first = s.end();
    await cleaning.promise;
    const second = s.end();
    assert.equal(first, second);
    let completed = false;
    void s.done.then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(f.calls.includes('close'), false);
    gate.release();
    const result = await first;
    assert.equal(await second, result);
    assert.equal(await s.done, result);
    assert.equal(f.calls.filter(x => x === 'cleanup').length, 1);
    assert.equal(f.calls.filter(x => x === 'close').length, 1);
});
test('failed manual adoption Check records skipped intermediate checkpoint', async () => {
    let fail = true;
    const writes: MomentResult[] = [];
    const entered: string[] = [];
    const s = await openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => { }, journeys: [{
                id: 'manual', title: 'Manual', checkpoints: ['first', 'second', 'third'].map(id => ({
                    id, title: id
                })), create: () => ({
                    enter: async (id) => { entered.push(id); }, verify: async (id) => {
                        if (id === 'third' && fail)
                            throw Error('unconfirmed');
                    }, reconcile: async () => 'third', cleanup: async () => 'complete'
                })
            }], writeReceipt: async (r) => { writes.push(r); }
    }, { target: 'manual.first' }, async () => ({
        page: {} as Page, close: async () => { }
    }));
    const send = (kind: 'continue' | 'check') => { const v = s.view(); s.command({
        runRef: v.runRef!, revision: v.revision, command: { kind }
    }); };
    send('continue');
    await s.settled();
    fail = false;
    send('check');
    await s.settled();
    assert.deepEqual(entered, ['first']);
    assert.equal(s.currentResult().observations.find(o => o.checkpointId === 'second')?.status, 'skipped');
    await s.end();
});
test('failed predecessor cleanup holds completion and prevents replacement acquisition', async () => {
    const faults = { cleanupFails: true }, f = fixture(faults), s = await f.open();
    const v = s.view();
    s.command({ runRef: v.runRef!, revision: v.revision, command: { kind: 'restart', checkpointId: 'first' } });
    await s.settled();
    await assertHeld(s, v.runRef!);
    assert.equal(f.calls.filter(x => x === 'browser').length, 1);
    assert.equal(f.calls.includes('close'), false);
    faults.cleanupFails = false;
    const result = await s.end();
    assert.equal(await s.done, result);
    assert.equal(result.runRef, v.runRef);
    assert.equal(result.activity, 'closed');
    assert.equal(f.calls.filter(x => x === 'browser').length, 1);
});
test('aborted delayed admission never opens browser or driver', async () => {
    const admitted = latch(), gate = latch(), abort = new AbortController();
    let opened = false;
    const promise = openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => { admitted.release(); await gate.promise; }, journeys: [{
                id: 'abort', title: 'Abort', checkpoints: [{
                        id: 'first', title: 'First'
                    }], create: () => { throw Error('must not create'); }
            }], writeReceipt: async () => { }
    }, {
        target: 'abort.first', signal: abort.signal
    }, async () => { opened = true; throw Error('must not open'); });
    await admitted.promise;
    abort.abort();
    gate.release();
    await assert.rejects(promise);
    assert.equal(opened, false);
});
test('browser setup and failed closure retain separate safe failure stages', async () => {
    const { BrowserSetupFailure } = await import('./internal/browser-failure.js');
    const promise = openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => { }, journeys: [{
                id: 'setup', title: 'Setup', checkpoints: [{
                        id: 'first', title: 'First'
                    }], create: () => { throw Error('must not create'); }
            }], writeReceipt: async () => { }
    }, { target: 'setup.first' }, async () => { throw new BrowserSetupFailure(true); });
    await assert.rejects(promise, (error: unknown) => {
        const result = (error as {
            result: MomentResult;
        }).result;
        assert.deepEqual(result.failures.map(f => f.stage), ['browser', 'close']);
        return true;
    });
});

// These faults are injected at lifecycle boundaries that a native browser run
// cannot reliably race or make fail (especially the receipt writer).
function configuredFixture(options: {
    write?: (result: MomentResult) => Promise<void>;
    cleanupFails?: boolean;
    closeFails?: boolean;
    replacementBrowserFails?: boolean;
} = {}) {
    const calls: string[] = [], receipts: MomentResult[] = [];
    const created: { runRef: string; setup: MomentSetup | undefined }[] = [];
    const fields = [{ key: 'name', label: 'Name', maxLength: 40 }] as const;
    const setup: SetupDefinition = {
        schemaVersion: 1, fields, defaults: { name: 'Original' },
        parse: value => validateSetupValues(fields, value)
    };
    let browsers = 0;
    const config = {
        baseURL: 'http://localhost:3000',
        beforeRun: async () => { calls.push('admission'); },
        journeys: [{
            id: 'configured', title: 'Configured', setup,
            checkpoints: ['first', 'second'].map(id => ({ id, title: id })),
            create: ({ runRef, setup: active }: import('./types.js').JourneyContext): JourneyDriver => {
                calls.push('create');
                created.push({ runRef, setup: active });
                let current = 'first';
                return {
                    enter: async id => { current = id; calls.push(`enter:${id}`); },
                    verify: async () => {}, reconcile: async () => current,
                    cleanup: async () => {
                        calls.push(`cleanup:${active!.values.name}`);
                        if (options.cleanupFails) throw Error('cleanup failed');
                        return 'complete';
                    }
                };
            }
        }],
        writeReceipt: async (result: MomentResult) => {
            receipts.push(structuredClone(result));
            await options.write?.(result);
        }
    };
    const open = (active?: MomentSetup, signal?: AbortSignal) => openWithBrowser(config, {
        target: 'configured.first', ...(active ? { setup: active } : {}), ...(signal ? { signal } : {})
    }, async () => {
        calls.push('browser');
        if (++browsers > 1 && options.replacementBrowserFails) throw Error('browser failed');
        return { page: {} as Page, close: async () => {
            calls.push('close');
            if (options.closeFails) throw Error('close failed');
        } };
    });
    return { calls, receipts, created, config, open };
}
const namedSetup = (name: string): MomentSetup => ({ schemaVersion: 1, values: { name } });

test('invalid initial setup never reaches admission, browser, or fixture', async () => {
    const f = configuredFixture();
    for (const setup of [namedSetup(' '), { schemaVersion: 2, values: { name: 'Name' } },
        { schemaVersion: 1, values: { name: 'Name', password: 'private' } }]) {
        await assert.rejects(f.open(setup), MomentSetupError);
    }
    assert.deepEqual(f.calls, []);
    // A legacy journey must not silently ignore supplied public input.
    await assert.rejects(openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => { throw Error('must not admit'); },
        journeys: [{ id: 'plain', title: 'Plain', checkpoints: [{ id: 'first', title: 'First' }],
            create: () => { throw Error('must not create'); } }], writeReceipt: async () => {}
    }, { target: 'plain.first', setup: namedSetup('Name') }, async () => { throw Error('must not open'); }), MomentSetupError);
});

test('invalid replacement and stale confirmation preserve the active run exactly', async () => {
    const f = configuredFixture(), s = await f.open();
    const before = s.currentResult(), v = s.view(), calls = [...f.calls];
    assert.deepEqual(s.command({ runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart', checkpointId: 'first', setup: namedSetup(' ') } }), {
        accepted: false, reason: 'invalid-setup', issues: [{ field: 'name', message: 'Enter a value.' }]
    });
    assert.equal(s.command({ runRef: v.runRef!, revision: v.revision - 1,
        command: { kind: 'restart', checkpointId: 'first', setup: namedSetup('Next') } }).accepted, false);
    assert.deepEqual(s.currentResult(), before);
    assert.deepEqual(s.view(), v);
    assert.deepEqual(f.calls, calls);
    await s.end();
});

test('accepted setup is copied and frozen, and fresh navigation reuses active values', async () => {
    const initial = { schemaVersion: 1, values: { name: ' First ' } };
    const f = configuredFixture(), s = await f.open(initial);
    initial.values.name = 'Changed externally';
    assert.equal(f.created[0]!.setup!.values.name, 'First');
    assert.equal(Object.isFrozen(f.created[0]!.setup!.values), true);
    const next = { schemaVersion: 1, values: { name: ' Second ' } }, v = s.view();
    const request = { runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart' as const, checkpointId: 'second', setup: next } };
    assert.equal(s.command(request).accepted, true);
    assert.equal(s.command(request).accepted, false);
    next.values.name = 'Changed before operation';
    await s.settled();
    assert.equal(s.currentResult().setup!.values.name, 'Second');
    assert.equal(f.created.length, 2);
    const exposed = s.view().setup!;
    assert.throws(() => { (exposed.active.values as Record<string, string>).name = 'Changed through view'; });
    const current = s.view();
    s.command({ runRef: current.runRef!, revision: current.revision, command: { kind: 'open', checkpointId: 'first' } });
    await s.settled();
    assert.equal(f.created[2]!.setup!.values.name, 'Second');
    const again = s.view();
    s.command({ runRef: again.runRef!, revision: again.revision, command: { kind: 'restart', checkpointId: 'first' } });
    await s.settled();
    assert.equal(f.created[3]!.setup!.values.name, 'Second');
    assert.equal(f.receipts.find(r => r.replacementRequested)?.replacementRequested?.setup.values.name, 'Second');
    await s.end();
});

for (const phase of ['request', 'closing'] as const) test(`failed ${phase} persistence retains old custody without cleanup or replacement`, async () => {
    let blocked = true;
    const f = configuredFixture({ write: async r => {
        if (blocked && r.replacementRequested && (phase === 'request' || r.activity === 'closing')) throw Error('storage unavailable');
    } });
    const s = await f.open(), v = s.view();
    s.command({ runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart', checkpointId: 'second', setup: namedSetup('Candidate') } });
    await s.settled();
    assert.equal(f.created.length, 1);
    assert.equal(f.calls.some(call => call.startsWith('cleanup:')), false);
    assert.equal(f.calls.includes('close'), false);
    assert.equal(s.currentResult().runRef, v.runRef);
    assert.equal(s.currentResult().setup!.values.name, 'Original');
    assert.equal(s.currentResult().replacementRequested!.setup.values.name, 'Candidate');
    assert.equal(s.currentResult().failures.at(-1)?.code, 'persistence-failed');
    blocked = false;
    await s.end();
});

for (const terminate of ['end', 'signal'] as const) test(`${terminate} while retaining candidate prevents replacement acquisition`, async () => {
    const writing = latch(), gate = latch(), abort = new AbortController();
    let held = false;
    const f = configuredFixture({ write: async r => {
        if (r.replacementRequested && !held) { held = true; writing.release(); await gate.promise; }
    } });
    const s = await f.open(undefined, abort.signal), v = s.view();
    s.command({ runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart', checkpointId: 'second', setup: namedSetup('Candidate') } });
    await writing.promise;
    if (terminate === 'signal') abort.abort();
    const ending = s.end();
    gate.release();
    await ending;
    assert.equal(f.created.length, 1);
    assert.equal(f.calls.filter(call => call === 'cleanup:Original').length, 1);
    assert.equal(s.currentResult().replacementRequested!.setup.values.name, 'Candidate');
});

for (const failure of ['cleanupFails', 'closeFails'] as const) test(`${failure} prevents replacement and retains both requested setups`, async () => {
    const faults = { [failure]: true }, f = configuredFixture(faults), s = await f.open(), v = s.view();
    s.command({ runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart', checkpointId: 'first', setup: namedSetup('Candidate') } });
    await s.settled();
    await assertHeld(s, v.runRef!);
    const held = s.currentResult();
    assert.equal(held.setup!.values.name, 'Original');
    assert.equal(held.replacementRequested!.setup.values.name, 'Candidate');
    faults[failure] = false;
    const result = await s.end();
    assert.equal(await s.done, result);
    assert.equal(f.created.length, 1);
    assert.equal(result.setup!.values.name, 'Original');
    assert.equal(result.replacementRequested!.setup.values.name, 'Candidate');
    assert.equal(result.outcome, 'incomplete');
});

test('replacement browser failure has a new run identity with persisted setup and old lineage', async () => {
    const f = configuredFixture({ replacementBrowserFails: true }), s = await f.open(), v = s.view();
    s.command({ runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart', checkpointId: 'second', setup: namedSetup('Candidate') } });
    await s.settled();
    const result = await s.done;
    assert.notEqual(result.runRef, v.runRef);
    assert.equal(result.previousRunRef, v.runRef);
    assert.equal(result.setup!.values.name, 'Candidate');
    assert.equal(result.target, 'second');
    assert.equal(f.created.length, 1);
    assert.equal(f.receipts.some(r => r.runRef === result.runRef && r.activity === 'preparing' && r.setup?.values.name === 'Candidate'), true);
});

function evidencePage(options: { url?: string; body?: string } = {}): Page {
    return {
        url: () => options.url ?? 'http://localhost:3000/tasks',
        screenshot: async () => Buffer.from('png'),
        evaluate: async () => options.body ?? 'Tasks'
    } as unknown as Page;
}
function failingJourney(fail: { enter?: string; verify?: () => boolean }) {
    let current = 'first';
    return {
        id: 'evidence', title: 'Evidence', checkpoints: ['first', 'second'].map(id => ({ id, title: id === 'first' ? 'First' : 'Second' })),
        create: (): JourneyDriver => ({
            enter: async id => { if (fail.enter === id) throw Error('Button "Save" was not found\n  Call log: waiting for getByRole("button")'); current = id; },
            verify: async id => { if (id === 'second' && fail.verify?.()) throw Error('Task was not saved'); },
            reconcile: async () => current, cleanup: async () => 'complete'
        })
    };
}
test('a failed stage keeps local evidence and the receipt only a relative path to it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moments-evidence-'));
    try {
        let failed: MomentResult | undefined;
        await assert.rejects(openWithBrowser({
            baseURL: 'http://localhost:3000', beforeRun: async () => {}, outputDir: join(root, 'runs'),
            journeys: [failingJourney({ enter: 'second' })]
        }, { target: 'evidence.second' }, async () => ({ page: evidencePage({ body: ' \n' }), close: async () => {} })),
        (error: unknown) => { failed = (error as { result: MomentResult }).result; return true; });
        const failure = failed!.failures[0]!;
        assert.equal(failure.evidence, `${failed!.runRef}/enter-second.txt`);
        const receipt = JSON.parse(await readFile(join(root, 'runs', `${failed!.runRef}.json`), 'utf8')) as MomentResult;
        assert.equal(receipt.schemaVersion, 3);
        assert.equal(receipt.failures[0]!.evidence, failure.evidence);
        const text = await readFile(join(root, 'evidence', failure.evidence!), 'utf8');
        assert.equal(text.split('\n')[0], 'Button "Save" was not found. The page was blank: the application server may not be responding.');
        assert.match(text, /URL: http:\/\/localhost:3000\/tasks/);
        assert.match(text, /Call log: waiting for getByRole/);
        const png = join(root, 'evidence', failed!.runRef, 'enter-second.png');
        assert.equal(await readFile(png, 'utf8'), 'png');
        assert.equal((await stat(png)).mode & groupOther, 0);
        assert.equal((await stat(join(root, 'evidence', failure.evidence!))).mode & groupOther, 0);
        assert.equal((await stat(join(root, 'evidence', failed!.runRef))).mode & groupOther, 0);
        assert.ok(!JSON.stringify(receipt).includes('Save'), 'The receipt carries no thrown message');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('a held failure shows its one-line detail and evidence; repeats never overwrite earlier evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moments-evidence-'));
    try {
        const s = await openWithBrowser({
            baseURL: 'http://localhost:3000', beforeRun: async () => {}, writeReceipt: async () => {}, evidenceDir: root,
            journeys: [failingJourney({ verify: () => true })]
        }, { target: 'evidence.first' }, async () => ({ page: evidencePage(), close: async () => {} }));
        const send = (kind: 'continue' | 'check') => { const v = s.view(); return s.command({ runRef: v.runRef!, revision: v.revision, command: { kind } }); };
        send('continue');
        await s.settled();
        const runRef = s.currentResult().runRef;
        assert.deepEqual(s.view().failure, { stage: 'verify', checkpointId: 'second', detail: 'Task was not saved', evidence: join(root, runRef, 'verify-second.txt') });
        assert.equal(send('check').accepted, true);
        await s.settled();
        assert.deepEqual(s.currentResult().failures.map(failure => failure.evidence), [`${runRef}/verify-second.txt`, `${runRef}/verify-second-2.txt`]);
        await s.end();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('evidenceDir false keeps failures without evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moments-evidence-'));
    try {
        let failed: MomentResult | undefined;
        await assert.rejects(openWithBrowser({
            baseURL: 'http://localhost:3000', beforeRun: async () => {}, outputDir: join(root, 'runs'), evidenceDir: false,
            journeys: [failingJourney({ enter: 'second' })]
        }, { target: 'evidence.second' }, async () => ({ page: evidencePage(), close: async () => {} })),
        (error: unknown) => { failed = (error as { result: MomentResult }).result; return true; });
        assert.equal(failed!.failures[0]!.evidence, undefined);
        await assert.rejects(stat(join(root, 'evidence')), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('configured page timeouts are applied before the journey is created', async () => {
    const calls: string[] = [];
    const page = {
        setDefaultNavigationTimeout: (ms: number) => { calls.push(`navigation:${ms}`); },
        setDefaultTimeout: (ms: number) => { calls.push(`action:${ms}`); }
    } as unknown as Page;
    const s = await openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => {}, writeReceipt: async () => {},
        navigationTimeoutMs: 120_000, actionTimeoutMs: 60_000,
        journeys: [{ id: 'timeouts', title: 'Timeouts', checkpoints: [{ id: 'first', title: 'First' }],
            create: () => { calls.push('create'); return { enter: async () => {}, verify: async () => {}, reconcile: async () => 'first', cleanup: async () => 'complete' }; } }]
    }, { target: 'timeouts.first' }, async () => ({ page, close: async () => {} }));
    assert.deepEqual(calls, ['navigation:120000', 'action:60000', 'create']);
    await s.end();
});
function resumable(existing: Set<string>) {
    const calls: string[] = [];
    const page = {
        setDefaultNavigationTimeout: (ms: number) => { calls.push(`navigation:${ms}`); },
        setDefaultTimeout: (ms: number) => { calls.push(`action:${ms}`); }
    } as unknown as Page;
    const journey = { id: 'resume', title: 'Resume', checkpoints: ['a', 'b', 'c', 'd'].map(id => ({ id, title: id.toUpperCase() })),
        create: (): JourneyDriver => ({
            enter: async id => { calls.push(`enter:${id}`); existing.add(id); },
            verify: async id => { calls.push(`verify:${id}`); if (!existing.has(id)) throw Error(`${id} is not there`); },
            reconcile: async () => 'a', cleanup: async () => 'complete'
        }) };
    return { calls, page, journey };
}
test('resume records existing prerequisites without entering them and enters from the first that fails', async () => {
    const { calls, page, journey } = resumable(new Set(['a', 'b', 'd']));
    const s = await openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => {}, writeReceipt: async () => {},
        navigationTimeoutMs: 120_000, journeys: [journey]
    }, { target: 'resume.d', resume: true }, async () => ({ page, close: async () => {} }));
    const probe = (id: string) => ['navigation:3000', 'action:3000', `verify:${id}`, 'navigation:120000', 'action:30000'];
    assert.deepEqual(calls, ['navigation:120000', ...probe('a'), ...probe('b'), ...probe('c'), 'enter:c', 'verify:c', 'enter:d', 'verify:d'],
        'Probing stops at the first absent checkpoint; later ones are entered even if a stale verify would pass');
    const result = await s.end();
    assert.deepEqual(result.observations.map(o => `${o.checkpointId}:${o.provenance}:${o.status}`), ['a:existing:passed', 'b:existing:passed', 'c:native:passed', 'd:native:passed']);
    assert.deepEqual(result.failures, []);
    assert.equal(result.outcome, 'complete');
});
test('resume probes the target too, with the configured probe timeout', async () => {
    const { calls, page, journey } = resumable(new Set(['a', 'b']));
    const s = await openWithBrowser({
        baseURL: 'http://localhost:3000', beforeRun: async () => {}, writeReceipt: async () => {},
        resumeProbeTimeoutMs: 500, actionTimeoutMs: 60_000, journeys: [journey]
    }, { target: 'resume.b', resume: true }, async () => ({ page, close: async () => {} }));
    assert.deepEqual(calls.filter(call => !call.startsWith('verify:')), ['action:60000', 'navigation:500', 'action:500', 'navigation:60000', 'action:60000', 'navigation:500', 'action:500', 'navigation:60000', 'action:60000']);
    assert.deepEqual((await s.end()).observations.map(o => o.provenance), ['existing', 'existing']);
});
function filmedPage(failStart = false) {
    const state = { filming: false };
    const page = {
        screencast: {
            start: async ({ onFrame }: { onFrame(frame: { data: Buffer }): void }) => {
                if (failStart) throw Error('encoder unavailable');
                state.filming = true;
                onFrame({ data: Buffer.from('jpeg') });
            },
            stop: async () => { state.filming = false; },
            showChapter: async () => {}
        },
        isClosed: () => false, setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {}
    };
    return { state, page: page as unknown as Page };
}
function filmedJourney(state: { filming: boolean }, seen: string[]) {
    return {
        id: 'filmed', title: 'Filmed',
        checkpoints: [{ id: 'public', title: 'Public' }, { id: 'secret', title: 'Secret', private: true }, { id: 'after', title: 'After' }],
        create: (): JourneyDriver => ({
            enter: async id => { seen.push(`enter ${id} ${state.filming}`); },
            verify: async id => { seen.push(`verify ${id} ${state.filming}`); },
            reconcile: async () => { seen.push(`reconcile ${state.filming}`); return 'public'; }, cleanup: async () => 'complete'
        })
    };
}
test('a private checkpoint is never filmed, and filming resumes at the next checkpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moments-record-'));
    try {
        const { state, page } = filmedPage(), seen: string[] = [];
        const session = await openWithBrowser({ baseURL: 'http://localhost:3000', beforeRun: async () => {}, evidenceDir: dir, journeys: [filmedJourney(state, seen)], writeReceipt: async () => {} },
            { target: 'filmed.after', once: true, record: {} }, async () => ({ page, close: async () => {} }));
        const result = await session.done;
        assert.deepEqual(seen, ['enter public true', 'verify public true', 'enter secret false', 'verify secret false', 'enter after true', 'verify after true']);
        assert.equal(state.filming, false);
        const timeline = JSON.parse(await readFile(join(dir, result.runRef, 'recording', 'timeline.json'), 'utf8'));
        assert.deepEqual(timeline.segments.map((s: { file: string }) => s.file), ['segment-1.webm', 'segment-2.webm']);
        assert.deepEqual(timeline.events.flatMap((e: { frame?: string }) => e.frame ?? []), ['public.jpg', 'after.jpg']);
        // Marks carry the receipt's own observation times, so a film can be checked against the receipt.
        assert.deepEqual(timeline.events.filter((e: { kind: string }) => e.kind === 'observed').map((e: { at: string }) => e.at), result.observations.map(o => o.at));
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test('a recording failure never fails the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moments-record-'));
    try {
        const { state, page } = filmedPage(true);
        const session = await openWithBrowser({ baseURL: 'http://localhost:3000', beforeRun: async () => {}, evidenceDir: dir, journeys: [filmedJourney(state, [])], writeReceipt: async () => {} },
            { target: 'filmed.after', once: true, record: {} }, async () => ({ page, close: async () => {} }));
        const result = await session.done;
        assert.equal(result.outcome, 'complete');
        assert.equal(JSON.parse(await readFile(join(dir, result.runRef, 'recording', 'timeline.json'), 'utf8')).stoppedEarly, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test('checks that may show a private checkpoint are never filmed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moments-record-'));
    try {
        // Resume probes each checkpoint with verify and no enter.
        const resumed = filmedPage(), probed: string[] = [];
        const first = await openWithBrowser({ baseURL: 'http://localhost:3000', beforeRun: async () => {}, evidenceDir: dir, journeys: [filmedJourney(resumed.state, probed)], writeReceipt: async () => {} },
            { target: 'filmed.after', once: true, resume: true, record: {} }, async () => ({ page: resumed.page, close: async () => {} }));
        assert.equal((await first.done).outcome, 'complete');
        assert.deepEqual(probed.filter(call => call.includes('secret')), ['verify secret false']);
        // Check asks the driver where the run is; a driver may verify later, private checkpoints to answer.
        const held = filmedPage(), checked: string[] = [];
        const s = await openWithBrowser({ baseURL: 'http://localhost:3000', beforeRun: async () => {}, evidenceDir: dir, journeys: [filmedJourney(held.state, checked)], writeReceipt: async () => {} },
            { target: 'filmed.public', record: {} }, async () => ({ page: held.page, close: async () => {} }));
        await s.settled();
        assert.equal(held.state.filming, true);
        const v = s.view();
        assert.equal(s.command({ runRef: v.runRef!, revision: v.revision, command: { kind: 'check' } }).accepted, true);
        await s.settled();
        assert.deepEqual(checked.filter(call => call.startsWith('reconcile')), ['reconcile false']);
        await s.end();
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test('a failed prerequisite keeps the author\'s own message as local evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moments-evidence-'));
    try {
        let failed: MomentResult | undefined;
        await assert.rejects(openWithBrowser({ baseURL: 'http://localhost:3000', outputDir: join(root, 'runs'),
            beforeRun: async () => { throw Error('Start the task app first: npm start'); }, journeys: [failingJourney({})] },
            { target: 'evidence.first', once: true }, async () => { throw Error('no browser expected'); }), (error: { result?: MomentResult }) => { failed = error.result; return true; });
        const failure = failed!.failures[0]!;
        assert.equal(failure.stage, 'admission');
        const text = await readFile(join(root, 'evidence', failure.evidence!), 'utf8');
        assert.equal(text.split('\n')[0], 'Start the task app first: npm start');
        assert.match(text, /Screenshot: not available \(no page was open\)/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
test('the receipt names the system, the actors and what each checkpoint proves', async () => {
    const receipts: MomentResult[] = [];
    const journey = { ...failingJourney({}), checkpoints: [
        { id: 'first', title: 'First', actor: 'Amina Bello, Desk Officer', covers: ['AJ-07', 'REQ-112'] },
        { id: 'second', title: 'Second', private: true }] };
    const s = await openWithBrowser({ baseURL: 'http://127.0.0.1:4177/app?x=1', environment: 'Task app, local', beforeRun: async () => {}, journeys: [journey],
        writeReceipt: async r => { receipts.push(r); } }, { target: 'evidence.first', once: true }, async () => ({ page: evidencePage(), close: async () => {} }));
    const result = await s.done;
    assert.equal(result.environment, 'Task app, local');
    assert.equal(result.origin, 'http://127.0.0.1:4177');
    assert.equal(result.journeyTitle, 'Evidence');
    assert.deepEqual(result.checkpoints, [
        { id: 'first', title: 'First', actor: 'Amina Bello, Desk Officer', covers: ['AJ-07', 'REQ-112'] }, { id: 'second', title: 'Second', private: true }]);
    assert.ok(receipts.length > 0);
    await assert.rejects(openWithBrowser({ baseURL: 'http://127.0.0.1:4177', beforeRun: async () => {},
        journeys: [{ ...journey, checkpoints: [{ id: 'first', title: 'First', covers: ['AJ 07'] }] }] }, { target: 'evidence.first', once: true }, async () => ({ page: evidencePage(), close: async () => {} })), /Invalid checkpoint/);
});
