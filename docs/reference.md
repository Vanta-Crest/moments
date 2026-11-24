# Reference

This page lists every command, option, field and file format, for looking things up. The [guides](../README.md#documentation) explain when to use them.

## CLI

```text
moments list [--config <path>]
moments open <journey.checkpoint> [--config <path>] [--once] [--headless] [--resume] [--output <dir>]
             [--record [--chapters] | --window <width>x<height>]
moments open [journey.checkpoint] --setup <path> [same options]
moments verify [runRef] [--config <path>] [--output <dir>]
moments report [runRef] [--config <path>] [--output <dir>]
moments --help
```

| Command | Does |
| --- | --- |
| `list` | Prints every target as `journey.checkpoint`, a tab, then `Journey title / Checkpoint title`. |
| `open` | Admits, opens the browser, reaches the target and verifies each checkpoint on the way. Interactive until End, unless `--once`. |
| `verify` | Recomputes the fingerprints in a run's manifest. Defaults to the run in `latest.json`. |
| `report` | Writes `<runRef>.html`, the run sheet, beside the receipt. Defaults to the run in `latest.json`. |

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--config <path>` | all | Config file. Default `./moments.config.ts`; parent directories are not searched. |
| `--once` | `open` | Headless; verify the target, clean up, exit. |
| `--headless` | `open` | An interactive session with no visible browser. |
| `--resume` | `open` | Verify each checkpoint before entering it. See [Resume](guides/resume.md). |
| `--output <dir>` | `open`, `verify`, `report` | Receipt directory for this command, relative to the current directory. Needs a config with `outputDir`, not `writeReceipt`. |
| `--setup <path>` | `open` | Start from a [setup file](#setup-file). A positional target, if given, must match it. |
| `--record` | `open` | Film the run. See [Recording](guides/recording.md). Needs a local evidence directory. |
| `--chapters` | `open`, with `--record` | Draw each checkpoint's title and description into the video as it is verified. |
| `--window <W>x<H>` | `open`, not with `--record` | Size the application window's page area; 320 to 3840 pixels a side. |

Each option may be given once. Relative paths in the config resolve beside the config file; paths given on the command line resolve from the current directory.

| Exit status | Meaning |
| --- | --- |
| 0 | `open`: the run completed. `verify`: every file matches. `list`, `report`: done. |
| 1 | `open`: the run is incomplete. `verify`: at least one file differs. |
| 2 | Invalid arguments, config or setup file. Nothing was opened. |
| 130 | Interrupted by SIGINT, after cleanup. |
| 143 | Interrupted by SIGTERM, after cleanup. |

Progress lines go to stderr as each checkpoint is entered and verified. The summary goes to stdout.

## Config

`moments.config.ts` default-exports a config, optionally wrapped in `defineConfig` for type inference.

| Field | Required | Meaning |
| --- | --- | --- |
| `baseURL` | yes | `http:` or `https:`, with no credentials in it. |
| `journeys` | yes | At least one journey; ids unique. |
| `beforeRun(journeyId)` | yes | Awaited before any browser opens. Throw to refuse the run. |
| `environment` | no | One line, at most 80 characters, naming the system. Kept in receipts. |
| `outputDir` | no | Receipt directory. Default `.moments/runs`. Not with `writeReceipt`. |
| `writeReceipt(result)` | no | Your own awaited receipt store, in place of `outputDir`. |
| `evidenceDir` | no | Failure evidence and recordings. Default `<outputDir>/../evidence`; none with `writeReceipt` unless set; `false` turns it off. |
| `director` | no | `true` opens run controls in a separate Moments Director window. Interactive runs only. |
| `navigationTimeoutMs` | no | Default navigation timeout for the page, in milliseconds. |
| `actionTimeoutMs` | no | Default action timeout for the page, in milliseconds. |
| `resumeProbeTimeoutMs` | no | Page timeout while `--resume` probes a checkpoint. Default 3000. |
| `catalogue` | no | See [Catalogue](guides/catalogue.md). |

## Journeys

| Function | Returns |
| --- | --- |
| `defineStepJourney({ id, title, checkpoints, setup?, restartExplanation?, create })` | A journey whose `create(context)` returns `{ steps, cleanup }`. |
| `defineJourney({ id, title, checkpoints, setup?, restartExplanation?, create })` | A journey whose `create(context)` returns `{ enter, verify, reconcile, cleanup }`. |
| `furthestVerified(order, floor, verify)` | The furthest checkpoint, from the end back to `floor`, whose `verify` passes; throws if none does. |

Checkpoint fields are in [Writing journeys](guides/writing-journeys.md#checkpoint-fields). The `create` context holds `page` (Playwright), `baseURL`, `runRef`, `setup` (if the journey declares values) and `reportProgress`.

## Running from code

```ts
import { openMoment } from '@vanta-crest/moments';
import config from './moments.config.js';

const session = await openMoment(config, { target: 'task.completed', once: true });
const result = await session.done;
if (result.outcome === 'incomplete') process.exitCode = 1;
```

| `openMoment` option | Meaning |
| --- | --- |
| `target` | `journey.checkpoint`. Required. |
| `once` | End after the target is verified. Implies headless unless `headless` is set. |
| `headless` | No visible browser. |
| `resume` | Verify before entering. |
| `setup` | `{ schemaVersion, values }` for a journey with run values. |
| `record` | `{ chapters?: boolean }` to film the run. |
| `window` | `{ width, height }` for the page area. Not with `record`. |
| `signal` | An `AbortSignal` that requests orderly cleanup. It cannot interrupt a driver call that never settles. |
| `onEvent(event)` | Told `entering`, `observed` and `progress` events as they happen. |

`openMoment` resolves once the target is reached and verified. If that fails, Moments cleans up and throws `MomentOpenError`, whose `result` is the final receipt. Invalid run values throw `MomentSetupError` before anything happens.

The direct API does not write `latest.json` or a manifest; the CLI does. Relative paths in a config passed to `openMoment` resolve from the current directory, not from the config file.

### Session and commands

| Session member | Meaning |
| --- | --- |
| `view()` | The current run, revision, activity, checkpoints and permitted controls. |
| `command({ runRef, revision, command })` | Sends a command. The reply says whether it was admitted, not whether it succeeded. |
| `settled()` | Waits for the current operation. |
| `currentResult()` | A snapshot of the receipt. |
| `end()` | Cleans up after active work settles. Safe to call more than once. |
| `done` | Resolves with the final receipt when the session ends. |

| Command | Does |
| --- | --- |
| `{ kind: 'continue' }` | Adopts verified manual progress, or enters the next checkpoint. |
| `{ kind: 'check' }` | Verifies the held checkpoint again without entering. |
| `{ kind: 'play', checkpointId, pace }` | Advances to `checkpointId`; `pace` is `'immediate'` or `'demo'` (three seconds between steps). |
| `{ kind: 'pause' }` | Finishes and verifies the step in progress, then stops. |
| `{ kind: 'open', checkpointId }` | Moves to a later checkpoint in this run, or starts a fresh run at an earlier one. |
| `{ kind: 'restart', checkpointId, setup? }` | Cleans up and starts a fresh run at `checkpointId`, optionally with new run values. |
| `{ kind: 'end' }` | Cleans up and closes. Always accepted while the session is open. |
| `{ kind: 'select', requestRef, target }` | See [Catalogue](guides/catalogue.md). |

A refused command replies `{ accepted: false, reason }` with `reason` `stale` (wrong run or revision), `busy`, `unavailable` or `invalid-setup` (with `issues`). Refused commands are never replayed.

### View fields worth knowing

| Field | Meaning |
| --- | --- |
| `activity` | `preparing`, `ready`, `working`, `needs-attention`, `closing` or `closed`. |
| `checkpoints[]` | `id`, `title`, `description`, `status` (`not-checked`, `passed`, `skipped`, `failed`), `opening`, `actor`, `private`, and `observed` (`at`, `provenance`). |
| `controls` | Booleans for `check`, `continue`, `play`, `pause`, `restart`, `end`. |
| `failure` | `stage`, `checkpointId`, and, in this session only, `detail` (first line of the message) and `evidence` (file path). |
| `message` | A plain explanation of the failure and what to do. |
| `environment`, `origin` | The system the run is driving. |
| `recording` | `filming` or `paused`; present only when recording. |
| `progress` | `waiting-for-code` during a reported wait. |

## Receipt

`<outputDir>/<runRef>.json`, schema version 3. A completed `--once` run of the example:

```json
{
  "schemaVersion": 3,
  "packageVersion": "0.3.0",
  "sessionId": "05cc768e-7fc4-4041-a523-2ab8c9cdaca3",
  "runRef": "be13f1a4-f7e7-4213-95f5-6e9e4ac24757",
  "journeyId": "task",
  "journeyTitle": "Create and complete a task",
  "checkpoints": [
    { "id": "draft", "title": "Empty draft" },
    { "id": "created", "title": "Task created" },
    { "id": "completed", "title": "Task completed" }
  ],
  "environment": "Task app example, local",
  "origin": "http://127.0.0.1:4177",
  "target": "completed",
  "activity": "closed",
  "startedAt": "2026-11-24T00:24:54.913Z",
  "updatedAt": "2026-11-24T00:25:02.936Z",
  "observations": [
    { "checkpointId": "draft", "at": "2026-11-24T00:24:55.483Z", "provenance": "native", "status": "passed" },
    { "checkpointId": "created", "at": "2026-11-24T00:24:57.943Z", "provenance": "native", "status": "passed" },
    { "checkpointId": "completed", "at": "2026-11-24T00:25:00.299Z", "provenance": "native", "status": "passed" }
  ],
  "cleanup": "complete",
  "failures": [],
  "outcome": "complete"
}
```

| Field | Meaning |
| --- | --- |
| `journeyTitle`, `checkpoints` | The journey as it stood for this run. Checkpoints carry `actor`, `covers` and `private: true` when set. |
| `environment`, `origin` | What system the run touched. `environment` only if configured. |
| `target` | The checkpoint id the run was opened at. |
| `previousRunRef` | The run this one replaced, after a restart or selection. |
| `setup` | The public run values requested, if the journey declares any. |
| `replacementRequested` | `{ checkpointId, setup }`: a fresh run with new values was requested. Recorded before cleanup. |
| `selection` | The catalogue selection that started this run. |
| `observations[]` | `checkpointId`, `at`, `provenance` (`native`, `manual`, `existing`), `status` (`passed`, `skipped`, `failed`). |
| `failures[]` | `stage` (`admission`, `browser`, `create`, `enter`, `verify`, `reconcile`, `cleanup`, `persist`, `close`), `code` (`operation-failed`, `persistence-failed`, `interrupted`), optional `checkpointId`, optional `evidence` (`<runRef>/<file>.txt`, relative to the evidence directory), `at`. |
| `cleanup` | `not-attempted`, `complete`, `neutralized-with-residue` or `incomplete`. |
| `outcome` | `pending`, `complete`, `neutralized-with-residue` or `incomplete`. |

## latest.json

`<outputDir>/latest.json`, rewritten by the CLI after every run. Read it instead of guessing the newest receipt by time. Paths are absolute.

| Field | Present |
| --- | --- |
| `runRef`, `receipt`, `outcome` | Always |
| `evidence` | The first failure's evidence file, if any |
| `recording` | The recording folder, with `--record` |
| `manifest` | The manifest, if it was written |

## Manifest

`<outputDir>/<runRef>.manifest.json`:

```json
{
  "schemaVersion": 1,
  "runRef": "be13f1a4-f7e7-4213-95f5-6e9e4ac24757",
  "packageVersion": "0.3.0",
  "createdAt": "2026-11-24T00:25:03.120Z",
  "algorithm": "sha256",
  "files": [
    { "path": "be13f1a4-f7e7-4213-95f5-6e9e4ac24757.json", "bytes": 1342, "sha256": "…" },
    { "path": "../evidence/be13f1a4-f7e7-4213-95f5-6e9e4ac24757/recording/timeline.json", "bytes": 2210, "sha256": "…" }
  ]
}
```

It lists the receipt and every file under `<evidence>/<runRef>/`. Paths are relative to the manifest and use `/`.

## timeline.json

`<evidence>/<runRef>/recording/timeline.json`, schema version 1:

```json
{
  "schemaVersion": 1,
  "runRef": "…",
  "journeyId": "task",
  "journeyTitle": "Create and complete a task",
  "environment": "Task app example, local",
  "origin": "http://127.0.0.1:4177",
  "viewport": { "width": 1280, "height": 720 },
  "videoSize": { "width": 1920, "height": 1080 },
  "chapterMs": 2000,
  "checkpoints": [{ "id": "created", "title": "Task created", "description": "One open task is stored in the backend." }],
  "segments": [{ "file": "segment-1.webm", "startedAt": "2026-11-24T00:14:37.161Z" }],
  "events": [
    { "kind": "entering", "checkpointId": "created", "at": "…", "segment": 0, "offsetMs": 2570 },
    { "kind": "observed", "checkpointId": "created", "provenance": "native", "status": "passed",
      "at": "…", "segment": 0, "offsetMs": 2666, "frame": "created.jpg" }
  ]
}
```

- `at` on an `observed` event is the receipt observation's own time.
- `segment` and `offsetMs` (milliseconds into that segment) are absent while filming is off.
- `progress` events mark the start and end of a reported wait.
- Checkpoints carry `actor`, `covers` and `private: true` when set. `chapterMs` is present with `--chapters`.
- A segment with `lost: true` was closed by the browser before it was saved. `stoppedEarly: true` means a recording error stopped filming; the run was unaffected.

## Setup file

UTF-8 JSON of at most 64 KiB, exactly:

```json
{
  "formatVersion": 1,
  "journeyId": "onboarding",
  "checkpointId": "workspace-ready",
  "setup": {
    "schemaVersion": 1,
    "values": { "displayName": "Amara Okafor", "intendedUse": "Collect customer payments." }
  }
}
```

`parseSetupFile`, `serializeSetupFile`, `parseMomentSetup`, `validateSetupValues` and `resolveSetup` are exported from the package root and from `/protocol`.

## Package entry points

| Import | For |
| --- | --- |
| `@vanta-crest/moments` | Node: `openMoment`, `defineConfig`, `defineJourney`, `defineStepJourney`, `furthestVerified`, setup helpers, types. |
| `@vanta-crest/moments/react` | Browser: `MomentsPanel`, `useMomentsSession`, `useMomentSetup`, protocol types. |
| `@vanta-crest/moments/styles.css` | The panel's styles. |
| `@vanta-crest/moments/protocol` | Browser-safe protocol types and setup codecs. |
