# Authoring a journey


A journey has an ordered checkpoint list and four driver functions. The following
illustrates an application that exposes a registration page and an Email field;
the selectors and verification must match the application you actually own.

```ts
import { expect } from "@playwright/test";
import { defineJourney, openMoment } from "@vanta-crest/moments";

const registration = defineJourney({
  id: "registration",
  title: "Registration",
  checkpoints: [
    { id: "empty", title: "Empty form" },
    { id: "filled", title: "Review details" },
  ],
  create({ page, baseURL }) {
    const email = "preview@example.test";
    return {
      async enter(id) {
        if (id === "empty") await page.goto(new URL("/register", baseURL).href);
        if (id === "filled") await page.getByLabel("Email").fill(email);
      },
      async verify(id) {
        await expect(page.getByLabel("Email")).toBeVisible();
        await expect(page.getByLabel("Email")).toHaveValue(id === "filled" ? email : "");
      },
      async reconcile() {
        const value = await page.getByLabel("Email").inputValue();
        if (value === email) return "filled";
        if (value === "") return "empty";
        throw new Error("The form does not match a supported checkpoint");
      },
      async cleanup() {
        // This example does not submit or create application resources.
        return "complete";
      },
    };
  },
});

const session = await openMoment({
  baseURL: "http://127.0.0.1:3000",
  journeys: [registration],
  async beforeRun() {
    // Check that the intended local/test environment is available.
    const response = await fetch("http://127.0.0.1:3000/register");
    if (!response.ok) throw new Error("Application unavailable");
  },
  outputDir: ".moments/runs",
}, { target: "registration.filled" });

// A headed browser is held at the checkpoint. A UI can send controls, or the
// caller can inspect session.view(), issue commands and await session.settled().
// The caller must retain ownership until completion and end in its finally block.
try {
  const view = session.view();
  console.log(view.activity, view.lastVerified?.checkpointId);
} finally {
  const result = await session.end();
  if (result.outcome === "incomplete") process.exitCode = 1;
}
```

For unattended use, pass `{ target: "registration.filled", once: true }` and
await `session.done`. This defaults to headless Chromium and cleans up after the
target is verified. For an interactive host, keep the session alive for its UI
and arrange `end()` on host shutdown. `AbortSignal` requests orderly cleanup; it
cannot interrupt a driver operation that never settles. Use bounded application
operations. A forced process kill cannot guarantee cleanup.

### Driver contract

| Function | Responsibility |
| --- | --- |
| `create(context)` | Synchronously return a driver before starting application work. Retain resources as soon as they are acquired so cleanup can handle partial entry. |
| `enter(checkpoint)` | Perform only the work needed to reach the next checkpoint. The runner visits prerequisites in order. |
| `verify(checkpoint)` | Establish the real outcome without repeating the business action. Throw if the outcome is unproven. |
| `reconcile()` | Positively identify the current supported checkpoint. Throw for unknown state; a checkpoint behind the held position is rejected. |
| `cleanup()` | Settle and release only resources owned by this run, even after failed entry or verification. Return `complete` or `neutralized-with-residue`; throw when safety cannot be established. |

The runner owns and closes the browser. Drivers own application resources and
must not close the browser themselves. Set the page's default timeouts once in the
config with `navigationTimeoutMs` and `actionTimeoutMs` (for slow development
servers) rather than in every journey; a journey may still set its own in `create`.

Throw errors that say what was expected (`Error("Approval badge not shown")`):
the first line of a failed step's message is what the CLI and Director show.

`reconcile` usually checks from the last checkpoint back to the last verified one.
`furthestVerified` does exactly that and throws a clear error when nothing in
that range can be verified:

```ts
import { furthestVerified } from "@vanta-crest/moments";

const order = ["empty", "filled"] as const;
type Step = (typeof order)[number];

// inside create():
let verified: Step = "empty";
async function verify(id: Step) {
  await expect(page.getByLabel("Email")).toHaveValue(id === "filled" ? email : "");
  verified = id;
}
return { enter, verify, reconcile: () => furthestVerified(order, verified, verify), cleanup };
```

The floor is the furthest checkpoint this run has verified, so reconciliation
never moves behind it.

### Resuming a journey

On a shared development stack a later checkpoint may already be true from an
earlier run, and replaying every `enter` can take many minutes. `--resume`
(`openMoment(..., { resume: true })`) calls `verify` before entering each
checkpoint, including the target. A checkpoint that verifies is recorded with
provenance `existing` and is not entered. At the first one that does not verify,
the run enters it and everything after it as usual. A failed probe is not
recorded as a failure.

