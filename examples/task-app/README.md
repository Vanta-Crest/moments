# Task app

A complete local example: React UI, real HTTP backend, JSON persistence, and three
ordered checkpoints. It needs no cloud account, credentials, or provider.

Use Node 24. From this example directory:

```sh
npm install
npm run build
npx playwright install chromium
npm start
```

In another terminal, from the same directory:

```sh
npm run moments -- list
npm run moments -- open task.draft
npm run moments -- open task.created --once
npm run moments -- open task.completed --once
```

The local source checkout uses `file:../..` for development. To use this example
outside the checkout, copy its files and replace that dependency with the
installed package version or the absolute path of an actual npm tarball before
running `npm install`. The public source export substitutes its package name in
imports and metadata. Use the same version for the CLI and app.

A draft starts with no records and an empty input. Created submits the form;
completed clicks the real completion button. Verification reads the backend and
compares the visible UI. Manual creation or completion is adopted by Continue,
which checks the observed checkpoint without repeating the action. A nonempty
unsubmitted draft must be restored before advancing. Every task is marked with
the session's run reference; cleanup removes only that run's tasks.

The app listens on `http://127.0.0.1:4177`. `PORT` changes the server port;
`TASK_APP_URL` changes the runner URL. `TASK_APP_STATE` chooses the persisted JSON
file (default `.state/tasks.json`). `MOMENTS_OUTPUT_DIR` chooses the receipt
directory (default `.moments/runs`, relative to the config). The startup probe fails
before opening a browser when the backend is unavailable. Outside a Moments
browser, the app works with a personal run and the panel explains how to connect.

The demonstration stores records in a local JSON file and serializes mutations.
It is designed for one local process, not shared production use.

## Real E2E proof

After installing and building the copied example against an actual tarball, run:

```sh
TASK_APP_PROOF_DIR=/absolute/path/to/evidence \
MOMENTS_TARBALL=/absolute/path/to/moments.tgz \
npm run proof
```

Do not start it alongside other heavy browser/build work on a shared machine. The harness owns its temporary-port server and CLI children;
it does not reuse or stop another developer's server or browser. `npm run build`
is a separate prerequisite; proof never rebuilds its tested inputs.

The proof launches the installed CLI from an unrelated directory, uses an
explicit TypeScript config, and exercises the CLI-owned real Playwright browser.
It covers list, all one-shot checkpoints, failed one-shot verification, manual
adoption through the panel, destination verification retry without duplicate
creation, SIGTERM, private receipts, and cleanup isolation. The server's fault
endpoint is present only with `TASK_APP_PROOF=1`; a fault blocks independent
verification reads while ordinary product writes and reads remain real.

Retained evidence includes input hashes, optional tarball hash, resolved CLI path,
commands and exit statuses, stdout/stderr, assertion report, receipts, JSON state,
and interactive browser traces. A recovered verification failure retains its
failure history and therefore produces an incomplete receipt and nonzero exit.
The proof expects that behavior. It does not claim provider or production coverage.

Read `FAILURE_INVENTORY.md` for the acceptance conditions written before the app.
