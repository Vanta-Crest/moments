# Catalogue

This guide describes the catalogue, an advanced API for a custom control surface that lets a reviewer switch between many journeys in one browser session.

Most projects do not need it. The built-in panel and Director do not display a catalogue: you build the selection interface yourself, with `useMomentsSession`.

## Declare it

Add `catalogue` to the config. `view` is what your interface lists; `admit(target)` is a check Moments awaits before switching to a target.

```ts
export default defineConfig({
  baseURL: 'http://127.0.0.1:3000',
  journeys: [onboarding, payout],
  async beforeRun() { /* … */ },
  catalogue: {
    view: {
      runtimeRef: 'local-2026-11-24',
      scopeLabel: 'Local stack',
      entries: [{
        target: 'payout.approved',
        title: 'Approve a payout',
        group: 'Payments',
        purpose: 'Shows a second approver releasing a payout.',
        viewpoints: ['Finance approver'],
        expectedObservation: 'The payout shows Approved and the ledger entry exists.',
        prerequisites: ['An onboarded customer'],
        cleanup: 'The payout and its ledger entry are reversed.',
        availability: { kind: 'available' },
      }],
    },
    async admit(target) { /* throw if this target cannot run now */ },
  },
});
```

Targets must be unique. Every `available` entry must name a configured `journey.checkpoint`. An entry can instead be `{ kind: 'unavailable', reason: '…' }`, which your interface should show but cannot select.

## Select a target

Your interface reads `view.catalogue` and sends a `select` command:

```ts
submit({ runRef: view.runRef, command: { kind: 'select', requestRef: crypto.randomUUID(), target: 'payout.approved' } });
```

`requestRef` is a fresh UUID for each request; a reused one is refused. A selection is accepted only when the session is ready, with no failure, and no other selection in progress.

Moments then works through phases, shown in `view.selection.phase` and kept in the receipt's `selection`:

| Phase | Meaning |
| --- | --- |
| `requested` | Accepted. `admit(target)` runs. |
| `cleaning` | The current run is being cleaned up. The browser stays open. |
| `starting` | A new run, with the `toRunRef` allocated at request time, is opening the target. |
| `started` | The new run is ready. |
| `blocked` | Admission, cleanup or the new run failed. The run that held the browser keeps it. From then on only End is accepted. |

The new run's `beforeRun` still applies. Its receipt carries `previousRunRef` and the `selection` that started it.
