import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { chromium, type Page } from '@playwright/test';
import { DIRECTOR_ORIGIN, openBrowser } from './browser.js';
import { PACKAGE_VERSION, type MomentCommandRequest, type MomentsView } from './internal/protocol.js';
import { openWithBrowser } from './runner.js';

// Real headless Chromium against the built Director bundle: run `npm run build` first.
test.before(async () => {
    await stat(new URL('../dist/director/director.js', import.meta.url)).catch(() => {
        throw Error('dist/director/director.js is missing. Build Moments before running the browser tests.');
    });
    // Fail fast: a missing browser otherwise waits out Playwright's launch timeout in every test.
    await stat(chromium.executablePath()).catch(() => { throw Error('Chromium is missing. Run npx playwright install chromium first.'); });
});
async function serve(): Promise<{ origin: string; close(): Promise<void> }> {
    const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>App</title><p>App</p>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise(resolve => server.close(() => resolve())) };
}
function fakeControls() {
    const commands: MomentCommandRequest[] = [];
    const view: MomentsView = {
        sessionId: 's', runRef: 'r', revision: 1, journey: { id: 'j', title: 'Journey' },
        checkpoints: [{ id: 'first', title: 'First', description: 'Shown as caption', status: 'passed', opening: 'reuse' }],
        controls: { check: false, continue: true, restart: false, end: true, play: false, pause: false },
        playback: { kind: 'idle' }, lastVerified: { checkpointId: 'first', at: '2026-01-01T00:00:00.000Z' }, activity: 'ready'
    };
    return { view, commands, controls: { read: () => view, command: (request: MomentCommandRequest) => { commands.push(request); return { accepted: true } as const; } } };
}
function directorOf(page: Page): Page {
    const director = page.context().browser()!.contexts().flatMap(context => context.pages()).find(item => item.url().startsWith(DIRECTOR_ORIGIN));
    assert.ok(director, 'Director window is open');
    return director;
}
const bridgeTypes = (page: Page) => page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;
    return [scope.moments, scope.__momentsRead, scope.__momentsCommand].map(value => typeof value);
});
test('Director on: app pages have no controls on any origin', async () => {
    const a = await serve();
    const { commands, controls } = fakeControls();
    const owned = await openBrowser({ baseURL: a.origin, headless: true, director: true }, controls, () => {});
    try {
        await owned.page.goto(a.origin);
        assert.deepEqual(await bridgeTypes(owned.page), ['undefined', 'undefined', 'undefined']);
        // Red team: the app cannot reach the Director origin; Chromium commits its error page instead.
        await owned.page.goto(`${DIRECTOR_ORIGIN}/`).catch(() => {});
        await owned.page.waitForURL(/^chrome-error:/);
        assert.deepEqual(await bridgeTypes(owned.page), ['undefined', 'undefined', 'undefined']);
        assert.equal(commands.length, 0);
    } finally {
        await owned.close();
        await a.close();
    }
});
test('Director controls survive cross-origin navigation and render the caption', async () => {
    const a = await serve(), b = await serve();
    const { commands, controls } = fakeControls();
    let closes = 0;
    const owned = await openBrowser({ baseURL: a.origin, headless: true, director: true }, controls, () => { closes++; });
    try {
        await owned.page.goto(a.origin);
        await owned.page.goto(b.origin);
        const director = directorOf(owned.page);
        await director.getByText('Checkpoint 1 of 1: First', { exact: true }).waitFor();
        await director.getByText('Shown as caption', { exact: true }).first().waitFor();
        await director.getByRole('button', { name: 'End session', exact: true }).click();
        const deadline = Date.now() + 5000;
        while (!commands.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(commands.length, 1);
        assert.equal(commands[0]!.command.kind, 'end');
        assert.equal(commands[0]!.revision, 1);
    } finally {
        await owned.close();
        await a.close();
        await b.close();
    }
    assert.equal(closes, 0, 'The runner closing its own browser is not a user close');
});
test('closing the Director ends the session with cleanup', async () => {
    const a = await serve();
    let cleanups = 0, appPage: Page | undefined;
    try {
        const session = await openWithBrowser({
            baseURL: a.origin, director: true, beforeRun: async () => {}, writeReceipt: async () => {},
            journeys: [{
                id: 'director', title: 'Director', checkpoints: [{ id: 'first', title: 'First' }],
                create: ({ page }) => {
                    appPage = page;
                    return { enter: async () => { await page.goto(a.origin); }, verify: async () => {}, reconcile: async () => 'first',
                        cleanup: async () => { cleanups++; return 'complete'; } };
                }
            }]
        }, { target: 'director.first', headless: true }, openBrowser);
        await directorOf(appPage!).close();
        const result = await session.done;
        assert.equal(result.activity, 'closed');
        assert.equal(result.cleanup, 'complete');
        assert.equal(result.outcome, 'complete');
        assert.equal(cleanups, 1);
        assert.equal(appPage!.isClosed(), true);
    } finally {
        await a.close();
    }
});
test('Director off: the in-page bridge is unchanged', async () => {
    const a = await serve(), b = await serve();
    const { view, controls } = fakeControls();
    const owned = await openBrowser({ baseURL: a.origin, headless: true, director: false }, controls, () => {});
    try {
        await owned.page.goto(a.origin);
        const bridge = () => owned.page.evaluate(() => {
            const { moments } = window as unknown as { moments: { packageVersion: string; read(): Promise<MomentsView> } };
            return moments.read().then(read => ({ packageVersion: moments.packageVersion, read }));
        });
        assert.deepEqual(await bridge(), { packageVersion: PACKAGE_VERSION, read: view });
        await owned.page.goto(b.origin);
        await assert.rejects(bridge());
        assert.equal(owned.page.context().browser()!.contexts().length, 1);
    } finally {
        await owned.close();
        await a.close();
        await b.close();
    }
});
