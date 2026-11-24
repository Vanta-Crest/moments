# Changelog

This file records what changed in each release of `@vanta-crest/moments` and what you must do to upgrade.

## 0.3.0 (unreleased)

### Added

- `--record` films a run: video segments, the frame at each verified checkpoint, and a `timeline.json` tied to the receipt. `--chapters` draws each checkpoint's title into the video.
- `private: true` on a checkpoint keeps it off film.
- Progress lines on stderr as each checkpoint is entered and verified, and during a reported wait.
- `defineStepJourney`: one step per checkpoint, with `reconcile` derived for you.
- `environment` in the config, and `actor` and `covers` on checkpoints, kept in the receipt and shown in the panel and run sheet.
- The receipt records the journey as it stood (`journeyTitle`, `checkpoints`) and the `origin` of `baseURL`, so it reads correctly after the journey changes.
- `moments verify`: a manifest of SHA-256 fingerprints is written when each run ends, and `verify` reports any receipt, evidence or recording file that has changed since.
- `moments report`: a private, self-contained HTML run sheet for reviewers. Its Proven line lists only the references of checkpoints the run verified.
- `--window <W>x<H>` sizes the application window for presenting.
- The panel shows the system, who acts at each checkpoint, how and when each was verified, which checkpoints are private, and whether the window is being filmed.
- Support for Node 22 and newer, React 19, and Linux, macOS and Windows.
- A guide set: first journey, concepts, task guides, reference and troubleshooting.

### Changed

- Published to the public npm registry under Apache-2.0. Release candidates use the `next` dist-tag.
- Requires Node 22 or newer (was Node 24 only).
- The panel was redesigned around the journey: a failure leads with the step that stopped and explains it once, with the thrown text under **Technical detail**. A checkpoint behind the current one offers **Start fresh here**; **Restart at checkpoint** is offered on the current one and those ahead. The badge says **All verified** when the journey is done.
- A failed `beforeRun` keeps its message in the private evidence file only. The CLI prints a safe description and the file's path.
- A config that fails to load names the command that shows the error, instead of printing it.

### Fixed

- Filming now stops before `--resume` probes a private checkpoint, and before reconciling manual progress when a later checkpoint is private. Previously those checks could be filmed.
- A catalogue selection hands over to its new run. Both runs' receipts record the selection; previously the first receipt write failed and every selection was held as blocked.
- Failures in `beforeRun` and at browser launch now keep local evidence, as driver failures do.

### Upgrading from 0.2

1. Install from npm. Remove `@vanta-crest:registry=https://npm.pkg.github.com` from your `.npmrc`; no token is needed. 0.3.x is also published to GitHub Packages, for this release only.
2. Use Node 22 or newer.
3. Rebuild any application that embeds the panel, so the panel and runner versions match.
4. If you read receipts, they gain `journeyTitle`, `checkpoints`, `origin` and, when configured, `environment` and `selection`. The schema version stays 3.
5. Replace hand-written `reconcile` functions that verify from the end backwards with `defineStepJourney`, or keep them: both work.
6. If you kept your own failure evidence around drivers, Moments now does this itself; see [Evidence and review](docs/guides/evidence-and-review.md#failure-evidence).
7. Add `environment`, `actor` and `covers` where a reviewer needs them.

## 0.2.0

Failure evidence per failed step, a per-checkpoint summary and `latest.json`, `--resume`, `furthestVerified`, `--output`, and page timeouts in the config. Published to GitHub Packages.

## 0.1.0

First preview on GitHub Packages: ordered checkpoints, verification, manual adoption, cleanup, run values, the CLI, the React panel and the Director window.