A probe runs with page timeouts of `resumeProbeTimeoutMs` (default 3000), so an
absent checkpoint costs seconds, not a full navigation timeout. Afterwards the
page gets `navigationTimeoutMs` / `actionTimeoutMs` back, or Playwright's 30 s
default: under `--resume`, a timeout set in `create` does not survive the probe,
so set timeouts in the config. Playwright `expect` timeouts are separate and
still apply.

A journey is resumable only when each `verify` proves product state that outlives
a run, from a fresh page: it navigates to what it checks, or reads the product's
own API. It must not depend on in-page state (a value typed earlier, the page the
previous step left open), and it must not depend on data derived from `runRef`,
because a resumed run has a new `runRef`. A journey that creates per-run records
(like the task-app example) is not resumable; run it without `--resume`. Construction must not start asynchronous
work: a constructor that throws cannot return a cleanup handler.

Manual progress is verified before adoption. Intermediate checkpoints are marked
skipped. A Continue that adopts a manually reached checkpoint stops there; a
second Continue requests the next action. Failed destination verification holds
the session: Check retries that destination, without repeating its entry action.
An earlier failed observation remains in the result even when a later check
passes. Cleanup after restart completes before a replacement run is admitted.

### Public run values

A configurable journey adds a small `setup` definition. Keep identity, passwords,
tokens and resource custody in the existing per-run driver. The setup contains
only public text that the reviewer may use to autofill native forms.

```ts
import { defineJourney, validateSetupValues, type SetupDefinition } from "@vanta-crest/moments";

const fields = [{ key: "displayName", label: "Display name", maxLength: 120 }] as const;
const setup: SetupDefinition = {
  schemaVersion: 1,
  fields,
  defaults: { displayName: "Amara Okafor" },
  parse: values => validateSetupValues(fields, values),
};
```

Pass this definition as `defineJourney({ setup, ... })`. The runner validates
defaults and calls the pure parser before admission. Add domain constraints in
that parser when needed; use the same native validators as your product where
possible. Explicit input must have every declared key and no unknown keys. Values
are trimmed, required and bounded by each field's native limit. Omitted setup
selects defaults; an empty value or partial object never merges with defaults.

`create({ setup, runRef, ... })` receives the immutable canonical snapshot. A
small journey parser may parse it again to obtain named fields. Generate private
credentials only inside that new run's driver. Use the same captured values in
entry, verification and reconciliation; cleanup retains the driver's own resource
custody. Reviewers may make lawful manual edits in the product. Those edits do
not silently rewrite the requested setup, and verification must preserve the
journey's existing rules for accepting manual progress. For example, Console's
legal name is an independent input, not an automatic rename of its organisation.

To start with explicit values, pass `setup: { schemaVersion, values }` to
`openMoment`. Invalid setup throws `MomentSetupError` before `beforeRun`, browser
or fixture effects. A restart command may carry the same complete setup shape;
rejected input returns `reason: "invalid-setup"` with bounded field/form issues
and leaves the active run usable. An `open` command cannot carry changed values.

Every accepted value change starts a full new run. Continue, Play, ordinary
Restart and backward navigation use the active snapshot, regardless of any panel
draft. The runner copies the candidate synchronously and persists its
`replacementRequested` target and values before old cleanup. It persists the new
run's active setup before creating its driver. Acknowledgment only establishes
admission, not replacement success. Browser replacement destroys same-tab scratch
state; the new panel starts from the new run's active values.

The panel's **Export run setup** downloads active requested inputs and the shown
last verified checkpoint (or the first checkpoint if none is verified). Manual
product edits and generated access are excluded. Import that file with
`moments open --setup ./review.json`. The versioned JSON format and bounds
are shared through the browser-safe `/protocol` exports. File I/O belongs in the
CLI, and a downloaded filename is not a runner-owned recovery path.

### Controls and completion

`session.view()` returns the authoritative activity, revision, checkpoint state
and allowed controls. Commands use the current `runRef` and `revision`:

```ts
const view = session.view();
if (view.runRef && view.controls.continue) {
  const reply = session.command({
    runRef: view.runRef,
    revision: view.revision,
    command: { kind: "continue" },
  });
  if (reply.accepted) await session.settled();
}
```

