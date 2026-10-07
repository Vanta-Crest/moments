"use client";

import { useRef, type ChangeEvent, type RefObject } from "react";
import type { MomentsView } from "../internal/protocol.js";
import { useSetupIssueFocus } from "./useSetupIssueFocus.js";
import type { SetupReview, useMomentSetup } from "./useMomentSetup.js";

export function RunValues({ draft, view, heading, review, canPrepare, canPause, onReview, onCommit, onBack, onPause }: {
  draft: ReturnType<typeof useMomentSetup>; view: MomentsView; heading: RefObject<HTMLHeadingElement>;
  review: Extract<SetupReview, { kind: "ready" }> | undefined; canPrepare: boolean; canPause: boolean;
  onReview: () => void; onCommit: () => void; onBack: () => void; onPause: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  useSetupIssueFocus(draft.issues, form, !review);
  const target = view.checkpoints.find(point => point.id === (review?.checkpointId ?? draft.checkpointId));
  const playing = view.playback.kind === "playing" ? view.playback : undefined;
  return <>
    <div className="moments-package__body" role={review ? "group" : undefined} aria-label={review ? "Review run values" : undefined}>
      <h2 ref={heading} tabIndex={-1}>{review ? "Review new run" : "Values for a new run"}</h2>
      {draft.unavailable ? <p>Run values are unavailable because their definition does not match this session.</p>
        : review ? <>
          <p>Start at <strong>{target?.title}</strong> with these values? This review browser will close and a new review will open. Your current exploration will not carry over.{view.journey.restartExplanation && ` ${view.journey.restartExplanation}`}</p>
          <dl>{draft.setup?.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{review.values[field.key]}</dd></div>)}</dl>
        </> : <>
          <p>These changes do not affect the current run.</p>
          <label htmlFor="moments-package-setup-target">New-run checkpoint</label>
          <select id="moments-package-setup-target" value={draft.checkpointId} onChange={event => draft.chooseTarget(event.target.value)}>
            {view.checkpoints.map(point => <option key={point.id} value={point.id}>{point.title}</option>)}
          </select>
          <form ref={form} noValidate onSubmit={event => { event.preventDefault(); if (canPrepare) onReview(); }}>
            {draft.setup?.fields.map(field => {
              const error = draft.issues.filter(issue => issue.field === field.key).map(issue => issue.message).join(" ");
              const id = `moments-package-value-${field.key}`;
              const props = { id, value: draft.values[field.key] ?? "", required: true, maxLength: field.maxLength,
                "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : undefined,
                onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => draft.change(field.key, event.target.value) };
              return <div key={field.key}><label htmlFor={id}>{field.label}</label>
                {field.multiline ? <textarea {...props} rows={3} /> : <input {...props} />}
                {error && <p className="moments-package__error" id={`${id}-error`}>{error}</p>}</div>;
            })}
          </form>
          {draft.issues.filter(issue => !issue.field).map((issue, index) => <p role="alert" key={index}>{issue.message}</p>)}
          <button type="button" onClick={draft.restoreDefaults}>Restore defaults</button>
          <details><summary>How these values are used</summary><p>Values autofill the product as their steps are reached. Access is generated automatically. Changes you make directly in the product are separate.</p></details>
          {draft.changed && draft.retained && <p className="moments-package__hint">Draft kept in this tab</p>}
        </>}
    </div>
    <footer className="moments-package__footer">
      {playing && <div className="moments-package__row"><p>Pause playback before starting a new run.</p>
        <button type="button" disabled={!canPause} onClick={onPause}>{playing.pauseRequested ? "Pausing…" : "Pause"}</button></div>}
      <div className="moments-package__row">
        <button type="button" data-moments-review disabled={!canPrepare} onClick={review ? onCommit : onReview}>{review ? "Start new run" : "Review changes"}</button>
        <button type="button" onClick={onBack}>{review ? "Back to values" : "Back"}</button>
      </div>
    </footer>
  </>;
}
