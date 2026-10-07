# Task-app failure inventory and E2E acceptance

Written before implementing this example. New tests enter through the installed
CLI and real browser UI, backed by the real HTTP server and persistent JSON state.

- Package cannot be used outside Alpine: install an actual npm tarball in a copied
  example outside the checkout, build its React app, and run its installed CLI.
- A checkpoint reports success without committed state: verify through independent
  HTTP reads, then force that read to fail after a successful create. Check must
  retry verification and leave the create count at one.
- Manual actions get repeated: manually create through the browser, Continue,
  manually complete, Continue, and assert one backend record and manual provenance.
- Cleanup removes unrelated work: seed a foreign run, end each session, assert
  every owned record was removed and the foreign record remains identical.
- Driver admits an unrelated/ambiguous record: match the exact run reference and
  expected title, reject multiple records, and compare UI with backend state.
- CLI opens the wrong config/receipts: run from an unrelated directory using an
  explicit config path and assert receipts in the configured directory.
- A one-shot session hangs or masks failure: bounded child lifetime, success
  receipts for draft/created/completed and a nonzero failed verification run.
- Signal loses cleanup: SIGTERM a live session after create, assert interrupted
  receipt, nonzero exit, and owned-record deletion.
- A fresh-run confirmation silently adopts a newer revision during submission:
  before correcting the hook, add a controls E2E that arms the actual confirmation
  click and performs an actual runner Check inside its preflight read. Return the
  newer ready observation and assert the confirmed Restart is never submitted,
  the original run and task survive, and a newly reviewed Restart can then replace
  the run with two linked receipts and isolated cleanup.

Retain stdout/stderr per CLI run, session receipts, browser traces for interactive
runs, assertion report, state file and tarball identity. Proof faults are enabled
only by TASK_APP_PROOF=1; they change verification reads, not product mutations.
No isolation tests are needed for this example.
