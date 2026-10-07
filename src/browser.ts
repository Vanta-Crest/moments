import { BrowserSetupFailure } from './internal/browser-failure.js';
import { chromium, type Page } from '@playwright/test';
import { PACKAGE_VERSION, parseMomentCommandRequest } from './internal/protocol.js';
import type { BrowserFactory } from './runner.js';
export const openBrowser: BrowserFactory = async (baseURL, headless, controls, onClose) => {
    const browser = await chromium.launch({
        headless, handleSIGINT: false, handleSIGTERM: false
    });
    try {
        const context = await browser.newContext({
            baseURL, ...(!headless ? { viewport: null } : {})
        });
        let ownedPage: Page | undefined;
        const origin = new URL(baseURL).origin;
        await context.exposeBinding('__momentsRead', ({ page, frame }) => {
            if (page !== ownedPage || frame !== page.mainFrame() || new URL(page.url()).origin !== origin)
                throw Error('Moments unavailable');
            return controls.read();
        });
        await context.exposeBinding('__momentsCommand', ({ page, frame }, request: unknown) => {
            if (page !== ownedPage || frame !== page.mainFrame() || new URL(page.url()).origin !== origin)
                throw Error('Moments unavailable');
            return controls.command(parseMomentCommandRequest(request));
        });
        await context.addInitScript({ content: `window.moments = { packageVersion: ${JSON.stringify(PACKAGE_VERSION)}, read: () => window.__momentsRead(), command: request => window.__momentsCommand(request) };` });
        const page = await context.newPage();
        ownedPage = page;
        let closing = false;
        page.on('close', () => {
            if (!closing)
                onClose();
        });
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
