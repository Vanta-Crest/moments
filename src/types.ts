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
    }[];
    create(context: JourneyContext): JourneyDriver<I>;
};
export type MomentResult = {
    schemaVersion: 3;
    packageVersion: typeof PACKAGE_VERSION;
    sessionId: string;
    runRef: string;
    journeyId: string;
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
        provenance: 'native' | 'manual';
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
    journeys: readonly JourneyDefinition[];
    beforeRun(journeyId: string): Promise<void>;
    /** Open run controls in a separate Moments Director window. Interactive runs only. */
    director?: boolean;
    /** Failure evidence (message, URL, screenshot). Default `<outputDir>/../evidence`; none with `writeReceipt` unless set; `false` disables. */
    evidenceDir?: string | false;
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
    signal?: AbortSignal;
};
export type MomentSession = {
    view(): MomentsView;
    command(request: MomentCommandRequest): MomentCommandReply;
    currentResult(): MomentResult;
    readonly done: Promise<MomentResult>;
    end(): Promise<MomentResult>;
    settled(): Promise<void>;
};
