import { parseMomentSetup, type MomentSetup, type SetupField, type SetupIssue, type SetupValues } from '../setup.js';
export * from '../setup.js';
export const PACKAGE_VERSION = '0.2.0' as const;
/** Browser-safe control contract. Product credentials never cross this boundary. */
export type MomentCommand = {
    kind: "select";
    requestRef: string;
    target: string;
} | {
    kind: "continue";
} | {
    kind: "check";
} | {
    kind: "end";
} | {
    kind: "play";
    checkpointId: string;
    pace: PlaybackPace;
} | {
    kind: "pause";
} | {
    kind: "open";
    checkpointId: string;
} | {
    kind: "restart";
    checkpointId: string;
    setup?: MomentSetup;
};
export type PlaybackPace = "immediate" | "demo";
export type MomentProgress = "waiting-for-code";
export type PlaybackView = { kind: "idle" } | {
    kind: "playing";
    targetId: string;
    pace: PlaybackPace;
    phase: "advancing" | "waiting";
    pauseRequested: boolean;
};
export type MomentCommandRequest = {
    runRef: string;
    revision: number;
    command: MomentCommand;
};
export type MomentCommandReply = {
    accepted: true;
} | {
    accepted: false;
    reason: "busy" | "stale" | "unavailable";
} | {
    accepted: false;
    reason: "invalid-setup";
    issues: readonly SetupIssue[];
};
export type MomentCatalogueEntry = Readonly<{
    target: string; title: string; group: string; purpose: string;
    viewpoints: readonly string[]; expectedObservation: string;
    prerequisites: readonly string[]; cleanup: string;
    availability: { kind: "available" } | { kind: "unavailable"; reason: string };
}>;
export type MomentCatalogue = Readonly<{
    runtimeRef: string; scopeLabel: string; entries: readonly MomentCatalogueEntry[];
}>;
/** One retained request, including its allocated successor identity before any cleanup. */
export type MomentSelection = Readonly<{
    requestRef: string; fromRunRef: string; toRunRef: string; target: string;
    phase: "requested" | "cleaning" | "blocked" | "starting" | "started";
}>;
export type MomentsView = {
    sessionId: string;
    runRef?: string;
    revision: number;
    catalogue?: MomentCatalogue;
    selection?: MomentSelection;
    journey: {
        id: string;
        title: string;
        restartExplanation?: string;
    };
    setup?: { schemaVersion: number; fields: readonly SetupField[]; defaults: SetupValues; active: MomentSetup };
    checkpoints: readonly {
        id: string;
        title: string;
        description: string;
        status: "not-checked" | "passed" | "skipped" | "failed";
        opening: "reuse" | "fresh-run" | "unavailable";
    }[];
    controls: {
        check: boolean;
        continue: boolean;
        restart: boolean;
        end: boolean;
        play: boolean;
        pause: boolean;
    };
    playback: PlaybackView;
    progress?: MomentProgress;
    failure?: {
        stage: "admission" | "browser" | "create" | "enter" | "verify" | "reconcile" | "cleanup" | "persist" | "close";
        checkpointId?: string;
        /** Session-local: first line of the thrown message. Never persisted in the receipt. */
        detail?: string;
        /** Session-local: absolute path of the local evidence file. */
        evidence?: string;
    };
    lastVerified?: {
        checkpointId: string;
        at: string;
    };
    activity: "preparing" | "ready" | "working" | "needs-attention" | "closing" | "closed";
    destinationId?: string;
    nextId?: string;
    message?: string;
};
export type MomentsBridge = {
    packageVersion: string;
    read(): Promise<MomentsView>;
    command(request: MomentCommandRequest): Promise<MomentCommandReply>;
};
export function parseMomentCommandRequest(value: unknown): MomentCommandRequest {
    if (!value || typeof value !== "object")
        throw new Error("Invalid Moments command");
    const request = value as Record<string, unknown>;
    if (typeof request.runRef !== "string" || request.runRef.length > 128 || !Number.isSafeInteger(request.revision) || (request.revision as number) < 0
        || !request.command || typeof request.command !== "object")
        throw new Error("Invalid Moments command");
    const command = request.command as Record<string, unknown>;
    if (Object.keys(request).length !== 3 || Object.keys(request).some(key => !["runRef", "revision", "command"].includes(key)))
        throw new Error("Invalid Moments command");
    if (command.kind === "select" && Object.keys(command).length === 3
        && Object.keys(command).every(key => ["kind", "requestRef", "target"].includes(key))
        && typeof command.requestRef === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(command.requestRef)
        && typeof command.target === "string" && /^[a-z][a-z0-9.-]{0,191}$/.test(command.target)) {
        return { runRef: request.runRef, revision: request.revision as number,
            command: { kind: "select", requestRef: command.requestRef, target: command.target } };
    }
    if (command.kind === "continue" || command.kind === "check" || command.kind === "end" || command.kind === "pause") {
        if (Object.keys(command).length !== 1)
            throw new Error("Invalid Moments command");
        return {
            runRef: request.runRef, revision: request.revision as number, command: { kind: command.kind }
        };
    }
    if (command.kind === "play" && typeof command.checkpointId === "string"
        && /^[a-z][a-z0-9-]{0,63}$/.test(command.checkpointId)
        && (command.pace === "immediate" || command.pace === "demo") && Object.keys(command).length === 3) {
        return { runRef: request.runRef, revision: request.revision as number,
            command: { kind: "play", checkpointId: command.checkpointId, pace: command.pace } };
    }
    if ((command.kind === "open" || command.kind === "restart") && typeof command.checkpointId === "string"
        && /^[a-z][a-z0-9-]{0,63}$/.test(command.checkpointId)
        && Object.keys(command).length === (Object.hasOwn(command, 'setup') ? 3 : 2)
        && Object.keys(command).every(key => ['kind', 'checkpointId', ...(command.kind === 'restart' ? ['setup'] : [])].includes(key))) {
        return {
            runRef: request.runRef, revision: request.revision as number, command: {
                kind: command.kind, checkpointId: command.checkpointId,
                ...(Object.hasOwn(command, 'setup') ? { setup: parseMomentSetup(command.setup) } : {})
            }
        };
    }
    throw new Error("Invalid Moments command");
}

