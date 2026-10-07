# Troubleshooting

| Symptom | Action |
| --- | --- |
| Config missing | Run beside it or pass `--config`; parents are not searched. |
| Config cannot load | Check the default export and ESM imports with your type checker. Raw config exceptions are suppressed. |
| Chromium missing | Run `npx playwright install chromium` with the runner's Playwright installation. Linux may need `--with-deps`. |
| App unavailable | Start the app and check baseURL; retain the admission probe. |
| Panel unavailable | Mount it in the development app, load CSS and use the managed browser at the configured origin. |
| Version mismatch | Use the same Moments version in runner and app; rebuild and reconnect. |
| Disconnected | The last view is stale; review state after reconnection. Actions are never replayed. |
| Destination verification fails | Restore state and Check; it retries verification without repeating entry. |
| Manual state unknown | Restore a supported state or restart. Reconcile must identify state positively. |
| Incomplete after retry | Earlier failures remain in history intentionally. |
| Cleanup incomplete | Inspect safe failure stages and only resources owned by that run. |
| Receipt missing/outdated | Check output permissions or custom writer failure. The final returned result is authoritative if persistence fails. |
| Run values rejected | Check the setup schema, exact complete field set, required text and native length limits. The current run is unchanged. |
| Replacement blocked by receipt failure | The current browser/driver is retained. Restore the writer before retrying or explicitly End. Candidate values remain in `currentResult`, but a rejected write provides no durable recovery guarantee. |
| Replacement browser did not open | Inspect the new result's setup, target, lineage and safe failure stages. The old browser may already be closed; no panel is promised to survive. |
| Draft disappeared after restart | Drafts are same-tab scratch state. Accepted setup belongs to the runner; an ordinary fresh run carries active values and discards unapplied edits. |
| Reproduction differs after manual edits | Export records requested autofill inputs. Native manual edits are not recorded as a replay recipe. |
| Setup target mismatch | Remove the positional target or make it exactly match the file. Input paths resolve from caller cwd. |
| Shutdown waits | Driver operations must settle; use bounded timeouts. Forced kills cannot guarantee cleanup. |

Config and drivers are trusted development code. Moments is not production
authorization. Do not mount its control panel in a production entry point.

Use **Export run setup** before ending when you want a portable public recipe,
then run `moments open --setup ./review.json` (or `alpine moment open --setup
./review.json` for Alpine onboarding). A custom receipt writer may not provide a
filesystem path. Inspect its actual store or retain the returned result; do not
infer that a setup file or a durable receipt exists from an accepted command.
