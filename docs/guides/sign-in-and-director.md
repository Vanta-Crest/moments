# Sign-in and the Director

This guide covers journeys that sign in, leave your application's origin, or wait for a one-time code.

## When to use the Director

The embedded panel works only on your application's own origin. Set `director: true` in the config when:

- the journey leaves that origin: single sign-on, a mailbox, a payment page, another portal; or
- the application must not embed development controls at all.

```ts
export default defineConfig({
  baseURL: 'https://portal.staging.example.com',
  environment: 'Portal, staging',
  director: true,
  journeys: [onboarding],
  async beforeRun() { /* … */ },
});
```

An interactive run then opens a separate **Moments Director** window with the same controls as the panel. It works whatever origin the application window is on. Application pages get no Moments bridge at all, so an embedded panel shows that it is not connected: remove it or ignore it.

When the browser is visible, Moments places the application on the left of the screen and the Director in a 420-pixel column on the right. Closing either window ends the session: Moments cleans up, writes the receipt and closes both. Restarting, or opening an earlier checkpoint, closes and reopens both windows.

`--once` runs never open the Director: they have no one to show it to.

## Credentials stay in the driver

Read passwords, API keys and authenticator seeds inside your driver, from your own secret store or environment, at the moment you need them. Never put them in:

- checkpoint titles, descriptions or actors, which are kept in the receipt;
- [run values](run-values.md), which are public by design;
- error messages, which go to evidence files that may be shared with a reviewer.

`beforeRun` often reads the same environment. If it throws, the CLI prints a safe description and the path of the evidence file holding the message, not the message itself.

## Waiting for a code

When a step must wait for a fresh authenticator code or an email, say so:

```ts
// A step inside create(context):
async enter() {
  context.reportProgress?.('waiting-for-code');
  try {
    await page.getByLabel('Code').fill(await nextCode());
  } finally {
    context.reportProgress?.(undefined);
  }
  await page.getByRole('button', { name: 'Verify' }).click();
}
```

`nextCode` stands for your own helper. While the wait lasts, the CLI prints `waiting for a fresh code…`, the panel shows **Waiting for code**, and a recording's timeline marks the stretch so an editor can shorten it honestly. Never pass the code itself: `reportProgress` takes only `'waiting-for-code'` or `undefined`.

## Keep sign-in off film

Mark every checkpoint whose screens show a secret as `private: true`: passwords being set, authenticator setup keys and codes, recovery codes, invitation emails. See [Recording](recording.md) for exactly when filming stops and starts.

```ts
checkpoints: [
  { id: 'invited', title: 'Invitation received', private: true },
  { id: 'signed-in', title: 'Signed in', private: true },
  { id: 'profile', title: 'Profile completed', actor: 'Amara Okafor, applicant' },
],
```
