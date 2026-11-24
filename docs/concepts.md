# Concepts

This page defines the words the rest of the documentation uses. Each term links to where it is used in depth.

| Term | Meaning |
| --- | --- |
| **Journey** | An ordered list of checkpoints through one business process, with the code that drives it. Defined with `defineStepJourney` or `defineJourney`. See [Writing journeys](guides/writing-journeys.md). |
| **Checkpoint** | A state of the application that can be proven, such as "Task created". It has an `id`, a `title` and optionally a `description`, `actor`, `covers` and `private`. A target is written `journey.checkpoint`, for example `task.created`. |
| **Step** | In a step journey, the code for one checkpoint: `enter` reaches it from the checkpoint before, `verify` proves it. |
| **Driver** | The four functions Moments calls for a journey: `enter`, `verify`, `reconcile` and `cleanup`. Your driver performs every application action. Moments sequences them, owns the browser and keeps the record. |
| **Verify** | Proving a checkpoint from the product itself: its screens or its own API. A checkpoint passes only when `verify` returns without throwing. |
| **Reconcile** | Working out which checkpoint the application is at after a person has used it by hand. It must identify the state positively, never guess. |
| **Adoption** | When a person reaches a later checkpoint by hand, Moments reconciles, verifies the result, and records it as reached "by hand" instead of repeating the work. |
| **Run** | One attempt at a journey, from admission to cleanup. Each run has a fresh `runRef` (a UUID). Restarting starts a new run. |
| **Receipt** | The JSON record of a run: what system, which journey, who acts, what was observed and how, failures, cleanup and outcome. It holds no screenshots, credentials or thrown messages. See [Evidence and review](guides/evidence-and-review.md). |
| **Provenance** | How a checkpoint came to be verified. `native` (shown as "Moments"): this run entered it. `manual` ("By hand"): a person reached it and Moments verified it. `existing` ("Already there"): it was already true on a resumed run and was not entered. |
| **Outcome** | `pending` while a run is open; then `complete`, `neutralized-with-residue` or `incomplete`. Any failure, even one later recovered, makes a run `incomplete`. |
| **Residue** | `neutralized-with-residue` is the driver's own statement that cleanup made the run's resources harmless but did not remove them all. It is an assessment, not proof of deletion. |
| **Evidence** | Private local files kept when a step fails: the thrown message, the page address and a screenshot. Never part of the receipt. |
| **Manifest** | SHA-256 fingerprints of a run's receipt, evidence and recording, written when the run ends. `moments verify` checks them. |
| **Run sheet** | A self-contained HTML page for a reviewer, written by `moments report`. It shows screens, so it is private. |
| **Recording** | An optional film of a run: video segments, one frame per verified checkpoint and a `timeline.json`. See [Recording](guides/recording.md). |
| **Private** | A checkpoint marked `private: true` is never filmed. Use it for screens that show secrets. |
| **Environment** | A label in the config naming the system a run touches, such as `Staging, EU`. Kept in every receipt with the origin of `baseURL`. |
| **Actor** | Who acts at a checkpoint, as a reviewer should read it: a name and role, such as `Amara Okafor, finance approver`. |
| **Covers** | References a checkpoint proves, such as acceptance criteria or requirement ids (`AJ-07`, `REQ-112`). |
| **Admission** | The check before any browser opens: the config's `beforeRun`. If it throws, nothing else happens. |
| **Panel** | The optional React control panel embedded in your application during development. See [React panel](guides/react-panel.md). |
| **Director** | A separate Moments window holding the run controls, for journeys that leave your origin or applications that must not embed controls. See [Sign-in and the Director](guides/sign-in-and-director.md). |
| **Run values** | Public text a journey accepts to autofill forms, such as a display name. Never credentials. See [Run values](guides/run-values.md). |
