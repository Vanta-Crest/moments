# Evidence and review

This guide explains what a run leaves behind, what each file may and may not contain, and how a reviewer checks it.

## What a run leaves

With the default config, everything sits under `.moments/` beside the config file:

| File | Written | Contains screens? |
| --- | --- | --- |
| `runs/<runRef>.json` | Throughout the run | No. This is the receipt. |
| `runs/<runRef>.manifest.json` | When the run ends | No. Fingerprints only. |
| `runs/latest.json` | When the run ends | No. Points at the newest run's files. |
| `runs/<runRef>.html` | By `moments report` | Yes. The run sheet. |
| `evidence/<runRef>/<stage>-<checkpoint>.txt` and `.png` | When a step fails | Yes. |
| `evidence/<runRef>/recording/` | With `--record` | Yes. |

`outputDir` moves `runs/`; `evidenceDir` moves `evidence/` (or `false` turns failure evidence off). `--output <dir>` moves `runs/` for one run, and evidence then goes to `<dir>/../evidence` unless `evidenceDir` is set.

New directories are created readable only by you (`0700`) and files `0600`, on macOS and Linux. Existing directories keep their permissions.

## The receipt is the record

The receipt answers what a reviewer needs to know: what system the run touched (`environment`, `origin`), the journey as it stood (`journeyTitle`, `checkpoints` with their `actor` and `covers`), each observation with its time and provenance, every failure by stage, the cleanup result and the outcome. It stands alone: it still reads correctly after the journey file changes.

A receipt never contains screenshots, browser storage, credentials or thrown messages. Run values appear only as the public text that was requested. Each failure carries a stage, a code and, at most, the relative path of its evidence file.

Moments writes receipts atomically through a temporary file, so a reader never sees half of one. To keep receipts in your own store instead, give the config an awaited `writeReceipt(result)` in place of `outputDir`. Moments then writes no manifest, `verify` and `report` are not available, and failure evidence is kept only if `evidenceDir` is set.

## Failure evidence

When `create`, `enter`, `verify`, `reconcile` or `cleanup` throws, Moments writes two files: a `.txt` with the message's first line, the page address, the screenshot path and then the full message; and a full-page `.png`. A second failure at the same step gets `-2`, then `-3`. If the page was empty, the first line adds "The page was blank: the application server may not be responding."

The CLI prints the first line and the file path. The panel shows the same line under **Technical detail**, with a **Copy path** button.

A failed `beforeRun` is different. Its message often comes from environment secrets, so it is kept only in the file: the CLI prints a safe description and `The message is in <file>`, and the panel shows no detail. When no page is open yet, the file says so in place of a screenshot.

## Traceability: environment, actor and covers

Three fields turn a run into evidence someone else can use:

- `environment` in the config names the system: `Zamfara BPP, local stack c13`. With the origin of `baseURL`, it says where the run happened.
- `actor` on a checkpoint names who acts there: `Amara Okafor, finance approver`.
- `covers` on a checkpoint lists the acceptance criteria or requirements it proves: `['AJ-05', 'REQ-112']`.

All three are kept in the receipt and shown on the run sheet. The sheet's Proven line lists only the references of checkpoints this run verified; each row still shows its own references and whether it was verified.

## Checking a run has not changed

When a run ends, the CLI writes `<runRef>.manifest.json` beside the receipt: the SHA-256 and size of the receipt and of every file in the run's evidence folder, recording included.

```sh
npx moments verify            # the latest run
npx moments verify 6f0d7c1e-…  # a given run
```

Each file is reported `unchanged`, `changed`, `missing`, or `added` (in the evidence folder but not in the manifest). The command exits 1 if any file differs.

A manifest stored beside the files cannot protect against someone who can rewrite both. To make it a check against tampering, keep a copy of the manifest, or its own hash, somewhere that person cannot change: a ticket, a signed commit, an approval record.

## The run sheet

```sh
npx moments report
```

writes `<runRef>.html` beside the receipt and prints its path. It is one self-contained page: the system, the run, its outcome and integrity, and a row per checkpoint with who acted, how and when it was verified, what it covers, and its frame from the recording. Video segments are linked, not embedded.

It shows screens, so it is written privately. Review it before sharing.

## Keeping and deleting

Add this to `.gitignore`:

```gitignore
.moments/
```

A sensible rule:

- **Receipts and manifests** hold no screens or secrets. Keep them as long as you need the record, under your normal retention rules.
- **Evidence, recordings and run sheets** show whatever was on screen. Keep them only until the failure is understood or the review is done, then delete them. Never commit them, and never attach them to a public issue.
- Keep credentials your drivers read outside the output and evidence directories.

Moments deletes nothing itself.
