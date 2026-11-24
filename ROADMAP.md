# Roadmap

This page states where Moments is going and, as importantly, what it will not become.

## What Moments is for

Moments proves that an application reaches the states a business process depends on, lets people take over and hand back, and leaves a record a reviewer can trust: what system, who acted, how each state was proven and when, and whether the run cleaned up after itself.

## Next

- Watch outside developers write their first journey from the guides, and fix the friction they meet.
- Turn a recorded run into a short, reviewed film, cut by checkpoint, with an index and contact sheet for review before anything is shared.
- Improve diagnostics without collecting application secrets.

## Toward 1.0

Repeated independent use, a compatibility matrix proven in CI, a reproducible release, and documented changes to any public API. A 1.0 date depends on that evidence, not on a feature count.

## What Moments will not do

Each of these has been considered and declined, because it would weaken the record or duplicate tools that already do the job well.

| Not planned | Why |
| --- | --- |
| A hosted dashboard or run history | Receipts are files you own. Keep them where your organisation keeps records. |
| A test runner or assertion library | Use Playwright Test for testing. Moments proves journey states for people. |
| Masking or blurring in recordings | Masking that fails silently is worse than none. Mark secret screens `private` so they are never filmed. |
| An approval workflow | Who may approve what belongs to your own systems. Moments supplies the evidence: receipt, manifest, run sheet. |
| Narration or voice-over | A film's words should be written and reviewed by people, outside the tool. |
| Self-healing selectors | A journey that guesses what it clicked cannot prove what it did. |

Also not planned: a workflow graph, a plugin registry or a theme framework. New examples and adapters need demonstrated demand.