/** Explain only known stages and authored public checkpoint copy, never caught exception text. */
export function describeMomentFailure(failure: NonNullable<MomentsView["failure"]>, checkpoint?: { title: string; description?: string }): string {
    const at = checkpoint ? ` at ${checkpoint.title}` : failure.checkpointId ? ` at ${failure.checkpointId}` : "";
    switch (failure.stage) {
        case "admission": return "The run prerequisites could not be established. Check the app prerequisites and local environment before starting again.";
        case "browser": return "The review browser could not be opened. Check browser availability, then start a new run.";
        case "create": return "The journey could not be prepared. Inspect the run receipt before starting again; preparation may have created resources.";
        case "enter": return `The action${at} did not finish successfully. Inspect the page and run receipt before restarting; the action may already have changed the product.`;
        case "verify": return `Arrival${at} could not be verified.${checkpoint?.description ? ` Expected checkpoint: ${checkpoint.description}` : ""} Inspect the page, then use Recheck if available. Recheck observes the state without repeating the action.`;
        case "reconcile": return `The page no longer matches the prepared state${at}. Restore the prepared fields or return to the current step, then recheck. No further step was submitted.`;
        case "cleanup": return "Cleanup could not be confirmed. Inspect the run receipt for remaining resources before starting another run.";
        case "persist": return "The run receipt could not be saved. Check receipt storage before continuing; durable recovery is not established.";
        case "close": return "The review browser could not be closed. Check whether it is still open and inspect the run receipt for cleanup status.";
    }
}
