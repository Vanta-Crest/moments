# Recording

This guide explains how to film a run, exactly what is and is not filmed, and how to handle the files.

## Film a run

```sh
npx moments open invoice.approved --once --record --chapters
```

Moments films the application window while the journey runs and prints `Recording: <folder>` at the end. The folder holds:

- `segment-1.webm`, `segment-2.webm`, …: 1920×1080 video at 25 frames a second. A new segment starts each time filming resumes after a private checkpoint.
- `<checkpointId>.jpg`: the video frame on screen when that checkpoint was verified. A checkpoint verified twice gets `-2`, `-3`. Private checkpoints have none.
- `timeline.json`: ties every segment, frame and event to the receipt's own times. See [Reference](../reference.md#timelinejson).

`--chapters` draws each checkpoint's title and description onto the video as it is verified. Each card shows for two seconds.

`--record` also works without `--once`, for a recorded interactive session. Finish with **End session**, not by closing the window: a segment the browser closes before saving is lost, and the timeline lists it with `lost: true`.

The page is laid out at 1280×720 and drawn at twice that density, so text stays sharp. That size is fixed while recording, which is why `--record` cannot be combined with `--window`. Measured on the example app, a minute of video is about 3 MB.

## What is filmed

Filming follows the checkpoint the run last touched. When the run enters or verifies a checkpoint that is not private, filming is on. When it touches a private one, filming stops.

Moments also stops filming before any check that might show a private checkpoint without entering it:

- before `--resume` probes a private checkpoint; and
- before reconciling manual progress, when any later checkpoint is private.

After such a check, filming resumes at the next checkpoint the run touches that is not private.

Three consequences to plan for:

1. **The end of a private step is filmed.** The screen a private checkpoint leaves behind is on screen when the next checkpoint begins. If it still shows a secret, such as a page of recovery codes, make the next checkpoint private too, or have its `enter` leave that screen first.
2. **Whatever you do by hand is filmed while filming is on.** Moments cannot know what you are about to type. The panel and Director show **Filming** or **Not filming** at all times. Do not type a secret into a recorded session unless it says **Not filming**.
3. **Everything visible is filmed.** Other tabs' notifications, data on the page, a colleague's name. Moments does not blur or mask.

Moments never draws Playwright's action titles onto the video, because they print typed values, passwords included.

## Recording never fails a run

Recording is passive: it never clicks, waits or types for the journey. If it fails, Moments stops filming, prints one warning, and the run carries on. The timeline then carries `stoppedEarly: true`.

Frames come from the video stream itself, not from page screenshots, so taking one never disturbs the film.

## Keep it private

A recording needs a local evidence directory: the default, or `evidenceDir` in the config. It lives at `<evidence>/<runRef>/recording/`, with directories readable only by you (`0700`) and files `0600`.

Review every frame before a recording leaves your machine. The run's [manifest](evidence-and-review.md#checking-a-run-has-not-changed) fingerprints the video and frames, so a reviewer can confirm they are what the run produced. See [Keeping and deleting](evidence-and-review.md#keeping-and-deleting) for how long to keep them.
