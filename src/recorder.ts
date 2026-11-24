import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { JourneyDefinition, MomentEvent } from './types.js';

/** Layout size while recording. Pixels are doubled so the 1080p video stays sharp. */
export const RECORDING_VIEWPORT = { width: 1280, height: 720 } as const;
const VIDEO_SIZE = { width: 1920, height: 1080 } as const;
const CHAPTER_MS = 2_000;
type Mark = MomentEvent & { segment?: number; offsetMs?: number; frame?: string };
export type Recorder = { observe(event: MomentEvent): Promise<void>; finish(): Promise<void> };

/**
 * Records one run into `dir`: a WebM segment per stretch between private checkpoints, the video
 * frame showing each verified checkpoint, and `timeline.json` tying both to the receipt's times.
 * Frames come from the video stream: a page screenshot would disturb the recording. Best effort:
 * the first error stops recording with one warning and never reaches the run.
 */
export function createRecorder(page: Page, dir: string, journey: JourneyDefinition, runRef: string, chapters: boolean): Recorder {
    const segments: { file: string; startedAt: string; lost?: true }[] = [], events: Mark[] = [], frames = new Set<string>();
    let started: number | undefined, stoppedEarly = false, finished = false, latest: Buffer | undefined;
    const checkpoint = (id: string) => journey.checkpoints.find(point => point.id === id);
    async function attempt(work: () => Promise<void>) {
        if (stoppedEarly || finished) return;
        try { await work(); }
        catch {
            stoppedEarly = true;
            started = undefined;
            process.stderr.write(page.isClosed()
                ? 'Moments: the browser closed while filming, so the last recording segment is lost. End the session with End to keep it.\n'
                : 'Moments: recording stopped after an error; the run continues.\n');
            await page.screencast.stop().catch(() => { });
        }
    }
    return {
        observe: event => attempt(async () => {
            if (event.kind !== 'progress') {
                // The privacy of the checkpoint the run last touched decides whether the screen is filmed.
                if (checkpoint(event.checkpointId)?.private) {
                    if (started !== undefined) { started = undefined; await page.screencast.stop(); }
                } else if (started === undefined) {
                    await mkdir(dir, { recursive: true, mode: 0o700 });
                    const file = `segment-${segments.length + 1}.webm`;
                    latest = undefined;
                    await page.screencast.start({ path: path.join(dir, file), size: VIDEO_SIZE, onFrame: ({ data }) => { latest = data; } });
                    started = Date.now();
                    segments.push({ file, startedAt: new Date(started).toISOString() });
                }
            }
            const mark: Mark = started === undefined ? { ...event }
                : { ...event, segment: segments.length - 1, offsetMs: Math.max(0, Date.parse(event.at) - started) };
            events.push(mark);
            if (event.kind !== 'observed' || event.status !== 'passed' || started === undefined) return;
            if (latest) {
                let frame = `${event.checkpointId}.jpg`;
                for (let n = 2; frames.has(frame); n++) frame = `${event.checkpointId}-${n}.jpg`;
                frames.add(frame);
                await writeFile(path.join(dir, frame), latest, { mode: 0o600 });
                mark.frame = frame;
            }
            const point = checkpoint(event.checkpointId)!;
            if (chapters) await page.screencast.showChapter(point.title, { ...(point.description ? { description: point.description } : {}), duration: CHAPTER_MS });
        }),
        async finish() {
            await attempt(async () => { if (started !== undefined) { started = undefined; await page.screencast.stop(); } });
            finished = true;
            try {
                await mkdir(dir, { recursive: true, mode: 0o700 });
                for (const segment of segments) {
                    const file = path.join(dir, segment.file);
                    if (await stat(file).then(() => true, () => false)) await chmod(file, 0o600);
                    else segment.lost = true;
                }
                const timeline = {
                    schemaVersion: 1, runRef, journeyId: journey.id, viewport: RECORDING_VIEWPORT, videoSize: VIDEO_SIZE,
                    ...(chapters ? { chapterMs: CHAPTER_MS } : {}), ...(stoppedEarly ? { stoppedEarly } : {}),
                    checkpoints: journey.checkpoints.map(({ id, title, description, private: secret }) => ({ id, title, ...(description ? { description } : {}), ...(secret ? { private: true } : {}) })),
                    segments, events
                };
                await writeFile(path.join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n', { mode: 0o600 });
            } catch {
                process.stderr.write('Moments: the recording timeline could not be written.\n');
            }
        }
    };
}
