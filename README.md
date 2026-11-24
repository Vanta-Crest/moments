# Moments

Moments drives a real web application through a journey of checkpoints, proves each checkpoint from the application itself, and keeps a record of what was proven, by whom and on which system. It is for teams who must show an application working, to a reviewer, a client or an auditor, and who want to start exploring from a known, verified state instead of setting it up by hand.

## Why

- **A checkpoint passes only when it is proven.** Your code verifies it from the product's own screens or API. A step that ran is not a step that was proven.
- **People can take over.** In an interactive run, a reviewer uses the application by hand. Moments verifies what they did before adopting it, records it as done by hand, and never repeats it.
- **Every run leaves a record a reviewer can trust.** The receipt names the system, the journey, who acts at each checkpoint, how and when each was verified, what each proves, and whether cleanup completed. Fingerprints show later whether anything has changed. Secrets and screenshots never enter it.
- **Your application stays in charge.** Your driver performs every action. Moments sequences the steps, holds the browser and keeps the record.

Moments is built on [Playwright](https://playwright.dev). It runs locally. There is no service, account or telemetry.

## Try it in five minutes

You need Node 22 or newer and git.

```sh
git clone https://github.com/Vanta-Crest/moments.git
cd moments/examples/task-app
npm install
npx playwright install chromium
npm run build
npm start
```

Leave the app running. In a second terminal, in `moments/examples/task-app`:

```sh
npx moments open task.completed --once --record --chapters
npx moments report
```

Moments creates a task, completes it and deletes it again, printing a line as each checkpoint is entered and verified. `report` prints the path of a run sheet: open it in a browser to see each checkpoint, how it was verified and the frame from the recording. It shows screens, so it is private to you.

Now take over by hand:

```sh
npx moments open task.created
```

A browser opens with a task created and verified. Click **Complete task** yourself, then open the Moments panel with **Show Moments** and press **Continue**: Moments verifies your change and records it as done by hand. **End session** deletes only this run's task and closes the browser.

## Install

```sh
npm install --save-dev @vanta-crest/moments @playwright/test
npx playwright install chromium
```

| Requirement | Supported |
| --- | --- |
| Node | 22 or newer; tested on 22, 24 and 26 |
| Playwright | `@playwright/test` 1.60 or a later 1.x, with Chromium |
| React | 18.3 or 19, only for the optional panel |
| Operating system | Linux, macOS and Windows. The full browser proof runs on Linux and macOS; core tests and the CLI proof run on all three. |

On Linux, `npx playwright install --with-deps chromium` also installs the system libraries Chromium needs.

## Documentation

Start with [Your first journey](docs/first-journey.md), then read [Concepts](docs/concepts.md).

| Guide | When you need it |
| --- | --- |
| [Writing journeys](docs/guides/writing-journeys.md) | The driver contract, adoption, cleanup, checkpoint fields |
| [Evidence and review](docs/guides/evidence-and-review.md) | Receipts, failure evidence, `verify`, `report`, traceability, retention |
| [Recording](docs/guides/recording.md) | Filming a run and exactly what is and is not filmed |
| [Sign-in and the Director](docs/guides/sign-in-and-director.md) | Journeys that leave your origin, credentials, one-time codes |
| [Resume](docs/guides/resume.md) | Skipping checkpoints that are already true |
| [Run values](docs/guides/run-values.md) | Letting a reviewer change the text a journey types |
| [Presenting](docs/guides/presenting.md) | Showing a journey live |
| [React panel](docs/guides/react-panel.md) | Embedding the controls, or building your own |
| [Catalogue](docs/guides/catalogue.md) | Switching between journeys from a custom interface (advanced) |

[Reference](docs/reference.md) lists every command, option and file format. [Troubleshooting](docs/troubleshooting.md) is keyed on the messages you will see. Changes between versions are in the [changelog](CHANGELOG.md), and what Moments will and will not become is in the [roadmap](ROADMAP.md).

## Licence and security

Apache-2.0. Use Moments only on systems you are authorised to exercise, and report vulnerabilities as described in [SECURITY.md](SECURITY.md). To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).
