import { readFile } from 'node:fs/promises';
import { BrowserSetupFailure } from './internal/browser-failure.js';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { PACKAGE_VERSION, parseMomentCommandRequest } from './internal/protocol.js';
import type { BrowserFactory, MomentControls } from './runner.js';
import { RECORDING_VIEWPORT } from './recorder.js';
/** Reserved, never-resolving origin. Every Director request is answered locally or aborted. */
export const DIRECTOR_ORIGIN = 'https://director.moments.invalid';
// One level below the package root from both src/ (tests via tsx) and dist/ (installed).
const dist = new URL('../dist/', import.meta.url);
const directorHtml = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Moments Director</title><link rel="stylesheet" href="/moments.css"><body class="moments-director"><div id="root"></div><script type="module" src="/director.js"></script></html>';
/** The only way controls reach a page: bindings that answer one owned main frame. */
async function exposeBridge(context: BrowserContext, owns: (page: Page, frame: Frame) => boolean, controls: MomentControls): Promise<void> {
    await context.exposeBinding('__momentsRead', ({ page, frame }) => {
        if (!owns(page, frame))
            throw Error('Moments unavailable');
        return controls.read();
    });
    await context.exposeBinding('__momentsCommand', ({ page, frame }, request: unknown) => {
        if (!owns(page, frame))
            throw Error('Moments unavailable');
        return controls.command(parseMomentCommandRequest(request));
    });
    await context.addInitScript({ content: `window.moments = { packageVersion: ${JSON.stringify(PACKAGE_VERSION)}, read: () => window.__momentsRead(), command: request => window.__momentsCommand(request) };` });
}
/** A separate context (its own window when headed) that holds the only bridge and loads nothing but its own assets. */
async function openDirector(browser: Browser, headless: boolean, controls: MomentControls): Promise<Page> {
    const assets = new Map([
        ['/', { contentType: 'text/html; charset=utf-8', body: directorHtml }],
        ['/director.js', { contentType: 'text/javascript; charset=utf-8', body: await readFile(new URL('director/director.js', dist), 'utf8') }],
        ['/moments.css', { contentType: 'text/css; charset=utf-8', body: await readFile(new URL('react/moments.css', dist), 'utf8') }]
    ]);
    const context = await browser.newContext(headless ? {} : { viewport: null });
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const asset = url.origin === DIRECTOR_ORIGIN ? assets.get(url.pathname) : undefined;
        return asset ? route.fulfill(asset) : route.abort();
    });
    let director: Page | undefined;
    await exposeBridge(context, (page, frame) => page === director && frame === page.mainFrame() && new URL(page.url()).origin === DIRECTOR_ORIGIN, controls);
    director = await context.newPage();
    await director.goto(`${DIRECTOR_ORIGIN}/`);
    return director;
}
/** Best effort, headed only: app on the left, Director in a 420px column on the right. */
async function arrangeWindows(app: Page, director: Page): Promise<void> {
    const area = await director.evaluate(() => ({ width: window.screen.availWidth, height: window.screen.availHeight }));
    const column = 420;
    for (const [page, bounds] of [
        [app, { left: 0, top: 0, width: area.width - column, height: area.height }],
        [director, { left: area.width - column, top: 0, width: column, height: area.height }]
    ] as const) {
        const cdp = await page.context().newCDPSession(page);
        try {
            const { windowId } = await cdp.send('Browser.getWindowForTarget');
            await cdp.send('Browser.setWindowBounds', { windowId, bounds });
        }
        finally {
            await cdp.detach();
        }
    }
}
export const openBrowser: BrowserFactory = async ({ baseURL, headless, director, record }, controls, onClose) => {
    const browser = await chromium.launch({
        headless, handleSIGINT: false, handleSIGTERM: false
    });
    let closing = false;
    try {
        const context = await browser.newContext({
            baseURL, ...(record ? { viewport: RECORDING_VIEWPORT, deviceScaleFactor: 2 } : !headless ? { viewport: null } : {})
        });
        let ownedPage: Page | undefined;
        const origin = new URL(baseURL).origin;
        if (!director)
            await exposeBridge(context, (page, frame) => page === ownedPage && frame === page.mainFrame() && new URL(page.url()).origin === origin, controls);
        const page = await context.newPage();
        ownedPage = page;
        page.on('close', () => {
            if (!closing)
                onClose();
        });
        const panel = director ? await openDirector(browser, headless, controls) : undefined;
        if (panel) {
            panel.on('close', () => {
                if (!closing)
                    onClose();
            });
            if (!headless)
                await arrangeWindows(page, panel).catch(() => { });
        }
        return {
            page, focus: () => page.bringToFront(), close: async () => {
                closing = true;
                let failed = false;
                try {
                    await context.close();
                }
                catch {
                    failed = true;
                }
                try {
                    await browser.close();
                }
                catch {
                    failed = true;
                }
                if (failed)
                    throw Error('Browser close failed');
            }
        };
    }
    catch {
        closing = true;
        let closeFailed = false;
        try {
            await browser.close();
        }
        catch {
            closeFailed = true;
        }
        throw new BrowserSetupFailure(closeFailed);
    }
};
