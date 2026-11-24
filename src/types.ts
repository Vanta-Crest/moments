import type { Page } from '@playwright/test';
import type { PACKAGE_VERSION, MomentCatalogue, MomentSelection, MomentCommandRequest, MomentCommandReply, MomentProgress, MomentsView } from './internal/protocol.js';
import type { MomentSetup, SetupDefinition } from './setup.js';
export type FailureStage = 'admission' | 'browser' | 'create' | 'enter' | 'verify' | 'reconcile' | 'cleanup' | 'persist' | 'close';
export type CleanupOutcome = 'complete' | 'neutralized-with-residue';
export type JourneyContext = {
    page: Page;
    baseURL: string;
    runRef: string;
    setup?: MomentSetup;
    reportProgress?(progress: MomentProgress | undefined): void;
};
export type JourneyDriver<I extends string = string> = {
    enter(checkpoint: I): Promise<void>;
    verify(checkpoint: I): Promise<void>;
    reconcile(): Promise<I>;
    cleanup(): Promise<CleanupOutcome>;
};
export type JourneyDefinition<I extends string = string> = {
    id: string;
    title: string;
    /** Static public copy explaining fresh-run creation and cleanup consequences. */
    restartExplanation?: string;
    setup?: SetupDefinition;
    checkpoints: readonly {
        id: I;
        title: string;
        description?: string;
        /** Never filmed: filming stops before this checkpoint is entered or checked, and resumes at the next checkpoint that is not private. */
        private?: boolean;
        /** Who acts at this checkpoint, as a viewer should read it: a name and role. Kept in the receipt and shown in the panel. */
        actor?: string;
        /** References this checkpoint proves, such as acceptance journeys or requirements (`AJ-07`, `REQ-112`). Kept in the receipt. */
        covers?: readonly string[];
    }[];
    create(context: JourneyContext): JourneyDriver<I>;
};
export type MomentResult = {
    schemaVersion: 3;
    packageVersion: typeof PACKAGE_VERSION;
    sessionId: string;
    runRef: string;
    journeyId: string;
    /** The journey as it stood for this run, so the receipt stands alone after the journey file changes. */
    journeyTitle: string;
    checkpoints: readonly { id: string; title: string; actor?: string; covers?: readonly string[]; private?: true }[];
    /** The configured environment label and the origin of `baseURL`: what system this run touched. */
    environment?: string;
    origin: string;
    target: string;
    previousRunRef?: string;
    selection?: MomentSelection;
    setup?: MomentSetup;
    replacementRequested?: { checkpointId: string; setup: MomentSetup };
    activity: MomentsView['activity'];
    startedAt: string;
    updatedAt: string;
    observations: readonly {
        checkpointId: string;
        at: string;
        /** `existing`: verified on resume without this run entering it. */
        provenance: 'native' | 'manual' | 'existing';
        status: 'passed' | 'skipped' | 'failed';
    }[];
    cleanup: 'not-attempted' | CleanupOutcome | 'incomplete';
    failures: readonly {
        stage: FailureStage;
        code: 'operation-failed' | 'persistence-failed' | 'interrupted';
        checkpointId?: string;
        /** Local evidence file, relative to the evidence directory: `<runRef>/<stage>-<checkpoint>.txt`. */
        evidence?: string;
        at: string;
    }[];
    outcome: 'pending' | CleanupOutcome | 'incomplete';
};
export type MomentsConfig = {
    baseURL: string;
    /** Names the system this config drives, as a reviewer should read it (`Zamfara BPP, local stack c13`). Kept in receipts and shown in the panel. */
    environment?: string;
    journeys: readonly JourneyDefinition[];
    beforeRun(journeyId: string): Promise<void>;
    /** Open run controls in a separate Moments Director window. Interactive runs only. */
    director?: boolean;
    /** Failure evidence (message, URL, screenshot). Default `<outputDir>/../evidence`; none with `writeReceipt` unless set; `false` disables. */
    evidenceDir?: string | false;
    /** Default navigation timeout for the managed page. A journey may still set its own in `create`. */
    navigationTimeoutMs?: number;
    /** Default action timeout for the managed page. A journey may still set its own in `create`. */
    actionTimeoutMs?: number;
    /** Page timeout while `resume` probes a checkpoint with verify (default 3000). */
    resumeProbeTimeoutMs?: number;
    catalogue?: { view: MomentCatalogue; admit(target: string): Promise<void> };
} & ({
    outputDir?: string;
    writeReceipt?: never;
} | {
    outputDir?: never;
    writeReceipt(result: MomentResult): Promise<void>;
});
export type OpenMomentOptions = {
    target: string;
    setup?: MomentSetup;
    headless?: boolean;
    once?: boolean;
    /** Verify each checkpoint before entering it; a passing one is recorded `existing` and not entered. */
    resume?: boolean;
    signal?: AbortSignal;
    /** Record the run (video, `timeline.json`, the frame at each verified checkpoint) under `<evidenceDir>/<runRef>/recording`. A recording failure never fails the run. */
    record?: { chapters?: boolean };
    /** Told as the run enters a checkpoint, observes one, or starts or ends a reported wait. */
    onEvent?(event: MomentEvent): void;
};
export type MomentEvent = { at: string } & (
    | { kind: 'entering'; checkpointId: string }
    | { kind: 'observed'; checkpointId: string; provenance: MomentResult['observations'][number]['provenance']; status: 'passed' | 'skipped' }
    | { kind: 'progress'; progress: MomentProgress | null });
export type MomentSession = {
    view(): MomentsView;
    command(request: MomentCommandRequest): MomentCommandReply;
    currentResult(): MomentResult;
    readonly done: Promise<MomentResult>;
    end(): Promise<MomentResult>;
    settled(): Promise<void>;
};
