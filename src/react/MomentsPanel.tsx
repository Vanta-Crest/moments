"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MomentCommand, PlaybackPace } from "../internal/protocol.js";
import { useMomentsSession, type MomentIntent } from "./useMomentsSession.js";
import { useMomentSetup, type SetupReview } from "./useMomentSetup.js";
import { RunValues } from "./RunValues.js";

export type MomentsPanelProps = { defaultCollapsed?: boolean };

/** Optional native controls for a Moments runner. Import moments.css separately. */
export function MomentsPanel({ defaultCollapsed }: MomentsPanelProps = {}) {
  const { connection, sending, message, submit, dismissReviewFeedback } = useMomentsSession();
  const view = "view" in connection ? connection.view : undefined;
  const draft = useMomentSetup(view);
  const connected = connection.kind === "connected";
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? true);
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
    ? selection.id : current?.id ?? view?.checkpoints[0]?.id ?? "";
  const selected = view?.checkpoints.find(point => point.id === selectedId);
  const selectedIndex = view?.checkpoints.findIndex(point => point.id === selectedId) ?? -1;
  const playing = view?.playback.kind === "playing" ? view.playback : undefined;
  const next = view?.checkpoints.find(point => point.id === view.nextId);
  const last = view?.checkpoints.at(-1);
  const playToSelection = selectedIndex > currentIndex && selected?.opening === "reuse";
  const allowed = (condition?: boolean) => connected && !!view?.runRef && !sending && !!condition;
  const openAllowed = !!selected && selected.opening !== "unavailable"
    && (selected.opening !== "fresh-run" || !!view?.controls.restart);
  const confirmed = confirmation && connected && confirmation.intent.runRef === view?.runRef
    && confirmation.revision === view?.revision && "checkpointId" in confirmation.intent.command
    && confirmation.intent.command.checkpointId === selectedId ? confirmation : undefined;
  const canPrepare = allowed(view?.controls.restart) && !playing && !!draft.setup;
  const displayKey = view ? `moments-package-display:${view.sessionId}` : undefined;
  useEffect(() => {
    if (!displayKey) return;
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
    : view?.activity === "ready" ? view.nextId ? "Ready to explore" : "Final checkpoint verified. Keep exploring or end the session."
    : view?.destinationId ? `Working on ${view.checkpoints.find(point => point.id === view.destinationId)?.title ?? view.destinationId}…`
    : view?.activity.replaceAll("-", " ");

  return <aside className="moments-package" aria-label="Moments" ref={root} onKeyDown={event => {
    if (event.key === "Escape" && !collapsed) {
      event.preventDefault(); event.stopPropagation();
      if (mode !== "normal") back(); else if (confirmed) dismissConfirmation(); else collapse();
    }
  }}>
    {!collapsed && <section id={panelId} className="moments-package__panel" aria-label="Moment controls">
      <header className="moments-package__row">
        <strong>{view?.journey.title ?? "Moments"}</strong>
        <button type="button" ref={collapseButton} aria-expanded={true} aria-controls={panelId} onClick={collapse}>Collapse</button>
      </header>
      {mode !== "normal" && view ? <RunValues draft={draft} view={view} heading={valuesHeading} review={mode === "review" ? setupReview : undefined}
        canPrepare={canPrepare} canPause={allowed(view.controls.pause)} onReview={reviewValues} onCommit={() => void prepare()} onBack={back} onPause={() => send({ kind: "pause" })} />
      : <div className="moments-package__body">
      <div role="status">
        {connection.kind === "connecting" && <p>Connecting to Moments…</p>}
        {connection.kind === "unavailable" && <p>No Moments session is connected. Open a checkpoint with the Moments runner and use its browser.</p>}
        {connection.kind === "incompatible" && <p>Moments versions do not match. Use the same package version in this application and the runner, then reconnect.</p>}
        {connection.kind === "disconnected" && <p>Runner connection interrupted. Controls return when it reconnects. Actions will not be replayed.</p>}
      </div>
      {view && <>
        <p className="moments-package__checkpoint">{current ? `Checkpoint ${currentIndex + 1} of ${view.checkpoints.length}: ${current.title}` : "No checkpoint verified yet"}</p>
        {current && <p>Last verified: {current.title}</p>}
        {current?.description && <p>{current.description}</p>}
        {draft.setup && <p><button type="button" data-moments-values aria-label="Run values" onClick={openValues}>Run values · {draft.summary}</button>{draft.changed && <span> Draft changes</span>}</p>}
        {draft.unavailable && <p>Run values are unavailable because their definition does not match this session.</p>}
        <p role="status">{status}</p>
        {view.failure && <p role="alert">Needs attention: {view.failure.stage}{view.failure.checkpointId ? ` at ${view.failure.checkpointId}` : ""}.</p>}
        {view.message && <p role="alert">{view.message}</p>}
        <div className="moments-package__row">
          <button type="button" disabled={!allowed(view.controls.continue)} onClick={() => send({ kind: "continue" })}>Continue</button>
          <button type="button" disabled={!allowed(view.controls.check)} onClick={() => send({ kind: "check" })}>Check this state</button>
          <button type="button" disabled={!allowed(view.controls.end)} onClick={() => send({ kind: "end" })}>End session</button>
        </div>
        {next && !playing && <p>Next: {next.title}</p>}
        <details>
          <summary>Checkpoint and playback</summary>
          <label htmlFor={`${panelId}-checkpoint`}>Checkpoint</label>
          <select id={`${panelId}-checkpoint`} value={selectedId} onChange={event => {
            setSelection({ ...(view.runRef ? { runRef: view.runRef } : {}), id: event.target.value });
            setConfirmation(undefined);
          }}>
            {view.checkpoints.map(point => <option key={point.id} value={point.id}>{point.title} ({point.status.replaceAll("-", " ")})</option>)}
          </select>
          {selected?.description && <p>{selected.description}</p>}
          {selected?.opening === "fresh-run" && <p>Opening this checkpoint starts a fresh run and ends the current exploration.</p>}
          <button type="button" ref={openButton} disabled={!allowed(openAllowed && (!playToSelection || view.controls.play))}
            onClick={() => selected?.opening === "fresh-run" ? confirm({ kind: "open", checkpointId: selectedId })
              : playToSelection ? send({ kind: "play", checkpointId: selectedId, pace }) : send({ kind: "open", checkpointId: selectedId })}>
            {selected?.opening === "fresh-run" ? "Start fresh here" : playToSelection ? "Play to checkpoint" : "Open checkpoint"}
          </button>
          <label htmlFor={`${panelId}-pace`}>Playback pace</label>
          <select id={`${panelId}-pace`} value={pace} onChange={event => setPace(event.target.value as PlaybackPace)}>
            <option value="immediate">Continue immediately</option>
            <option value="demo">Pause briefly between steps</option>
          </select>
          <div className="moments-package__row">
            {playing ? <button type="button" disabled={!allowed(view.controls.pause)} onClick={() => send({ kind: "pause" })}>{playing.pauseRequested ? "Pausing…" : "Pause"}</button>
              : <button type="button" disabled={!allowed(view.controls.play && !!last)} onClick={() => { if (last) send({ kind: "play", checkpointId: last.id, pace }); }}>Play journey</button>}
            <button type="button" ref={restartButton} disabled={!allowed(view.controls.restart && !!selected)} onClick={() => confirm({ kind: "restart", checkpointId: selectedId })}>Restart at checkpoint</button>
          </div>
          <p>Pause finishes and checks the current action before stopping. Collapsing the panel keeps playback running.</p>
        </details>
        {confirmed && <div className="moments-package__confirmation" role="group" aria-label="Confirm fresh run">
          <p>Start a fresh run at {selected?.title}? This ends the current run. Your exploration will not carry over.{view.journey.restartExplanation && ` ${view.journey.restartExplanation}`}{draft.changed && " Your unapplied value changes will be discarded."}</p>
          <div className="moments-package__row">
            <button type="button" disabled={!allowed(view.controls.restart)} onClick={() => { setConfirmation(undefined); void submit(confirmed.intent); }}>Start fresh</button>
            <button type="button" ref={cancelButton} onClick={draft.changed ? openValues : dismissConfirmation}>{draft.changed ? "Back to values" : "Keep exploring"}</button>
          </div>
        </div>}
        <details>
          <summary>Session details</summary>
          <dl>
            <dt>Run reference</dt><dd><code>{view.runRef ?? "Preparing"}</code></dd>
            <dt>Activity</dt><dd>{view.activity.replaceAll("-", " ")}</dd>
            <dt>Last verified</dt><dd>{view.lastVerified?.at ?? "Not checked"}</dd>
          </dl>
          <ol>{view.checkpoints.map(point => <li key={point.id}>{point.title}: {point.status.replaceAll("-", " ")}</li>)}</ol>
          {draft.setup && <><p>Export checkpoint: {(current ?? view.checkpoints[0])?.title}</p>
            <p>Includes active autofill values. Manual product edits and draft changes are not included.</p>
            <button type="button" onClick={draft.exportCurrent}>Export run setup</button>
            {draft.download !== "idle" && <p role={draft.download === "failed" ? "alert" : "status"}>{draft.download === "failed" ? "Download could not be started. Try again." : "Download started."}</p>}</>}
        </details>
      </>}
      <p className="moments-package__hint">Escape collapses the panel. Alt + Shift + M opens it.</p>
      </div>}
      {sending && <p role="status">{mode === "review" ? "Starting a new run…" : "Sending action…"}</p>}
      {message && <p role="alert">{message}</p>}
    </section>}
    {collapsed && <button type="button" ref={launcher} aria-expanded={false} aria-controls={panelId} onClick={() => display(false)}>Show Moments</button>}
    {collapsed && playing && <button type="button" disabled={!allowed(view?.controls.pause)} onClick={() => send({ kind: "pause" })}>{playing.pauseRequested ? "Pausing…" : "Pause"}</button>}
  </aside>;
}
