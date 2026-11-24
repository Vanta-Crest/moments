# Security

This page states the security boundaries of Moments and how to report a vulnerability.

## Boundaries

- Use Moments only on systems you are authorised to exercise.
- The config and journeys are trusted local code. Moments runs them with your permissions.
- The browser bridge exists only in the page Moments opened, in its main frame, at the configured origin; with `director: true`, only in the Director window. It is a boundary for development tools, not production authorisation. Keep the panel out of production builds.
- Receipts and manifests hold no screenshots, credentials, browser storage or thrown messages.
- Failure evidence, recordings and run sheets show whatever was on screen. They are written readable only by you, and must be reviewed before they leave your machine. See [Evidence and review](docs/guides/evidence-and-review.md#keeping-and-deleting).

## Reporting a vulnerability

Report it privately with **Report a vulnerability** on the repository's Security tab, not in a public issue. Leave out credentials and customer data. Never attach a recording, run sheet or evidence file to a public issue.

Moments is a preview with no long-term support branch. Security fixes go into the current release; upgrade to receive them.
