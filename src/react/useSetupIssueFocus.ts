"use client";

import { useEffect, type RefObject } from "react";
import type { SetupIssue } from "../setup.js";

/** Runs after validation renders, including when a rejected review reopens the editor. */
export function useSetupIssueFocus(issues: readonly SetupIssue[], form: RefObject<HTMLFormElement>, editing = true) {
  useEffect(() => {
    if (!editing || !issues.some(issue => issue.field)) return;
    const input = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [issues, form, editing]);
}
