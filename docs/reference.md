# Reference

```sh
moments list [--config path]
moments open journey.checkpoint [--config path] [--once] [--headless] [--resume] [--output dir] [--record [--chapters]]
moments open [journey.checkpoint] --setup ./review.json [--config path] [--once] [--headless] [--resume] [--output dir] [--record [--chapters]]
moments --help
```

Default config is exactly `./moments.config.ts`; no parent search. It exports a
`MomentsConfig` (optionally wrapped in `defineConfig`): `baseURL`, `journeys`,
required async `beforeRun`, and either `outputDir` or awaited `writeReceipt`.
Optional `director: true` opens interactive runs (not `--once`) with a separate
Moments Director window that is the sole holder of the browser bridge: application
pages on every origin see no `window.moments`. Closing the Director ends the
session like closing the app window (cleanup, receipt, both windows close).
Restart and backward open close and reopen both windows.
Optional `navigationTimeoutMs` / `actionTimeoutMs` set the managed page's
default timeouts before `create`. Optional `resumeProbeTimeoutMs` (default 3000)
bounds each resume probe. Optional `evidenceDir` (string beside the config, or
`false`) places failure evidence; the default is `<outputDir>/../evidence`.
CLI output defaults to `.moments/runs` relative to the config file. `--output dir`
replaces it for one run, relative to the caller's cwd; it requires `outputDir`
mode, not `writeReceipt`. `--resume` verifies each checkpoint before entering it.
While a run works, the CLI prints a timed line to stderr as each checkpoint is
entered and verified, and while a journey reports `waiting-for-code`.
After a run the CLI prints a line per failure (checkpoint, stage, first message
line, evidence path) and a per-checkpoint summary, and writes
`<outputDir>/latest.json` (`runRef`, `receipt`, `outcome`, optional `evidence`
and `recording`). `--record` films the run into
`<evidence>/<runRef>/recording/` and needs a local evidence directory;
`--chapters` (with `--record`) draws each checkpoint's title and description as
it is verified, for two seconds. Direct API
paths follow the caller's cwd. Config modules execute trusted local code.
Setup file paths resolve from the caller's cwd. Only `open` accepts `--setup`,
once. Its journey/checkpoint supplies the target; an optional positional target
must match exactly. Invalid setup exits 2 before admission or provisioning.

`defineJourney` validates ordered unique checkpoints. A checkpoint marked
`private: true` is never recorded (see below). Its synchronous `create`
returns a driver with `enter`, `verify`, `reconcile` and `cleanup`. Context supplies
Playwright `page`, `baseURL`, `runRef`, optional immutable `setup` and optional
`reportProgress`. Optional journey `setup` declares a positive integer schema
version, fields, complete defaults and a pure parser. Unconfigured journeys
reject explicit setup.

