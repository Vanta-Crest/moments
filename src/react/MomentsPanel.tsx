"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MomentCommand, PlaybackPace } from "../internal/protocol.js";
import { useMomentsSession, type MomentIntent } from "./useMomentsSession.js";
import { useMomentSetup, type SetupReview } from "./useMomentSetup.js";
import { RunValues } from "./RunValues.js";

export type MomentsPanelProps = { defaultCollapsed?: boolean;
  /** Fills its own window (the Moments Director): always expanded, no collapse controls. */
  standalone?: boolean };

/** Optional native controls for a Moments runner. Import moments.css separately. */
export function MomentsPanel({ defaultCollapsed, standalone }: MomentsPanelProps = {}) {
  const { connection, sending, message, submit, dismissReviewFeedback } = useMomentsSession();
  const view = "view" in connection ? connection.view : undefined;
  const draft = useMomentSetup(view);
  const connected = connection.kind === "connected";
  const [collapsed, setCollapsed] = useState(standalone ? false : defaultCollapsed ?? true);
  const [mode, setMode] = useState<"normal" | "values" | "review">("normal");
  const [setupReview, setSetupReview] = useState<Extract<SetupReview, { kind: "ready" }>>();
  const root = useRef<HTMLElement>(null), valuesHeading = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<"heading" | "review" | "opener">();
  const [pace, setPace] = useState<PlaybackPace>("immediate");
  const [selection, setSelection] = useState<{ runRef?: string; id: string }>({ id: "" });
  const [confirmation, setConfirmation] = useState<{ intent: MomentIntent; revision: number }>();
  const launcher = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const restartButton = useRef<HTMLButtonElement>(null);
  const focusDisplay = useRef(false);
  const panelId = useId();
  const current = view?.checkpoints.find(point => point.id === view.lastVerified?.checkpointId);
  const currentIndex = view?.checkpoints.findIndex(point => point.id === current?.id) ?? -1;
  const selectedId = selection.runRef === view?.runRef && view?.checkpoints.some(point => point.id === selection.id)
    ? selection.id : view?.failure?.checkpointId ?? current?.id ?? view?.checkpoints[0]?.id ?? "";
  const selected = view?.checkpoints.find(point => point.id === selectedId);
  const selectedIndex = view?.checkpoints.findIndex(point => point.id === selectedId) ?? -1;
  const playing = view?.playback.kind === "playing" ? view.playback : undefined;
  const failedIndex = view?.checkpoints.findIndex(point => point.id === view.failure?.checkpointId) ?? -1;
  const next = view?.checkpoints.find(point => point.id === view.nextId);
  const last = view?.checkpoints.at(-1);
  const playToSelection = selectedIndex > currentIndex && selected?.opening === "reuse";
  // `able` ignores a command in flight, so a button stays focusable (aria-disabled) instead of dropping focus.
  const able = (condition?: boolean) => connected && !!view?.runRef && !!condition;
  const allowed = (condition?: boolean) => able(condition) && !sending;
  const openAllowed = !!selected && selected.opening !== "unavailable"
    && (selected.opening !== "fresh-run" || !!view?.controls.restart);
  const confirmed = confirmation && connected && confirmation.intent.runRef === view?.runRef
    && confirmation.revision === view?.revision && "checkpointId" in confirmation.intent.command
    && confirmation.intent.command.checkpointId === selectedId ? confirmation : undefined;
  const canPrepare = allowed(view?.controls.restart) && !playing && !!draft.setup;
  const displayKey = view ? `moments-package-display:${view.sessionId}` : undefined;
  useEffect(() => {
    if (standalone || !displayKey) return;
    let initial = defaultCollapsed ?? window.matchMedia("(max-width: 480px)").matches;
    try { const saved = sessionStorage.getItem(displayKey); if (saved === "collapsed" || saved === "expanded") initial = saved === "collapsed"; } catch { /* optional preference */ }
    setCollapsed(initial);
  }, [displayKey]);
  useEffect(() => { setMode("normal"); setSetupReview(undefined); }, [view?.runRef]);
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    const target = focusNext.current === "heading" ? valuesHeading.current : root.current?.querySelector<HTMLButtonElement>(focusNext.current === "review" ? "[data-moments-review]" : "[data-moments-values]");
    if (target) { target.focus(); focusNext.current = undefined; }
  });

  useEffect(() => {
    if (!focusDisplay.current) return;
    focusDisplay.current = false;
    if (collapsed) launcher.current?.focus();
    else collapseButton.current?.focus();
  }, [collapsed]);
  useEffect(() => { if (confirmed) cancelButton.current?.focus(); }, [confirmed]);
  useEffect(() => {
    setConfirmation(undefined);
  }, [view?.runRef, view?.revision, connected, selectedId]);
  useEffect(() => {
    if (standalone) return;
    function restore(event: KeyboardEvent) {
      if (event.altKey && event.shiftKey && event.code === "KeyM"
        && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) {
        event.preventDefault();
        display(false);
        collapseButton.current?.focus();
      }
    }
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, [displayKey]);

  function intent(command: MomentCommand): MomentIntent | undefined {
    return view?.runRef ? { command, runRef: view.runRef,
      ...(command.kind === "open" && selected?.opening !== "unavailable" ? { opening: selected?.opening } : {}) } : undefined;
  }
  function send(command: MomentCommand) {
    const request = intent(command);
    if (request) { setConfirmation(undefined); void submit(request); }
  }
  function confirm(command: MomentCommand) {
    const request = intent(command);
    if (request && view) setConfirmation({ intent: { ...request, expectedRevision: view.revision }, revision: view.revision });
  }
  function dismissConfirmation() {
    const trigger = confirmation?.intent.command.kind === "restart" ? restartButton : openButton;
    setConfirmation(undefined);
    trigger.current?.focus();
  }
  function display(value: boolean) {
    focusDisplay.current = true;
    setCollapsed(value);
    try { if (displayKey) sessionStorage.setItem(displayKey, value ? "collapsed" : "expanded"); } catch { /* optional preference */ }
  }
  function collapse() { setConfirmation(undefined); setSetupReview(undefined); setMode("normal"); display(true); }
  function openValues() { draft.begin(); setConfirmation(undefined); setSetupReview(undefined); focusNext.current = "heading"; setMode("values"); }
  function back() {
    const reviewing = mode === "review";
    setSetupReview(undefined); focusNext.current = reviewing ? "review" : "opener"; setMode(reviewing ? "values" : "normal");
  }
  function reviewValues() {
    if (!canPrepare) return;
    const result = draft.review();
    if (result.kind === "unchanged") back();
    else if (result.kind === "ready") { dismissReviewFeedback(); setSetupReview(result); focusNext.current = "heading"; setMode("review"); }
  }
  async function prepare() {
    if (!setupReview || !canPrepare) return;
    const reply = await submit(setupReview.intent);
    if (!draft.receive(reply)) { setSetupReview(undefined); focusNext.current = "heading"; setMode("values"); }
  }
  const status = !connected ? "Last observation; controls are unavailable."
    : playing?.pauseRequested ? "Pausing after the current step…"
    : view?.progress === "waiting-for-code" ? "Waiting for a fresh authenticator code…"
    : playing?.phase === "waiting" ? "Waiting briefly before the next step…"
    : view?.activity === "ready" ? view.nextId ? "Ready. Explore the application, or continue." : "Every checkpoint is verified. Keep exploring or end the session."
    : view?.activity === "needs-attention" ? "Stopped."
    : view?.destinationId ? `Working on ${view.checkpoints.find(point => point.id === view.destinationId)?.title ?? view.destinationId}…`
    : view?.activity.replaceAll("-", " ");
  // One word for the badge; the sentence above stays the announced status.
  const tone: Tone = !connected ? "idle" : view?.failure || view?.activity === "needs-attention" ? "attention"
    : view?.progress === "waiting-for-code" ? "waiting" : view?.activity === "ready" ? view.nextId ? "ready" : "done"
    : view?.activity === "closed" ? "idle" : "working";
  const badge = !connected ? connection.kind === "connecting" ? "Connecting" : "Offline"
    : { attention: "Needs attention", waiting: "Waiting for code", ready: "Ready", done: "All verified", working: playing ? "Playing" : "Working", idle: "Closed" }[tone];
  const working = view && !["ready", "needs-attention", "closed"].includes(view.activity) ? view.destinationId : undefined;
  const headline = !view ? "" : failedIndex >= 0 ? `Stopped at ${failedIndex + 1} of ${view.checkpoints.length}: ${view.checkpoints[failedIndex]!.title}`
    : current ? `Checkpoint ${currentIndex + 1} of ${view.checkpoints.length}: ${current.title}` : "No checkpoint verified yet";
  const host = view?.origin?.replace(/^https?:\/\//, "");
  const footerButton = (condition: boolean | undefined, command: () => void) => ({
    disabled: !able(condition), "aria-disabled": sending || undefined, onClick: () => { if (!sending) command(); } });

  return <aside className={standalone ? "moments-package moments-package--standalone" : "moments-package"} aria-label="Moments" ref={root} onKeyDown={event => {
    if (event.key === "Escape" && !collapsed) {
      event.preventDefault(); event.stopPropagation();
      if (mode !== "normal") back(); else if (confirmed) dismissConfirmation(); else if (!standalone) collapse();
    }
  }}>
    {!collapsed && <section id={panelId} className="moments-package__panel" aria-label="Moment controls" data-tone={tone}>
      <header className="moments-package__masthead">
        <div className="moments-package__row">
          <span className="moments-package__kicker">Moments</span>
          <span className="moments-package__badge"><span className="moments-package__dot" aria-hidden="true" />{badge}</span>
          {view?.recording && <span className="moments-package__badge moments-package__badge--film" data-filming={view.recording === "filming" || undefined}
            title={view.recording === "filming" ? "The application window is being filmed." : "Filming is paused: this step is private."}>
            <span className="moments-package__dot" aria-hidden="true" />{view.recording === "filming" ? "Filming" : "Not filming"}</span>}
          {!standalone && <button type="button" className="moments-package__quiet" ref={collapseButton} aria-expanded={true} aria-controls={panelId} onClick={collapse}>Collapse</button>}
        </div>
        <h2 className="moments-package__journey">{view?.journey.title ?? "Moments"}</h2>
        {host && <p className="moments-package__system">{view?.environment && <span>{view.environment}</span>}<code>{host}</code></p>}
        {view && <div className="moments-package__meter" aria-hidden="true">
          {view.checkpoints.map(point => <span key={point.id} data-status={point.status} data-working={point.id === working || undefined} />)}
        </div>}
      </header>
      {mode !== "normal" && view ? <RunValues draft={draft} view={view} heading={valuesHeading} review={mode === "review" ? setupReview : undefined}
        canPrepare={canPrepare} canPause={allowed(view.controls.pause)} onReview={reviewValues} onCommit={() => void prepare()} onBack={back} onPause={() => send({ kind: "pause" })} />
      : <>
      <div className="moments-package__body">
      <div role="status" className="moments-package__notice">
        {connection.kind === "connecting" && <p>Connecting to Moments…</p>}
        {connection.kind === "unavailable" && <p>No Moments session is connected. Open a checkpoint with the Moments runner and use its browser.</p>}
        {connection.kind === "incompatible" && <p>Moments versions do not match. Use the same package version in this application and the runner, then reconnect.</p>}
        {connection.kind === "disconnected" && <p>Runner connection interrupted. Controls return when it reconnects. Actions will not be replayed.</p>}
      </div>
      {view && <>
        <p className="moments-package__checkpoint">{headline}</p>
        <p role="status" className="moments-package__status">{status}</p>
        {view.message && <div className="moments-package__alert" role="alert">
          <p>{view.message}</p>
          {view.failure?.detail && <details className="moments-package__technical"><summary>Technical detail</summary>
            <p className="moments-package__detail">{view.failure.detail}</p></details>}
          {view.failure?.evidence && <Evidence path={view.failure.evidence} />}
        </div>}
        <fieldset className="moments-package__steps">
          <legend>Checkpoints</legend>
          <ol>{view.checkpoints.map((point, index) => {
            const chosen = point.id === selectedId, here = point.id === current?.id;
            const state = point.id === working ? "working" : point.status;
            const next = point.id === view.nextId && !working && !view.failure;
            const seen = point.observed && point.status !== "failed" ? `${how[point.observed.provenance]} · ${clock(point.observed.at)}` : undefined;
            return <li key={point.id} data-state={state} data-selected={chosen || undefined}>
              <label>
                <input type="radio" name={`${panelId}-checkpoint`} value={point.id} checked={chosen}
                  aria-label={[point.title, state === "working" ? "in progress" : point.status.replaceAll("-", " "), seen, here && "current", next && "next", point.private && "private"].filter(Boolean).join(", ")} onChange={() => {
                  setSelection({ ...(view.runRef ? { runRef: view.runRef } : {}), id: point.id });
                  setConfirmation(undefined);
                }} />
                <span className="moments-package__mark" aria-hidden="true">{state === "passed" ? "✓" : state === "failed" ? "!" : state === "skipped" ? "–" : index + 1}</span>
                <span className="moments-package__title">{point.title}
                  {here && <span className="moments-package__tag">Current</span>}
                  {next && <span className="moments-package__tag" data-quiet>Next</span>}
                  {point.private && <span className="moments-package__tag" data-quiet>Private</span>}
                  {seen && <span className="moments-package__seen">{seen}</span>}
                </span>
              </label>
              {chosen && <div className="moments-package__detailpane">
                {point.actor && <p className="moments-package__actor">{point.actor}</p>}
                {point.description && <p>{point.description}</p>}
                {point.opening === "fresh-run" ? <>
                  <p className="moments-package__hint">This checkpoint is behind the current one: opening it starts a fresh run and ends this one.</p>
                  <div className="moments-package__row">
                    <button type="button" ref={openButton} data-tone="caution" disabled={!allowed(openAllowed)} onClick={() => confirm({ kind: "open", checkpointId: selectedId })}>Start fresh here</button>
                  </div>
                </> : <div className="moments-package__row">
                  {!here && point.opening !== "unavailable" && <button type="button" ref={openButton} disabled={!allowed(openAllowed && (!playToSelection || view.controls.play))}
                    onClick={() => playToSelection ? send({ kind: "play", checkpointId: selectedId, pace }) : send({ kind: "open", checkpointId: selectedId })}>
                    {playToSelection ? "Play to checkpoint" : "Open checkpoint"}</button>}
                  <button type="button" className="moments-package__quiet" data-tone="caution" ref={restartButton} disabled={!allowed(view.controls.restart && !!selected)}
                    title="Start a new run at this checkpoint and end this one" onClick={() => confirm({ kind: "restart", checkpointId: selectedId })}>Restart at checkpoint</button>
                </div>}
                {confirmed && <div className="moments-package__confirmation" role="group" aria-label="Confirm fresh run">
                  <p>Start a fresh run at {selected?.title}? This ends the current run. Your exploration will not carry over.{view.journey.restartExplanation && ` ${view.journey.restartExplanation}`}{draft.changed && " Your unapplied value changes will be discarded."}</p>
                  <div className="moments-package__row">
                    <button type="button" data-tone="caution" disabled={!allowed(view.controls.restart)} onClick={() => { setConfirmation(undefined); void submit(confirmed.intent); }}>Start fresh</button>
                    <button type="button" ref={cancelButton} onClick={draft.changed ? openValues : dismissConfirmation}>{draft.changed ? "Back to values" : "Keep exploring"}</button>
                  </div>
                </div>}
              </div>}
            </li>;
          })}</ol>
        </fieldset>
        {draft.setup && <p><button type="button" className="moments-package__quiet" data-moments-values aria-label="Run values" onClick={openValues}>Run values · {draft.summary}</button>{draft.changed && <span className="moments-package__tag">Draft changes</span>}</p>}
        {draft.unavailable && <p>Run values are unavailable because their definition does not match this session.</p>}
        <details>
          <summary>Session details</summary>
          <dl>
            <dt>Run reference</dt><dd><code>{view.runRef ?? "Preparing"}</code></dd>
            {view.environment && <><dt>Environment</dt><dd>{view.environment}</dd></>}
            {view.origin && <><dt>Address</dt><dd><code>{view.origin}</code></dd></>}
            <dt>Activity</dt><dd>{view.activity.replaceAll("-", " ")}</dd>
            <dt>Last verified</dt><dd>{view.lastVerified ? <time dateTime={view.lastVerified.at}>{new Date(view.lastVerified.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}</time> : "Not checked"}</dd>
          </dl>
          {draft.setup && <><p>Export checkpoint: {(current ?? view.checkpoints[0])?.title}</p>
            <p>Includes active autofill values. Manual product edits and draft changes are not included.</p>
            <button type="button" onClick={draft.exportCurrent}>Export run setup</button>
            {draft.download !== "idle" && <p role={draft.download === "failed" ? "alert" : "status"}>{draft.download === "failed" ? "Download could not be started. Try again." : "Download started."}</p>}</>}
        </details>
      </>}
      {!standalone && <p className="moments-package__hint">Escape collapses the panel. Alt + Shift + M opens it.</p>}
      </div>
      {view && <footer className="moments-package__footer">
        <div className="moments-package__row">
          <button type="button" data-tone="primary" {...footerButton(view.controls.continue, () => send({ kind: "continue" }))}>Continue</button>
          <button type="button" {...footerButton(view.controls.check, () => send({ kind: "check" }))}>Check this state</button>
          {playing ? <button type="button" {...footerButton(view.controls.pause, () => send({ kind: "pause" }))}>{playing.pauseRequested ? "Pausing…" : "Pause"}</button>
            : <button type="button" {...footerButton(view.controls.play && !!last, () => { if (last) send({ kind: "play", checkpointId: last.id, pace }); })}>Play journey</button>}
        </div>
        <div className="moments-package__row moments-package__row--split">
          <fieldset className="moments-package__pace">
            <legend>Playback pace</legend>
            {([["immediate", "Straight through"], ["demo", "With pauses"]] as const).map(([value, text]) =>
              <label key={value}><input type="radio" name={`${panelId}-pace`} value={value} checked={pace === value} onChange={() => setPace(value)} />{text}</label>)}
          </fieldset>
          <button type="button" className="moments-package__quiet" data-tone="end" {...footerButton(view.controls.end, () => send({ kind: "end" }))}>End session</button>
        </div>
      </footer>}
      </>}
      {sending && <p role="status" className="moments-package__sending">{mode === "review" ? "Starting a new run…" : "Sending action…"}</p>}
      {message && <p role="alert" className="moments-package__alert">{message}</p>}
    </section>}
    {collapsed && <div className="moments-package__launcher" data-tone={tone}>
      <button type="button" ref={launcher} aria-expanded={false} aria-controls={panelId} onClick={() => display(false)}><span className="moments-package__dot" aria-hidden="true" />Show Moments</button>
      {playing && <button type="button" disabled={!allowed(view?.controls.pause)} onClick={() => send({ kind: "pause" })}>{playing.pauseRequested ? "Pausing…" : "Pause"}</button>}
    </div>}
  </aside>;
}

const how = { native: "Moments", manual: "By hand", existing: "Already there" } as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Tone = "ready" | "working" | "waiting" | "attention" | "done" | "idle";

/** A local file path the reviewer opens by hand; it never leaves this machine. */
function Evidence({ path }: { path: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setCopied("idle"), [path]);
  return <div className="moments-package__evidence">
    <span>Evidence</span>
    <code title={path}>{path.split("/").at(-1)}</code>
    <button type="button" className="moments-package__quiet" onClick={() => navigator.clipboard.writeText(path).then(() => setCopied("copied"), () => setCopied("failed"))}>
      {copied === "copied" ? "Copied" : "Copy path"}</button>
    {copied === "failed" && <code className="moments-package__path">{path}</code>}
  </div>;
}
