# Moments

Open a real application at a verified checkpoint, explore by hand, then continue
the same journey. Moments coordinates browser and run lifecycle; your driver
performs application actions, verifies outcomes and cleans up its own resources.

Moments can also film a run: a private video of the real screens, a timeline
tying it to the run's verified checkpoints, and one frame per checkpoint.

`npm install --save-dev @vanta-crest/moments @playwright/test` (Apache-2.0).

## Try it: record a walkthrough of the task app

Use Node 24. You need nothing else: no account, token or cloud service.

```sh
git clone https://github.com/Vanta-Crest/moments.git
cd moments/examples/task-app
npm install
npx playwright install chromium
npm run build
npm start
```

Keep the app running. In a second terminal, in `moments/examples/task-app`:

```sh
npx moments open task.completed --once --record --chapters
```

Moments creates a task, completes it and deletes it again, printing a line as each
checkpoint is entered and verified. The last line is `Recording: <folder>`. Open
`segment-1.webm` from that folder in a web browser: each checkpoint's title
appears on screen at the moment it was verified. The folder also holds
`timeline.json` and a frame per verified checkpoint. It is private (`0700`):
a recording shows everything on screen, so review it before sharing.

To explore by hand instead:

```sh
npx moments list
npx moments open task.created
```

Moments creates and verifies a task in a managed browser. Click **Complete task**
yourself, then **Continue** to verify and adopt manual progress. **End session**
deletes only this run's task and closes the browser.

`--once` runs headless, verifies the target, cleans up and prints the result: one
line per checkpoint (passed, skipped, failed, not reached) and, for a failure,
the checkpoint, stage, thrown message and a local evidence file with the page URL
and a screenshot. `.moments/runs/latest.json` points at the run's JSON receipt,
evidence and recording. Incomplete runs exit 1. The example uses real HTTP and
backend state without accounts, providers or cloud services.

Useful `open` flags on slow or shared stacks:

- `--resume` verifies each checkpoint before entering it and skips the ones that
  already exist, instead of replaying every earlier step. See
  [resuming](docs/authoring.md#resuming-a-journey) for when a journey supports it.
- `--output <dir>` writes this run's receipts elsewhere, so parallel runs of one
  config do not collide.
- `--record` films the run; mark sign-in and secret screens `private`. See
  [recording a run](docs/authoring.md#recording-a-run).

## Add it to your application

Install Moments and `@playwright/test` as development dependencies, then run
`npx playwright install chromium`. Create an ordered driver and a cwd
`moments.config.ts`:

```ts
import { defineConfig } from "@vanta-crest/moments";
import { task } from "./task-journey.js";

export default defineConfig({
  baseURL: "http://127.0.0.1:4177",
  journeys: [task],
  async beforeRun() {
    const response = await fetch("http://127.0.0.1:4177/api/health");
    if (!response.ok) throw new Error("Application unavailable");
  },
});
```

Run `npx moments list` and `npx moments open task.created`. Use `--config path` for another
file. Receipt paths resolve beside the config; parent directories are not searched.

Optional development controls:

```tsx
import { MomentsPanel } from "@vanta-crest/moments/react";
import "@vanta-crest/moments/styles.css";

export function DevelopmentControls() {
  return <MomentsPanel />;
}
```

React is unnecessary for the Node runner. Keep controls out of production. The
panel connects only in the runner-owned page at the configured origin.
The panel sits in normal document flow. Give it its own area beside or below your
application so it cannot cover controls used by the journey.

If the journey leaves one origin (single sign-on, a mailbox, another portal), or the
application must not embed test controls, set `director: true` in the config. An
interactive run then opens a separate Moments Director window with the same controls
and keeps working on every origin. Application pages get no Moments bridge at all,
so remove an embedded panel or ignore its "not connected" state.

Read the [authoring guide](docs/authoring.md), [reference](docs/reference.md),
[troubleshooting](docs/troubleshooting.md), and [roadmap](ROADMAP.md).

## Development

```sh
npm install
npm run build
npm test
node scripts/cli-proof.mjs
npm pack --pack-destination .release
cd examples/task-app
npm install --no-save ../../.release/vanta-crest-moments-*.tgz
npm run build
npm run proof
```

The example names the published package; installing the packed tarball over it
proves this checkout instead.

The example proof exercises the CLI, managed browser, real HTTP service, backend
state and cleanup. Core tests retain distinct lifecycle/persistence failures.
Tested baseline: Node 24, Playwright 1.60, React 18.3. Linux support requires its
CI proof; do not infer it from the macOS run.
