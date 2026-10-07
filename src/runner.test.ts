import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from '@playwright/test';
import { openWithBrowser } from './runner.js';
import type { MomentResult, JourneyDriver } from './types.js';
import { MomentSetupError, validateSetupValues, type MomentSetup, type SetupDefinition } from './setup.js';
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
    }, { target: 'closed.first' }, async (_baseURL, _headless, _controls, onClose) => {
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
} = {}) {
    const calls: string[] = [];
    const receipts: MomentResult[] = [];
    let current = 'first';
    const driver: JourneyDriver = {
        enter: async (id) => { calls.push(`enter:${id}`); await options.enter?.(id); current = id; }, verify: async (id) => { calls.push(`verify:${id}`); await options.verify?.(id); }, reconcile: async () => current, cleanup: async () => {
            calls.push('cleanup');
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
for (const phase of ['initial', 'intermediate', 'closing', 'final'] as const)
    test(`writer ${phase} failure cannot skip finalization`, async () => {
        let failed = false;
        const f = fixture({ failWrite: r => {
                const match = phase === 'initial' ? r.activity === 'preparing' : phase === 'intermediate' ? r.observations.length > 0 && r.activity !== 'closing' && r.activity !== 'closed' : phase === 'closing' ? r.activity === 'closing' : r.activity === 'closed';
                if (match && !failed) {
                    failed = true;
                    return true;
                }
                return false;
            } });
        if (phase === 'initial' || phase === 'intermediate') {
            await assert.rejects(f.open());
            assert.equal(f.calls.includes('browser'), phase !== 'initial');
        }
        else {
            const s = await f.open();
            const result = await s.end();
            assert.equal(result.outcome, 'incomplete');
            assert.equal(await s.done, result);
        }
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
test('cleanup and browser failures both survive and completion settles', async () => { const f = fixture({
    cleanupFails: true, closeFails: true
}); const s = await f.open(); const r = await s.end(); assert.deepEqual(r.failures.map(x => x.stage), ['cleanup', 'close']); assert.equal(r.outcome, 'incomplete'); assert.equal((await s.done).runRef, r.runRef); });
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
test('failed predecessor cleanup settles done and cannot open replacement', async () => {
    const f = fixture({ cleanupFails: true });
    const s = await f.open();
    const v = s.view();
    s.command({
        runRef: v.runRef!, revision: v.revision, command: {
            kind: 'restart', checkpointId: 'first'
        }
    });
    await s.settled();
    const result = await s.done;
    assert.equal(result.activity, 'closed');
    assert.equal(s.view().activity, 'closed');
    assert.deepEqual(s.view().controls, {
        check: false, continue: false, play: false, pause: false, restart: false, end: false
    });
    assert.equal(f.calls.filter(x => x === 'browser').length, 1);
    assert.equal((await s.end()).runRef, result.runRef);
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
    const f = configuredFixture({ write: async r => {
        if (r.replacementRequested && (phase === 'request' || r.activity === 'closing')) throw Error('storage unavailable');
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
    const f = configuredFixture({ [failure]: true }), s = await f.open(), v = s.view();
    s.command({ runRef: v.runRef!, revision: v.revision,
        command: { kind: 'restart', checkpointId: 'first', setup: namedSetup('Candidate') } });
    await s.settled();
    const result = await s.done;
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
