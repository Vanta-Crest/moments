# Writing journeys

This guide explains the driver contract: what Moments expects from your journey code, and what it does with it.

## Two ways to write a journey

**`defineStepJourney`** suits most journeys. You write one step per checkpoint, each with `enter` and `verify`, plus one `cleanup`. The type requires a step for every checkpoint id. Moments derives `reconcile` for you: it verifies from the last checkpoint back to the last one this run verified (the first checkpoint if none), and adopts the furthest that passes.

```ts
import { defineStepJourney } from '@vanta-crest/moments';

export const invoice = defineStepJourney({
  id: 'invoice',
  title: 'Raise and approve an invoice',
  checkpoints: [
    { id: 'drafted', title: 'Invoice drafted', actor: 'Kemi Adeyemi, accounts clerk', covers: ['AJ-04'] },
    { id: 'approved', title: 'Invoice approved', actor: 'Amara Okafor, finance approver', covers: ['AJ-05', 'REQ-112'] },
  ],
  create({ page, baseURL, runRef }) {
    return {
      steps: {
        drafted: { enter: async () => { /* … */ }, verify: async () => { /* … */ } },
        approved: { enter: async () => { /* … */ }, verify: async () => { /* … */ } },
      },
      cleanup: async () => 'complete',
    };
  },
});
```

**`defineJourney`** gives you the whole driver: `enter(id)`, `verify(id)`, `reconcile()` and `cleanup()`. Use it when reconciliation needs more than "the furthest checkpoint that verifies", for example when two checkpoints are indistinguishable from the screen alone. `furthestVerified(order, floor, verify)` gives you the usual behaviour to build on:

```ts
import { defineJourney, furthestVerified } from '@vanta-crest/moments';

const order = ['drafted', 'approved'] as const;
// inside create():
let reached: (typeof order)[number] = 'drafted';
async function verify(id: (typeof order)[number]) { /* prove id, or throw */ reached = id; }
return { enter, verify, reconcile: () => furthestVerified(order, reached, verify), cleanup };
```

`furthestVerified` never returns a checkpoint behind the floor, and throws when nothing from the end back to the floor verifies: unknown state is never adopted.

## The driver contract

| Function | Your responsibility |
| --- | --- |
| `create(context)` | Return the driver synchronously. Start no asynchronous work here: a constructor that throws cannot hand back a cleanup. `context` holds `page`, `baseURL`, `runRef`, the run's `setup` values if any, and `reportProgress`. |
| `enter(id)` | Do only the work needed to reach this checkpoint from the one before. Moments calls checkpoints in order. |
| `verify(id)` | Prove the checkpoint from the product, without repeating its action. Throw if it is not proven. |
| `reconcile()` | Return the checkpoint the application is at now. Throw when you cannot tell. A checkpoint behind the run's position is refused. |
| `cleanup()` | Release only what this run created, even after a failed `enter` or `verify`. Return `'complete'` or `'neutralized-with-residue'`; throw when safety cannot be established. |

Moments owns the browser. Never close the page or browser from a driver.

### Verify proves; it does not perform

`verify` is how a checkpoint becomes a fact. Read the product's own state: the screen a user would see, and where you can, its API. A button that was clicked is not an invoice that was approved.

Throw errors that say what was expected: `Error('Approval badge not shown')`. The first line of the message appears in the CLI and under **Technical detail** in the panel, and the whole message goes to the private evidence file. The receipt never holds it.

### Enter runs once per run

Moments never repeats an `enter` within a run. If verification fails, **Check this state** calls `verify` again; it does not enter again. Restarting starts a new run with a new `runRef`.

So write `enter` for a clean path from the previous checkpoint, and key everything it creates on `runRef`: a title, a reference, a tag. Then two runs never collide, and `cleanup` can find exactly what one run owns.

### Cleanup is honest

`cleanup` runs at the end of every run, after success or failure, and before a restart admits the next run. Hold onto resources as soon as you create them, so cleanup can handle a run that stopped half-way.

- Return `'complete'` only when you have confirmed that everything the run created is gone.
- Return `'neutralized-with-residue'` when something remains but is harmless, such as an archived record the product cannot delete. This is your statement, recorded as such.
- Throw when you cannot establish that the system is safe. The run's outcome becomes `incomplete` and the CLI says so.

## When a person takes over

In an interactive run a reviewer can use the application by hand. When they press **Continue**, Moments calls `reconcile`, then `verify` on the checkpoint it returned. If that passes, the checkpoint is recorded as reached by hand (`manual`) and any checkpoints between are recorded `skipped`. Nothing is repeated.

A Continue that adopts manual progress stops there; a second Continue moves on. If verification fails, the run holds at that checkpoint: **Check this state** looks again without repeating the action. An earlier failure stays in the receipt even after a later check passes.

For adoption to work, `verify` must accept any valid way of reaching the state, not only the values your `enter` would have typed.

## Checkpoint fields

| Field | Use |
| --- | --- |
| `id` | Lowercase letters, digits and hyphens, starting with a letter; at most 64 characters. Unique in the journey. |
| `title` | What a reviewer sees. Name the state, not the action: "Invoice approved", not "Click approve". |
| `description` | What the state means, in one sentence. Shown in the panel, chapter cards and failure messages ("Expected: …"). |
| `actor` | Who acts here: a name and role, one line, at most 120 characters. |
| `covers` | References this checkpoint proves, such as `AJ-07`. Up to 64 characters each: letters, digits and `._:/-`, starting with a letter or digit. No duplicates. |
| `private` | `true` for screens that show a secret. Never filmed. See [Recording](recording.md). |

The journey `id` is lowercase letters, digits, dots and hyphens, starting with a letter. `restartExplanation` is optional public text the panel shows before a fresh run, for example "A new run creates a new invoice; the old one is archived."

## Timeouts

Set the page's default timeouts once, in the config, with `navigationTimeoutMs` and `actionTimeoutMs`, rather than in every journey. A journey may still set its own in `create`, but see [Resume](resume.md) for why the config is the better place.

## Waits a person should understand

When a step waits on something real, such as a fresh authenticator code, call `context.reportProgress?.('waiting-for-code')`, and `reportProgress?.(undefined)` when it ends. The CLI prints "waiting for a fresh code…", the panel shows **Waiting for code**, and a recording's timeline marks the wait. See [Sign-in and the Director](sign-in-and-director.md).
