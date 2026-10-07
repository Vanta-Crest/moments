import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { FailureStage, JourneyDefinition, JourneyDriver, MomentResult, MomentSession, MomentsConfig, OpenMomentOptions } from './types.js';
import { PACKAGE_VERSION, describeMomentFailure, parseMomentCommandRequest, type MomentCommandRequest, type MomentCommandReply, type MomentProgress, type MomentsView, type PlaybackView } from './internal/protocol.js';
import { createWriter } from './writer.js';
import { BrowserSetupFailure } from './internal/browser-failure.js';
import { MomentSetupError, resolveSetup, type MomentSetup } from './setup.js';
export type OwnedBrowser = {
    page: Page;
    focus?(): Promise<void>;
    close(): Promise<void>;
};
export type BrowserFactory = (baseURL: string, headless: boolean, controls: {
    read(): MomentsView;
    command(r: MomentCommandRequest): MomentCommandReply;
}, onClose: () => void) => Promise<OwnedBrowser>;
export class MomentOpenError extends Error {
    constructor(readonly result: MomentResult) { super('Moment initialization failed; inspect safe result'); this.name = 'MomentOpenError'; }
}
export function defineJourney<const I extends string>(definition: JourneyDefinition<I>): JourneyDefinition<I> {
    if (!/^[a-z][a-z0-9.-]{0,127}$/.test(definition.id) || !definition.title.trim() || !definition.checkpoints.length)
        throw Error('Invalid journey');
    const ids = new Set<string>();
    for (const p of definition.checkpoints) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(p.id) || ids.has(p.id) || !p.title.trim())
            throw Error('Invalid checkpoint');
        ids.add(p.id);
    }
    if (definition.setup === undefined) return definition;
    const defaults = resolveSetup(definition.setup)!;
    return {
        ...definition,
        setup: Object.freeze({
            ...definition.setup,
            fields: Object.freeze(definition.setup.fields.map(field => Object.freeze({ ...field }))),
            defaults: defaults.values
        })
    };
}
export async function openWithBrowser(config: MomentsConfig, options: OpenMomentOptions, factory: BrowserFactory): Promise<MomentSession> {
    if (typeof config.beforeRun !== 'function' || (config.outputDir !== undefined && config.writeReceipt !== undefined))
        throw Error('Invalid Moments configuration');
    const url = new URL(config.baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw Error('Invalid baseURL');
    const ids = new Set<string>();
    const journeys = config.journeys.map(j => defineJourney(j));
    for (const j of journeys) {
        if (ids.has(j.id))
            throw Error('Duplicate journey');
        ids.add(j.id);
    }
    const split = options.target.lastIndexOf('.'), definition = journeys.find(j => j.id === options.target.slice(0, split)), target = options.target.slice(split + 1);
    if (!definition?.checkpoints.some(p => p.id === target))
        throw Error('Unknown moment target');
    const setup = resolveSetup(definition.setup, options.setup);
    const session = new Session(config, options, definition, factory, createWriter(config), setup);
    await session.start(target);
    return session;
}
class Session implements MomentSession {
    private readonly sessionId = randomUUID();
    private revision = 0;
    private result!: MomentResult;
    private driver?: JourneyDriver;
    private browser?: OwnedBrowser;
    private position = -1;
    private destination?: string;
    private failure?: MomentsView['failure'];
    private stage: FailureStage = 'enter';
    private operation = Promise.resolve();
    private closing?: Promise<MomentResult>;
    private ending = false;
    private terminal = false;
    private playback: PlaybackView = { kind: 'idle' };
    private progress?: MomentProgress;
    private wakePlaybackWait?: () => void;
    private resolveDone!: (r: MomentResult) => void;
    readonly done = new Promise<MomentResult>(resolve => this.resolveDone = resolve);
    constructor(private config: MomentsConfig, private options: OpenMomentOptions, private definition: JourneyDefinition, private factory: BrowserFactory, private writer: (r: MomentResult) => Promise<void>, private initialSetup?: MomentSetup) { }
    currentResult() { return structuredClone(this.result); }
    private activity(activity: MomentResult['activity'], destination?: string) { this.result = {
        ...this.result, activity, updatedAt: new Date().toISOString()
    }; this.destination = destination; this.revision++; }
    private failureRecord(stage: FailureStage, checkpointId?: string, code: MomentResult['failures'][number]['code'] = 'operation-failed') {
        this.failure = {
            stage, ...(checkpointId ? { checkpointId } : {})
        };
        this.result = {
            ...this.result, failures: [...this.result.failures, {
                    stage, code, ...(checkpointId ? { checkpointId } : {}), at: new Date().toISOString()
                }], outcome: 'incomplete'
        };
    }
    private async persist() {
        try {
            await this.writer(this.currentResult());
        }
        catch {
            this.terminal = true;
            this.failureRecord('persist', undefined, 'persistence-failed');
            throw Error('Persistence failed');
        }
    }
    private async tryPersist() {
        try {
            await this.persist();
        }
        catch {
            process.stderr.write('Moments: result persistence failed; completion is incomplete.\n');
        }
    }
    /** A replacement must not destroy current custody when retention fails. */
    private async persistBeforeReplacementCleanup(): Promise<boolean> {
        try {
            await this.writer(this.currentResult());
            return true;
        } catch {
            this.failureRecord('persist', undefined, 'persistence-failed');
            this.activity('needs-attention', this.destination);
            process.stderr.write('Moments: replacement persistence failed; current run retained. Durable recovery was not established.\n');
            return false;
        }
    }
    async start(target: string) {
        this.operation = this.openRun(target, undefined, this.initialSetup);
        await this.operation;
        if (this.terminal || this.result.activity === 'needs-attention') {
            await this.end();
            throw new MomentOpenError(this.currentResult());
        }
        if (this.options.signal) {
            this.options.signal.addEventListener('abort', this.abort, { once: true });
            if (this.options.signal.aborted)
                this.abort();
        }
        if (this.options.once)
            void this.end();
    }
    private abort = () => { this.failureRecord('enter', this.destination, 'interrupted'); void this.end(); };
    private async openRun(target: string, previousRunRef?: string, setup?: MomentSetup) {
        const at = new Date().toISOString();
        this.result = {
            schemaVersion: 2, packageVersion: PACKAGE_VERSION, sessionId: this.sessionId, runRef: randomUUID(), journeyId: this.definition.id, target, ...(previousRunRef ? { previousRunRef } : {}), ...(setup ? { setup } : {}), activity: 'preparing', startedAt: at, updatedAt: at, observations: [], cleanup: 'not-attempted', failures: [], outcome: 'pending'
        };
        this.position = -1;
        this.driver = undefined;
        this.browser = undefined;
        this.failure = undefined;
        this.playback = { kind: 'idle' };
        this.progress = undefined;
        this.destination = target;
        this.revision++;
        try {
            this.stage = 'admission';
            this.checkActive();
            await this.config.beforeRun();
            this.checkActive();
            await this.persist();
            this.checkActive();
            this.stage = 'browser';
            this.browser = await this.factory(this.config.baseURL, this.options.headless ?? !!this.options.once, {
                read: () => this.view(), command: r => this.command(r)
            }, () => { void this.end(); });
            this.checkActive();
            this.stage = 'create';
            const runRef = this.result.runRef;
            this.driver = this.definition.create({
                page: this.browser.page, baseURL: this.config.baseURL, runRef, ...(setup ? { setup } : {}),
                reportProgress: progress => {
                    if (this.result.runRef !== runRef || this.ending || this.result.activity === 'closed') return;
                    if (this.progress !== progress) { this.progress = progress; this.revision++; }
                }
            });
            if (!this.driver || typeof this.driver.cleanup !== 'function')
                throw Error('Invalid synchronous driver');
            await this.advance(target, false);
            this.activity('ready');
            await this.persist();
            if (!(this.options.headless ?? !!this.options.once)) await this.browser.focus?.();
        }
        catch (error) {
            this.recordOperationFailure();
            if (error instanceof BrowserSetupFailure && error.closeFailed)
                this.failureRecord('close');
            this.terminal = true;
            this.activity('needs-attention', this.destination);
            await this.tryPersist();
        }
    }
    view(): MomentsView {
        const r = this.result, last = r?.observations.filter(x => x.status === 'passed').at(-1), available = !!r && !this.ending && !this.terminal && ['ready', 'needs-attention'].includes(r.activity), advance = available && !this.failure;
        return {
            sessionId: this.sessionId, runRef: r?.runRef, revision: this.revision, journey: {
                id: this.definition.id, title: this.definition.title,
                ...(this.definition.restartExplanation ? { restartExplanation: this.definition.restartExplanation } : {})
            }, activity: r?.activity ?? 'preparing', controls: {
                check: available && (!this.failure || this.failure.stage === 'verify' || this.failure.stage === 'reconcile') && this.position >= 0,
                continue: advance && this.position + 1 < this.definition.checkpoints.length,
                play: advance && this.position + 1 < this.definition.checkpoints.length,
                pause: !this.ending && this.playback.kind === 'playing' && !this.playback.pauseRequested,
                restart: available, end: !this.ending && r?.activity !== 'closed'
            }, playback: { ...this.playback }, ...(this.progress ? { progress: this.progress } : {}),
            ...(this.definition.setup && r.setup ? { setup: {
                schemaVersion: this.definition.setup.schemaVersion, fields: this.definition.setup.fields,
                defaults: this.definition.setup.defaults, active: r.setup
            } } : {}),
            ...(this.failure ? { failure: this.failure } : {}), ...(this.destination ? { destinationId: this.destination } : {}), ...(last ? { lastVerified: {
                    checkpointId: last.checkpointId, at: last.at
                } } : {}), ...(this.definition.checkpoints[this.position + 1] ? { nextId: this.definition.checkpoints[this.position + 1]!.id } : {}), checkpoints: this.definition.checkpoints.map((p, i) => ({
                id: p.id, title: p.title, description: p.description ?? '', status: r?.observations.filter(o => o.checkpointId === p.id).at(-1)?.status ?? 'not-checked', opening: !available || (!advance && i >= this.position) ? 'unavailable' : i < this.position ? 'fresh-run' : 'reuse'
            })), ...(this.failure ? { message: this.failure.stage === 'persist' && r.replacementRequested && this.driver
                ? 'Replacement was stopped because its receipt could not be saved. The current run is retained; durable recovery was not established. Restore receipt storage, then restart or end.'
                : describeMomentFailure(this.failure, this.definition.checkpoints.find(point => point.id === this.failure?.checkpointId)) } : {})
        };
    }
    command(input: MomentCommandRequest): MomentCommandReply {
        let request: MomentCommandRequest;
        try {
            request = parseMomentCommandRequest(input);
        }
        catch (error) {
            if (error instanceof MomentSetupError) return { accepted: false, reason: 'invalid-setup', issues: error.issues };
            return {
                accepted: false, reason: 'unavailable'
            };
        }
        if (request.runRef !== this.result?.runRef || request.revision !== this.revision)
            return {
                accepted: false, reason: 'stale'
            };
        if (this.ending || this.result.activity === 'closed')
            return {
                accepted: false, reason: 'unavailable'
            };
        if (request.command.kind === 'end') {
            void this.end();
            return { accepted: true };
        }
        if (request.command.kind === 'pause') {
            if (!this.view().controls.pause || this.playback.kind !== 'playing') return { accepted: false, reason: 'unavailable' };
            this.playback = { ...this.playback, pauseRequested: true };
            this.revision++;
            this.wakePlaybackWait?.();
            return { accepted: true };
        }
        if (!['ready', 'needs-attention'].includes(this.result.activity))
            return {
                accepted: false, reason: 'busy'
            };
        const command = request.command, view = this.view();
        if (command.kind === 'open' ? view.checkpoints.find(p => p.id === command.checkpointId)?.opening === undefined || view.checkpoints.find(p => p.id === command.checkpointId)?.opening === 'unavailable' : !view.controls[command.kind])
            return {
                accepted: false, reason: 'unavailable'
            };
        const target = command.kind === 'check' ? (this.failure?.stage === 'verify' ? this.destination : this.definition.checkpoints[this.position]?.id) : command.kind === 'continue' ? this.definition.checkpoints[this.position + 1]?.id : command.checkpointId;
        if (!target || !this.definition.checkpoints.some(p => p.id === target))
            return {
                accepted: false, reason: 'unavailable'
            };
        const replacement = command.kind === 'restart' || this.index(target) < this.position;
        let setup: MomentSetup | undefined;
        if (replacement) {
            try {
                setup = resolveSetup(this.definition.setup,
                    command.kind === 'restart' && command.setup !== undefined ? command.setup : this.result.setup);
            } catch (error) {
                if (error instanceof MomentSetupError) return { accepted: false, reason: 'invalid-setup', issues: error.issues };
                throw error;
            }
        }
        if (command.kind === 'play') {
            if (this.index(target) <= this.position) return { accepted: false, reason: 'unavailable' };
            this.playback = { kind: 'playing', targetId: target, pace: command.pace, phase: 'advancing', pauseRequested: false };
        }
        this.activity('working', target);
        if (replacement && setup) this.result = {
            ...this.result, replacementRequested: Object.freeze({ checkpointId: target, setup })
        };
        this.operation = Promise.resolve().then(async () => {
            try {
                if (command.kind === 'check') {
                    if (this.failure?.stage === 'reconcile') await this.reconcilePosition(true);
                    else {
                        this.stage = 'verify';
                        await this.driver!.verify(target);
                        for (let i = this.position + 1; i < this.index(target); i++)
                            await this.record(i, 'manual', 'skipped');
                        await this.record(this.index(target), 'manual', 'passed');
                        this.position = this.index(target);
                    }
                }
                else if (replacement) {
                    if (setup && !await this.persistBeforeReplacementCleanup()) return;
                    if (this.ending) return;
                    const previous = this.result.runRef;
                    if (!await this.closeRun(!!setup)) return;
                    if (this.terminal)
                        return;
                    if (!this.ending)
                        await this.openRun(target, previous, setup);
                    if (this.terminal)
                        return;
                }
                else if (command.kind === 'play') await this.playTo(target);
                else await this.advance(target, true, command.kind === 'continue');
                if (!this.ending) {
                    this.playback = { kind: 'idle' };
                    this.progress = undefined;
                    this.failure = undefined;
                    this.activity('ready');
                    await this.persist();
                }
            }
            catch {
                this.playback = { kind: 'idle' };
                this.progress = undefined;
                this.recordOperationFailure();
                this.activity('needs-attention', this.destination);
                await this.tryPersist();
            }
        }).then(() => {
            if (this.terminal && !this.ending)
                void this.end();
        });
        return { accepted: true };
    }
    private recordOperationFailure() {
        if (this.terminal) return;
        this.failureRecord(this.stage, this.destination, this.ending || this.options.signal?.aborted ? 'interrupted' : 'operation-failed');
        if (this.stage === 'verify') {
            this.result = {
                ...this.result,
                observations: [...this.result.observations, {
                    checkpointId: this.destination!,
                    at: new Date().toISOString(),
                    provenance: 'native',
                    status: 'failed'
                }]
            };
        } else if (this.stage !== 'reconcile') {
            this.terminal = true;
        }
    }
    private checkActive() {
        this.options.signal?.throwIfAborted();
        if (this.ending) throw Error('Moment ending');
    }
    settled() { return this.operation; }
    private index(id: string) {
        const n = this.definition.checkpoints.findIndex(p => p.id === id);
        if (n < 0)
            throw Error('Unknown checkpoint');
        return n;
    }
    private async record(index: number, provenance: 'native' | 'manual', status: 'passed' | 'skipped') { this.result = {
        ...this.result, observations: [...this.result.observations, {
                checkpointId: this.definition.checkpoints[index]!.id, at: new Date().toISOString(), provenance, status
            }]
    }; await this.persist(); }
    private async advance(target: string, reconcile: boolean, continuing = false) {
        if (reconcile) {
            const adopted = await this.reconcilePosition();
            if (adopted && (continuing || this.position >= this.index(target))) return;
        }
        const end = this.index(target);
        if (end === this.position) {
            this.stage = 'verify';
            await this.driver!.verify(target);
            await this.record(end, 'manual', 'passed');
            return;
        }
        for (let i = this.position + 1; i <= end; i++) {
            if (this.ending) return;
            await this.enterAndVerify(i);
        }
    }
    private async reconcilePosition(verifyHeld = false) {
        this.stage = 'reconcile';
        const observed = this.index(await this.driver!.reconcile());
        if (observed < this.position) throw Error('Reconciliation moved behind');
        const adopted = observed > this.position;
        if (adopted || verifyHeld) {
            this.destination = this.definition.checkpoints[observed]!.id;
            this.stage = 'verify';
            await this.driver!.verify(this.destination);
            for (let i = this.position + 1; i < observed; i++) await this.record(i, 'manual', 'skipped');
            await this.record(observed, 'manual', 'passed');
            this.position = observed;
        }
        return adopted;
    }
    private async enterAndVerify(index: number) {
        this.checkActive();
        this.destination = this.definition.checkpoints[index]!.id;
        this.revision++;
        this.stage = 'enter';
        await this.driver!.enter(this.destination);
        this.stage = 'verify';
        await this.driver!.verify(this.destination);
        await this.record(index, 'native', 'passed');
        this.position = index;
    }
    private playbackStopped() { return this.ending || this.playback.kind !== 'playing' || this.playback.pauseRequested; }
    private async playTo(target: string) {
        while (!this.playbackStopped()) {
            await this.reconcilePosition();
            if (this.playbackStopped() || this.position >= this.index(target)) return;
            await this.enterAndVerify(this.position + 1);
            if (this.playbackStopped() || this.position >= this.index(target)) return;
            if (this.playback.kind === 'playing' && this.playback.pace === 'demo') await this.waitBetweenSteps();
        }
    }
    private async waitBetweenSteps() {
        if (this.playback.kind !== 'playing' || this.playbackStopped()) return;
        this.playback = { ...this.playback, phase: 'waiting' };
        this.revision++;
        await new Promise<void>(resolve => {
            const timer = setTimeout(finish, 3_000);
            const session = this;
            function finish() { clearTimeout(timer); session.wakePlaybackWait = undefined; resolve(); }
            this.wakePlaybackWait = finish;
        });
        if (this.playback.kind === 'playing') this.playback = { ...this.playback, phase: 'advancing' };
        this.revision++;
    }
    private async closeRun(protectReplacement = false): Promise<boolean> {
        if (this.result.activity === 'closed')
            return true;
        this.activity('closing');
        if (protectReplacement) {
            if (!await this.persistBeforeReplacementCleanup()) return false;
        } else await this.tryPersist();
        try {
            const cleanup = await this.driver?.cleanup() ?? 'complete';
            if (cleanup !== 'complete' && cleanup !== 'neutralized-with-residue')
                throw Error('Invalid cleanup');
            this.result = {
                ...this.result, cleanup
            };
        }
        catch {
            this.terminal = true;
            this.result = {
                ...this.result, cleanup: 'incomplete'
            };
            this.failureRecord('cleanup');
        }
        try {
            await this.browser?.close();
        }
        catch {
            this.terminal = true;
            this.failureRecord('close');
        }
        this.driver = undefined;
        this.browser = undefined;
        this.result = {
            ...this.result, outcome: this.result.failures.length ? 'incomplete' : this.result.cleanup === 'neutralized-with-residue' ? 'neutralized-with-residue' : 'complete'
        };
        this.activity('closed');
        await this.tryPersist();
        return true;
    }
    private finish() { this.options.signal?.removeEventListener('abort', this.abort); const result = this.currentResult(); this.resolveDone(result); return result; }
    end(): Promise<MomentResult> {
        if (this.closing)
            return this.closing;
        this.ending = true;
        this.playback = { kind: 'idle' };
        this.progress = undefined;
        this.wakePlaybackWait?.();
        this.revision++;
        this.closing = (async () => { await this.operation; await this.closeRun(); return this.finish(); })();
        return this.closing;
    }
}
