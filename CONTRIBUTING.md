# Contributing

This page explains how to propose a change to Moments and how to prove it works.

## Before you write code

Start from the task-app example. Describe a concrete problem and how to reproduce it before proposing an abstraction. Small fixes, clearer guide steps and independently verified journey examples are the most useful contributions. Read the [roadmap](ROADMAP.md) for what Moments will not become.

## Build and prove

Use Node 22 or newer.

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

The example names the published package; installing the packed tarball over it proves this checkout instead. Rebuild the example (`npm run build`) after every install, or the panel it serves is stale. `npm run proof` exercises the installed CLI, a real browser, the example's HTTP backend, recording and cleanup; see [the example's README](examples/task-app/README.md#real-e2e-proof). It starts its own server on a free port and never touches another developer's.

CI runs the full proof on Linux and macOS, and the core tests and CLI proof on Linux, macOS and Windows with Node 22, 24 and 26.

## How we work

- Write the failing test first, at the real entry point. Prefer tests of observable behaviour over tests that mirror constants or prose.
- Keep the Node runner independent of React.
- Drivers own application actions and resources. The runner owns sequencing, the browser and the receipt.
- Never record secrets, browser storage or raw exception text in a receipt.
- In a pull request, describe the behaviour before and after, and the proof you ran.
- Update the [changelog](CHANGELOG.md) and the documentation in the same change.

Releases are described in [docs/releasing.md](docs/releasing.md).
