# Presenting

This guide covers showing a journey live to an audience: sizing the window, keeping controls off the shared screen, and pacing.

## Size the window

```sh
npx moments open invoice.drafted --window 1280x720
```

`--window` makes the application window's page area exactly that size, so the audience sees a predictable layout. Each side must be 320 to 3840 pixels. It cannot be combined with `--record`, which fixes its own size.

## Keep controls off the shared screen

With `director: true` in the config, run controls sit in their own Moments Director window, and the application window shows only the application. Share the application window, and keep the Director on your own screen. Moments first places the Director in a column on the right of the main screen; drag it wherever suits you. See [Sign-in and the Director](sign-in-and-director.md).

Without the Director, the embedded panel sits in the page. **Collapse** it, or press Escape inside it; Alt + Shift + M brings it back.

## Prepare before the meeting

Open at the checkpoint you want to start from, so the audience does not wait through setup:

```sh
npx moments open invoice.drafted --resume
```

`--resume` skips checkpoints that are already true on a shared stack; see [Resume](resume.md).

## Pace the walk-through

**Continue** moves one checkpoint and stops. **Play journey** goes to the last checkpoint. Choose the pace first:

- **Straight through**: each step follows the last once it is verified.
- **With pauses**: three seconds between verified steps, time to say what happened. The pause never replaces verification.

**Pause** finishes and verifies the step in progress, then stops. Play again continues from there.

To show an earlier step again, select it and choose **Start fresh here** (on the current step, **Restart at checkpoint**). After you confirm, Moments cleans up this run and starts a fresh one there.