Supported commands are `check`, `continue`, `end`, `open` with `checkpointId`,
`restart` with `checkpointId`, `play` with `checkpointId` and `pace`, and `pause`.
A command reply acknowledges admission, not
successful completion. Stale, busy, unavailable or invalid-setup commands are rejected and are
never replayed. `end()` is idempotent and waits for in-flight work and cleanup.
`done` resolves with the final result. Initialization failure rejects
`openMoment()` with `MomentOpenError` after finalization; its `result` contains
safe stage/code information.

`continue` advances one checkpoint, or verifies progress already made by the
reviewer. `play` uses the same native actions and verification to reach a later
checkpoint. Set `pace` to `immediate`, or `demo` for a three-second wait between
verified steps. The delay never replaces product readiness checks. Manual progress
during a wait is reconciled before the next action; reaching beyond the requested
target does not silently rewind the product.

`pause` is available during playback. It finishes and verifies an in-flight step,
then returns to `ready` without cleanup. During the between-step wait, it stops
immediately. Another `play` continues from the verified position. `end` interrupts
the demonstration wait, settles any active step, and performs existing cleanup.
Initial target preparation retains its existing End/abort behavior.

The view exposes a discriminated `playback` state and optional safe `progress`.
Drivers can use `context.reportProgress?.('waiting-for-code')`, then clear it with
`undefined`, to explain a real wait. Credentials and authenticator codes must never
be included. Progress is session-local and notifications from ended/replaced runs
are ignored.

After a recoverable reconciliation refusal, `check` reconciles and verifies the
restored state without entering another checkpoint. Ordinary Check remains
verification-only. Successful recovery permits progression while retaining the
original failed history.

## Results

The default writer serializes updates and atomically replaces
`.moments/runs/<runRef>.json` through a temporary file. New directories use mode
`0700` and files `0600`; existing directory permissions are not changed. Results
use schema version 3 and contain identifiers, timestamps, observations, cleanup,
safe failure codes and optional public requested setup/replacement information.
They do not contain browser storage, credentials, screenshots or raw exceptions.
After each run the CLI also writes `<outputDir>/latest.json`:
`{ runRef, receipt, outcome, evidence? }` with absolute paths. Read it instead of
picking the newest receipt by time.

### Failure evidence

When `create`, `enter`, `verify`, `reconcile` or `cleanup` throws, Moments keeps
local evidence beside the receipts: `<outputDir>/../evidence/<runRef>/<stage>-<checkpoint>.txt`
(the message's first line, page URL, screenshot path, then the full message) and
`.png` (a full-page screenshot). A repeated failure of the same step gets `-2`,
`-3`. If the page body was empty, the first line adds "The page was blank: the
application server may not be responding." Set `evidenceDir` in the config to
put it elsewhere, or `false` to keep none. With `writeReceipt`, evidence is kept
only when `evidenceDir` is set. The receipt failure carries only `evidence`, the
path relative to the evidence directory. The message and screenshot never enter
the receipt, but they may show anything on the page or in an error, so treat the
evidence directory as private local data (directories `0700`, files `0600`).
Admission, browser, persistence and close failures keep their safe description
only.

Provide an awaited `writeReceipt(result)` instead of `outputDir` when integrating
with an application's existing store. Never supply both. Every writer receives
an isolated snapshot. Persistence failure makes completion incomplete. A failed
replacement-request or pre-cleanup write keeps the current driver and browser
alive and prevents replacement. Explicit End/shutdown still attempts cleanup and
browser closure; other existing persistence failures retain that finalization
behavior. The returned result retains in-memory evidence when the store could
not retain an update; it does not establish durable recovery.

`outcome` is `pending`, `complete`, `neutralized-with-residue` or `incomplete`.
A past failed operation remains visible and prevents a clean outcome. Residue is
an explicit driver assessment, not proof of deletion. Applications retain their
own resource inventory and any additional domain evidence they require.

## React integration

Import `useMomentsSession` from `@vanta-crest/moments/react`. It exposes connection,
authoritative view, sending/message state and `submit(intent)`. The hook handles
poll ordering, stale sessions, version mismatch and connection loss without
replaying actions. Import the optional `MomentsPanel` and `/styles.css` for native controls, or build your own panel over this hook.

The browser bridge is available only in the runner-owned page's main frame at
the configured origin. Other pages, iframes and origins cannot use it to read or
command the run. This is a local development control, not a production feature.
With `director: true`, no application page has the bridge; only the runner-owned
Moments Director window, on its own reserved origin, can read or command the run.

The root entry is for Node; `/react` and `/protocol` are browser-safe. React is an
optional peer and is unnecessary for the Node runner. The `/protocol` export supports existing browser-safe consumers.
