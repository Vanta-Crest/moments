"use client";

import { useEffect, useState } from "react";
import { MAX_SETUP_BYTES, parseMomentSetup, serializeSetupFile, validateSetupValues,
  type MomentCommandReply, type MomentsView, type SetupIssue, type SetupValues } from "../internal/protocol.js";
import type { MomentIntent } from "./useMomentsSession.js";

type Scratch = { identity: string; runRef: string; checkpointId: string; initialCheckpointId: string; values: SetupValues };
export type SetupReview = { kind: "ready"; intent: MomentIntent; values: SetupValues; checkpointId: string }
  | { kind: "unchanged" | "invalid" };

/** Browser-local scratch only. Accepted setup and browser replacement belong to the runner. */
export function useMomentSetup(view: MomentsView | undefined) {
  let setup: MomentsView["setup"];
  try {
    const candidate = view?.setup;
    if (candidate && Number.isSafeInteger(candidate.schemaVersion) && candidate.schemaVersion > 0) {
      const active = parseMomentSetup(candidate.active);
      const defaults = validateSetupValues(candidate.fields, candidate.defaults);
      const values = validateSetupValues(candidate.fields, active.values);
      if (active.schemaVersion === candidate.schemaVersion && defaults.ok && values.ok)
        setup = { ...candidate, defaults: defaults.values, active: { schemaVersion: active.schemaVersion, values: values.values } };
    }
  } catch { /* A malformed capability is not permission to invent its values. */ }
  const identity = setup && view?.runRef ? `${view.sessionId}:${view.journey.id}:${setup.schemaVersion}:${view.runRef}` : undefined;
  const storageKey = setup && view ? `moments-draft:${view.sessionId}:${view.journey.id}:${setup.schemaVersion}` : undefined;
  const [scratch, setScratch] = useState<Scratch>();
  const [issues, setIssues] = useState<readonly SetupIssue[]>([]);
  const [retained, setRetained] = useState(false);
  const [download, setDownload] = useState<"idle" | "started" | "failed">("idle");
  const draft = scratch?.identity === identity ? scratch : undefined;
  const values = draft?.values ?? setup?.active.values ?? {};
  const checkpointId = draft?.checkpointId ?? view?.lastVerified?.checkpointId ?? view?.checkpoints[0]?.id ?? "";
  const targetChanged = !!draft && checkpointId !== draft.initialCheckpointId;
  const changed = targetChanged || !!setup && setup.fields.some(field => values[field.key] !== setup.active.values[field.key]);
  const summary = setup?.active.values[setup.fields[0]?.key ?? ""];
  const unavailable = !!view?.setup && !setup;

  useEffect(() => {
    setScratch(undefined); setIssues([]); setRetained(false); setDownload("idle");
    if (!identity || !storageKey || !setup || !view?.runRef) return;
    try {
      const text = sessionStorage.getItem(storageKey);
      if (!text || new TextEncoder().encode(text).byteLength > MAX_SETUP_BYTES) return;
      const saved = JSON.parse(text) as Scratch;
      const parsed = parseMomentSetup({ schemaVersion: setup.schemaVersion, values: saved.values });
      if (saved.identity !== identity || saved.runRef !== view.runRef
        || !view.checkpoints.some(point => point.id === saved.initialCheckpointId)
        || !view.checkpoints.some(point => point.id === saved.checkpointId)
        || Object.keys(parsed.values).length !== setup.fields.length
        || setup.fields.some(field => typeof parsed.values[field.key] !== "string")) return;
      setScratch({ identity, runRef: view.runRef, checkpointId: saved.checkpointId, initialCheckpointId: saved.initialCheckpointId, values: parsed.values }); setRetained(true);
    } catch { /* Storage is optional, and incompatible drafts are ignored. */ }
  }, [identity, storageKey]);

  function retain(next: Scratch) {
    setScratch(next); setIssues([]);
    try { if (!storageKey) throw Error(); sessionStorage.setItem(storageKey, JSON.stringify(next)); setRetained(true); }
    catch {
      setRetained(false);
      try { if (storageKey) sessionStorage.removeItem(storageKey); } catch { /* avoid reloading an older draft where possible */ }
    }
  }
  function begin() {
    if (draft || !identity || !view?.runRef || !setup) return;
    retain({ identity, runRef: view.runRef, checkpointId, initialCheckpointId: checkpointId, values: { ...setup.active.values } });
  }
  function change(key: string, value: string) {
    if (!identity || !view?.runRef || !setup?.fields.some(field => field.key === key)) return;
    retain({ identity, runRef: view.runRef, checkpointId, initialCheckpointId: draft?.initialCheckpointId ?? checkpointId, values: { ...values, [key]: value } });
  }
  function chooseTarget(id: string) {
    if (!identity || !view?.runRef || !setup || !view.checkpoints.some(point => point.id === id)) return;
    retain({ identity, runRef: view.runRef, checkpointId: id, initialCheckpointId: draft?.initialCheckpointId ?? checkpointId, values: { ...values } });
  }
  function restoreDefaults() {
    if (identity && view?.runRef && setup) retain({ identity, runRef: view.runRef, checkpointId, initialCheckpointId: draft?.initialCheckpointId ?? checkpointId, values: { ...setup.defaults } });
  }
  function discard() {
    setScratch(undefined); setIssues([]); setRetained(false);
    try { if (storageKey) sessionStorage.removeItem(storageKey); } catch { /* optional scratch */ }
  }
  function review(): SetupReview {
    if (!setup || !view?.runRef || !view.checkpoints.some(point => point.id === checkpointId)) {
      setIssues([{ message: "Choose an available checkpoint for this run." }]); return { kind: "invalid" };
    }
    const parsed = validateSetupValues(setup.fields, values);
    if (!parsed.ok) { setIssues(parsed.issues); return { kind: "invalid" }; }
    setIssues([]);
    if (!targetChanged && setup.fields.every(field => parsed.values[field.key] === setup.active.values[field.key])) { discard(); return { kind: "unchanged" }; }
    return { kind: "ready", values: parsed.values, checkpointId,
      intent: { runRef: view.runRef, expectedRevision: view.revision,
        command: { kind: "restart", checkpointId, setup: { schemaVersion: setup.schemaVersion, values: parsed.values } } } };
  }
  function receive(reply: MomentCommandReply | undefined) {
    if (reply && !reply.accepted && reply.reason === "invalid-setup") {
      setIssues(reply.issues.map(issue => issue.field && setup?.fields.some(field => field.key === issue.field)
        ? issue : { message: issue.message }));
      return false;
    }
    return true;
  }
  function exportCurrent() {
    const target = view?.lastVerified?.checkpointId ?? view?.checkpoints[0]?.id;
    let url: string | undefined;
    try {
      if (!setup || !view || !target || !view.checkpoints.some(point => point.id === target)) throw Error();
      const text = serializeSetupFile({ formatVersion: 1, journeyId: view.journey.id, checkpointId: target, setup: setup.active });
      url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `${view.journey.id}.${target}.setup.json`;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setDownload("started");
    } catch { setDownload("failed"); }
    finally { if (url) { const owned = url; setTimeout(() => URL.revokeObjectURL(owned), 0); } }
  }
  return { setup, unavailable, values, checkpointId, changed, summary, issues, retained, download,
    begin, change, chooseTarget, restoreDefaults, discard, review, receive, exportCurrent };
}
