# Resume

This guide explains `--resume`, which skips checkpoints that are already true instead of replaying them.

## What it does

On a shared development stack, later checkpoints are often already true from an earlier run, and replaying every `enter` can take minutes. With `--resume` (or `openMoment(config, { target, resume: true })`), Moments calls `verify` before entering each checkpoint, the target included:

- A checkpoint that verifies is recorded with provenance `existing` ("Already there") and is not entered.
- At the first one that does not verify, Moments enters it and every checkpoint after it as usual.
- A probe that fails is not recorded as a failure.

```sh
npx moments open onboarding.approved --resume
```

## Probes are short

Each probe runs with page timeouts of `resumeProbeTimeoutMs` (default 3000), so an absent checkpoint costs seconds, not a full navigation timeout. Afterwards the page gets back the config's `navigationTimeoutMs` and `actionTimeoutMs`, or Playwright's 30-second default.

A timeout set inside `create` does not survive a probe. Set timeouts in the config. Playwright `expect` timeouts are separate and still apply.

## When a journey can resume

Only when every `verify` proves state that outlives a run, from a fresh page:

- It navigates to what it checks, or reads the product's own API. It does not rely on the page the previous step left open, or a value typed earlier.
- It does not depend on `runRef`. A resumed run has a new `runRef`, so records keyed on the old one are invisible to it.

A journey that creates its own records per run, like the example task app, cannot resume. Run it without `--resume`.

If a resumed run enters a checkpoint that already exists, its `verify` failed within the probe timeout on a fresh page. Make `verify` navigate to what it checks, or raise `resumeProbeTimeoutMs`.

Private checkpoints are not filmed while probed. See [Recording](recording.md#what-is-filmed).
