# Troubleshooting

This page lists the messages Moments shows, what causes each one and what to do. Search it for the words you see.

## Before the run

**`No moments.config.ts found in the current directory. Create it or use --config <path>.`**
Moments looks only in the current directory, never in parents. Run the command beside the config, or pass `--config`.

**`Could not load the config. Check its syntax, imports, and default export; npx tsx moments.config.ts shows the full error.`**
The config threw while loading. Moments does not print the error, because it can quote environment values. Run the command it names to see it.

**`Invalid Moments config. Check baseURL, environment, journeys, beforeRun, director, evidenceDir, timeouts, and either outputDir or writeReceipt.`**
A field has the wrong type or shape. Common causes: `baseURL` holds a username or password; `environment` is empty, longer than 80 characters or spans lines; both `outputDir` and `writeReceipt` are set; two journeys share an id; a checkpoint `actor` or `covers` value is invalid (see [Checkpoint fields](guides/writing-journeys.md#checkpoint-fields)).

**`Unknown target. Use moments list to see available journey.checkpoint targets.`**
The target must be `journey.checkpoint` exactly as `moments list` prints it.

**`--record keeps the recording beside failure evidence: set evidenceDir, or use outputDir rather than writeReceipt.`**
A config with `writeReceipt` has no default evidence directory. Set `evidenceDir`.

**`--record sets its own window size; use one or the other.`**
Recording fixes the page at 1280×720. Drop `--window`.

**`Invalid run setup file. Check its version, fields and complete public values.`**, **`Run setup file exceeds 64 KiB.`**, **`The positional target must exactly match the run setup file.`**
See [Run values](guides/run-values.md#save-and-replay-them). Field-level problems are listed below the message.

## During the run

**`The run prerequisites could not be established. … The message is in <file>`**
`beforeRun` threw. Its message may hold secrets, so it is only in the file. Open it, fix the prerequisite (usually: the application is not running), and run again.

**`The review browser could not be opened. Check browser availability, then start a new run.`**
Chromium is missing or cannot start. Run `npx playwright install chromium` with the same Playwright the runner uses. On Linux, add `--with-deps`.

**`Checkpoint "<title>" failed at enter: …`** or **`failed at verify: …`**
The text after the colon is the first line of what your driver threw. Open the evidence file named at the end: it has the full message, the page address and a screenshot.

**`… The page was blank: the application server may not be responding.`**
The page had no text when the step failed. The development server has probably stopped or is still compiling. Check it before changing the journey.

**`Could not confirm "<title>". Expected: … Nothing was repeated.`**
In the panel: `verify` did not pass. Look at the application. If the screen is right, press **Check this state**, which verifies again without repeating the action.

**`The page no longer matches the prepared state …`** or **`No checkpoint from "<last>" back to "<floor>" could be verified.`**
After manual changes, `reconcile` could not identify a checkpoint. Return the application to a state the journey recognises and press **Check this state**, or restart.

**`Cleanup could not be confirmed. Inspect the run receipt for remaining resources before starting another run.`**
`cleanup` threw. Check for records the run created and remove them. Cleanup can only remove what the driver tracked.

**`The current run is retained because cleanup, receipt storage, or browser closure failed. Resolve the failure, then retry End.`**
Moments will not release the run until it can record how it ended. Fix the cause, often a full disk or an unwritable output directory, then press **End session** again.

**`Moments: receipt persistence failed; durable recovery was not established.`**
A receipt could not be written. Check that the output directory is writable, or that your `writeReceipt` succeeded. The result printed at the end is still accurate.

## Recording

**`Moments: the browser closed while filming, so the last recording segment is lost. End the session with End to keep it.`**
Finish recorded sessions with **End session**, not by closing the window.

**`Moments: recording stopped after an error; the run continues.`**
Filming stopped; the run did not. The timeline carries `stoppedEarly: true`.

## After the run

**`Moments: N of M files differ from the manifest.`**
A receipt, evidence or recording file was changed, removed or added after the run ended. The lines above name each one. If nobody should have changed them, treat the run's files as unreliable.

**`No manifest for <runRef>: it is written when a run ends with moments open.`**
Runs made with an earlier version, or from code with `openMoment`, have no manifest. `report` still works and says so.

**`No run receipt for <runRef> in <dir>.`**
Give the run reference from `latest.json` or a receipt file name, and the same `--output` the run used.

## In the panel

**`No Moments session is connected.`**
The page was not opened by Moments, or the config uses `director: true`, in which case the Director is the only control surface.

**`Moments versions do not match.`**
The application bundles a different Moments version from the runner. Install the same version in both and rebuild the application.

**`Runner connection interrupted.`**
The last view shown may be out of date. Controls return when the runner answers again. Nothing is replayed.

**`The session changed. Review the current state before trying again.`**
Someone or something moved the run on between your view and your click. Nothing was sent. Look again, then act.

## Symptoms without a message

| Symptom | What to do |
| --- | --- |
| Every open replays every earlier step | Use `--resume` if the journey supports it. See [Resume](guides/resume.md). |
| A resumed run entered a checkpoint that already exists | Its `verify` failed on a fresh page within `resumeProbeTimeoutMs`. Make `verify` navigate to what it checks, or raise the timeout. |
| Parallel runs overwrite `latest.json` | Give each run its own `--output <dir>`. |
| The run ended when I closed the Director | By design: closing either window ends the session, with cleanup and a receipt. |
| The panel covers a control the journey clicks | Give the panel its own area in your layout. |
| Shutdown waits | Moments waits for driver calls to settle before cleanup. Bound your own waits with timeouts. A forced kill cannot guarantee cleanup. |