`openMoment(config, {target, setup?, once?, headless?, resume?, signal?, record?, onEvent?})` prepares the target and
returns a session. `record: { chapters? }` films the run. `onEvent(event)` is told
`entering` (`checkpointId`), `observed` (`checkpointId`, `provenance`, `status`,
with the receipt's own `at`) and `progress` (`progress` or `null`) events. Initialization failure throws `MomentOpenError` after
finalization; inspect its safe `result`. `--once` defaults headless and ends after
verification. Interactive runs hold the browser until End or a shutdown signal.
Input rejection throws `MomentSetupError` before effects; its bounded `issues`
carry field/form messages without raw values.

| Session member | Meaning |
| --- | --- |
| `view()` | Authoritative run, revision, activity and permitted controls |
| `command({runRef, revision, command})` | Admission reply, not proof of successful completion |
| `settled()` | Wait for the current operation |
| `currentResult()` | Independent result snapshot |
| `end()` | Idempotent cleanup after active work settles |
| `done` | Final result when the session ends |

Commands: `continue`, `check`, `end`, `pause`; `open`/`restart` with `checkpointId`;
`play` with `checkpointId` and `pace: "immediate" | "demo"`. Demo playback waits
three seconds between verified steps; Pause finishes the active step. Stale,
busy and unavailable commands are rejected, never replayed.
Only `restart` also accepts an optional complete `setup`. Invalid input returns
`{ accepted: false, reason: "invalid-setup", issues }` without disturbing the run.
Restart/backward open retains active values when no new setup is supplied.

`/react` exports `MomentsPanel({defaultCollapsed?, standalone?})`, `useMomentsSession()` and
browser-safe protocol types. Load `/styles.css` explicitly. The hook returns
`connection`, `sending`, `message`, and `submit(intent)`; intent includes command,
runRef and the observed opening consequence for an open command. `/protocol`
supports existing consumers. The root export is for Node.
The default panel occupies normal document flow; the host chooses its placement.

Results have schema version 3, identifiers, timestamps, observations, safe failure
stages/codes, optional relative `evidence` paths and cleanup. Observation
provenance is `native` (entered by this run), `manual` (reached by the reviewer)
or `existing` (already true on resume, not entered).
`furthestVerified(order, floor, verify)` returns the furthest checkpoint from the
end back to `floor` whose `verify` passes, or throws. Outcomes: `pending`, `complete`,
`neutralized-with-residue`, `incomplete`. Failure history survives retries. New
receipt directories use `0700`, files `0600`, and updates use atomic replacement.
Existing directory permissions are not changed. Receipts collect no raw exceptions,
credentials, browser storage or screenshots; failure messages and screenshots go
only to the local evidence directory.
Optional `setup` records requested autofill values, not observed/manual product
values. Optional `replacementRequested: { checkpointId, setup }` records an
accepted request, not successful replacement. It is persisted on the old run
before cleanup; the new run records `previousRunRef` and its own active setup.

Setup files are UTF-8 JSON of at most 64 KiB with this exact envelope:

```json
{
  "formatVersion": 1,
  "journeyId": "console.onboarding",
  "checkpointId": "workspace-ready",
  "setup": {
    "schemaVersion": 1,
    "values": {
      "organisationName": "Atlas Markets",
      "legalName": "Atlas Markets Limited",
      "ownerName": "Amara Okafor",
      "intendedUse": "Collect customer payments for our retail business.",
      "applicationName": "Retail collections"
    }
  }
}
```

`parseSetupFile`, `serializeSetupFile`, `parseMomentSetup`, `validateSetupValues`
and `resolveSetup` are available from root and browser-safe `/protocol` exports.
Explicit values are complete strings; no partial patches, default merging or
unknown/private keys. Structural codecs do not replace journey admission rules.

## Recordings

`--record` sets a 1280×720 viewport at device scale 2 and writes, in
`<evidence>/<runRef>/recording/` (directories `0700`, files `0600`):

- `segment-<n>.webm`: 1920×1080 VP8 video at 25 fps. A new segment starts each
  time filming resumes after a private checkpoint. Measured on the task app with
  Playwright 1.60: about 3 MB per minute (about 2.3 MB at 720p).
- `<checkpointId>.jpg` (then `-2`, `-3` on repeats): the video frame on screen when
  that checkpoint was verified. Private checkpoints have none.
- `timeline.json`:

```json
{
  "schemaVersion": 1, "runRef": "…", "journeyId": "task",
  "viewport": { "width": 1280, "height": 720 }, "videoSize": { "width": 1920, "height": 1080 },
  "chapterMs": 2000,
  "checkpoints": [{ "id": "created", "title": "Task created", "description": "…" }],
  "segments": [{ "file": "segment-1.webm", "startedAt": "2026-11-24T00:14:37.161Z" }],
  "events": [
    { "kind": "entering", "checkpointId": "created", "at": "…", "segment": 0, "offsetMs": 2570 },
    { "kind": "observed", "checkpointId": "created", "provenance": "native", "status": "passed",
      "at": "…", "segment": 0, "offsetMs": 2666, "frame": "created.jpg" }
  ]
}
```

`at` on an `observed` event is the receipt observation's own time. `segment` and
`offsetMs` (milliseconds into that segment) are absent while filming is paused.
A segment the browser closed before it was saved is listed with `lost: true`:
in an interactive session, finish with End rather than closing the window.
`chapterMs` is present with `--chapters`; checkpoints carry `private: true` when
marked. `stoppedEarly: true` means a recording error stopped filming; the run
itself was unaffected. A recording is local evidence, never part of the receipt.
