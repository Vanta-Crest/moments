# Reference

```sh
moments list [--config path]
moments open journey.checkpoint [--config path] [--once] [--headless]
moments open [journey.checkpoint] --setup ./review.json [--config path] [--once] [--headless]
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
CLI output defaults to `.moments/runs` relative to the config file. Direct API
paths follow the caller's cwd. Config modules execute trusted local code.
Setup file paths resolve from the caller's cwd. Only `open` accepts `--setup`,
once. Its journey/checkpoint supplies the target; an optional positional target
must match exactly. Invalid setup exits 2 before admission or provisioning.

`defineJourney` validates ordered unique checkpoints. Its synchronous `create`
returns a driver with `enter`, `verify`, `reconcile` and `cleanup`. Context supplies
Playwright `page`, `baseURL`, `runRef`, optional immutable `setup` and optional
`reportProgress`. Optional journey `setup` declares a positive integer schema
version, fields, complete defaults and a pure parser. Unconfigured journeys
reject explicit setup.

`openMoment(config, {target, setup?, once?, headless?, signal?})` prepares the target and
returns a session. Initialization failure throws `MomentOpenError` after
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

Results have schema version 2, identifiers, timestamps, observations, safe failure
stages/codes and cleanup. Outcomes: `pending`, `complete`,
`neutralized-with-residue`, `incomplete`. Failure history survives retries. New
receipt directories use `0700`, files `0600`, and updates use atomic replacement.
Existing directory permissions are not changed. No raw exceptions, credentials,
browser storage or screenshots are collected.
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
