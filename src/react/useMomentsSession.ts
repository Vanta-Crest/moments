"use client";

import { useEffect, useRef, useState } from "react";
import { PACKAGE_VERSION, type MomentCommand, type MomentCommandReply, type MomentsBridge, type MomentsView } from "../internal/protocol.js";

declare global { interface Window { moments?: MomentsBridge } }
type Connection = { kind: "connecting" | "unavailable" } | { kind: "connected"; view: MomentsView }
  | { kind: "disconnected"; view?: MomentsView | undefined }
  | { kind: "incompatible"; view?: MomentsView | undefined };
export type MomentIntent = { command: MomentCommand; runRef: string; opening?: "reuse" | "fresh-run" | undefined;
  /** Revision reviewed when confirming an action; ordinary actions use the fresh observation. */
  expectedRevision?: number | undefined };
const changedMessage = "The session changed. Review the current state before trying again.";
const setupMessage = "Review the run values before trying again.";

/** Lifecycle adapter to the external runner binding, not a product-data fetch path. */
export function useMomentsSession() {
  const [connection, setConnection] = useState<Connection>({ kind: "connecting" });
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const lifetime = useRef(0), sequence = useRef(0), inFlight = useRef(false);
  const observed = useRef<MomentsView>();
  async function read(epoch: number) {
    const generation = ++sequence.current;
    const bridge = window.moments;
    try {
      if (bridge && bridge.packageVersion !== PACKAGE_VERSION) {
        if (epoch === lifetime.current && generation === sequence.current)
          setConnection({ kind: "incompatible", view: observed.current });
        return undefined;
      }
      const view = await bridge?.read();
      if (epoch === lifetime.current && generation === sequence.current) {
        if (view) { observed.current = view; setConnection({ kind: "connected", view }); }
        else setConnection({ kind: "unavailable" });
      }
      return view;
    } catch (error) {
      if (epoch === lifetime.current && generation === sequence.current)
        setConnection({ kind: "disconnected", view: observed.current });
      throw error;
    }
  }
  useEffect(() => {
    const epoch = ++lifetime.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await read(epoch); } catch { /* connection state carries the failure */ }
      if (epoch === lifetime.current) timer = setTimeout(poll, 750);
    }
    void poll();
    return () => { lifetime.current++; sequence.current++; clearTimeout(timer); };
  }, []);
  function dismissReviewFeedback() {
    setMessage(previous => previous === changedMessage || previous === setupMessage ? "" : previous);
  }
  async function submit(intent: MomentIntent): Promise<MomentCommandReply | undefined> {
    if (inFlight.current || connection.kind !== "connected") return;
    const epoch = lifetime.current;
    inFlight.current = true; setSending(true); setMessage("");
    try {
      const bridge = window.moments;
      const current = await read(epoch);
      if (epoch !== lifetime.current) return;
      const command = intent.command;
      const opening = command.kind === "open"
        ? current?.checkpoints.find(point => point.id === command.checkpointId)?.opening : undefined;
      if (!bridge || bridge !== window.moments || bridge.packageVersion !== PACKAGE_VERSION || !current || current.runRef !== intent.runRef
        || (intent.expectedRevision !== undefined && current.revision !== intent.expectedRevision)
        || (intent.command.kind === "open" && opening !== intent.opening)) {
        setMessage(changedMessage); return;
      }
      const reply = await bridge.command({ runRef: intent.runRef, revision: current.revision, command: intent.command });
      if (epoch !== lifetime.current) return;
      if (!reply.accepted) setMessage(reply.reason === "invalid-setup"
        ? setupMessage : changedMessage);
      await read(epoch);
      return epoch === lifetime.current ? reply : undefined;
    } catch {
      if (epoch === lifetime.current) setMessage("Connection interrupted. Check the session before trying again. The action will not be replayed.");
    } finally {
      inFlight.current = false;
      if (epoch === lifetime.current) setSending(false);
    }
  }
  return { connection, sending, message, submit, dismissReviewFeedback };
}
