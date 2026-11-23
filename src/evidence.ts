import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { FailureStage, MomentsConfig } from './types.js';

export const BLANK_PAGE = 'The page was blank: the application server may not be responding.';
/** Stages that run driver code against the managed page; the others keep their safe description only. */
export const EVIDENCE_STAGES: readonly FailureStage[] = ['create', 'enter', 'verify', 'reconcile', 'cleanup'];
export type FailureEvidence = { summary: string; relative: string; file: string };

/** Local evidence directory, or undefined when disabled or a custom receipt writer has no filesystem home. */
export function evidenceRoot(config: Pick<MomentsConfig, 'evidenceDir' | 'outputDir' | 'writeReceipt'>): string | undefined {
    if (config.evidenceDir === false) return undefined;
    if (config.evidenceDir !== undefined) return path.resolve(config.evidenceDir);
    if (config.writeReceipt) return undefined;
    return path.resolve(config.outputDir ?? '.moments/runs', '..', 'evidence');
}

function within<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Timed out')), milliseconds); })])
        .finally(() => clearTimeout(timer));
}
const firstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? '';

/** Writes `<root>/<runRef>/<stem>.{txt,png}` (dirs 0700, files 0600). The first text line is the one-line summary. */
export async function captureEvidence(root: string, runRef: string, stem: string, page: Page | undefined, error: unknown): Promise<FailureEvidence> {
    // Playwright colours some messages; evidence is read as plain text.
    const message = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, '').trim() || 'No message was thrown.';
    let url = 'not available', blank = false;
    try { url = page!.url(); } catch { /* the page may be gone */ }
    try { blank = !(await within(page!.evaluate(() => document.body?.innerText ?? ''), 2_000)).trim(); } catch { /* unknown is not blank */ }
    const line = firstLine(message);
    const summary = blank ? `${line}${/[.!?]$/.test(line) ? '' : '.'} ${BLANK_PAGE}` : line;
    const directory = path.join(root, runRef);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let screenshot: string;
    try {
        const png = path.join(directory, `${stem}.png`);
        await writeFile(png, await page!.screenshot({ fullPage: true, timeout: 5_000 }), { mode: 0o600 });
        screenshot = png;
    } catch (failure) {
        screenshot = `not available (${firstLine(failure instanceof Error ? failure.message : String(failure))})`;
    }
    const file = path.join(directory, `${stem}.txt`);
    await writeFile(file, `${summary}\nURL: ${url}\nScreenshot: ${screenshot}\n\n${message}\n`, { mode: 0o600 });
    return { summary, relative: `${runRef}/${stem}.txt`, file };
}
