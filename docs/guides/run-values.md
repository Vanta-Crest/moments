# Run values

This guide explains run values: public text a reviewer can change to fill a journey's forms, such as a company name.

## Declare them

A journey that accepts values adds a `setup` definition. It holds only public text. Identity, passwords, tokens and anything the run must own stay in the driver.

```ts
import { defineStepJourney, validateSetupValues, type SetupDefinition } from '@vanta-crest/moments';

const fields = [
  { key: 'displayName', label: 'Display name', maxLength: 120 },
  { key: 'intendedUse', label: 'Intended use', multiline: true, maxLength: 400 },
] as const;

const setup: SetupDefinition = {
  schemaVersion: 1,
  fields,
  defaults: { displayName: 'Amara Okafor', intendedUse: 'Collect customer payments.' },
  parse: values => validateSetupValues(fields, values),
};

export const onboarding = defineStepJourney({ id: 'onboarding', title: 'Onboard a customer', setup, /* checkpoints, create */ });
```

Moments validates the defaults and calls your `parse` before admission. Add domain rules in `parse`, using your product's own validators where you can. Values are trimmed, required and bounded by each field's `maxLength`.

`create({ setup })` receives the run's values as an immutable `{ schemaVersion, values }`. Use the same values in `enter`, `verify` and `reconcile`.

## Change them

In the panel, **Run values** opens a form where a reviewer edits the values and starts a fresh run with them. Drafts are kept in that browser tab only. Every accepted change starts a full new run: Moments records the request on the old run, cleans it up, then opens the new one. Continue, Play, Restart and opening an earlier checkpoint all keep the active values, whatever an unsaved draft says.

Explicit values must name every declared field and no others. They never merge with defaults: an empty value or a partial set is refused, with a message per field, and the current run carries on unchanged.

Values the reviewer types into the product by hand are not run values. They are not recorded, and they do not change what the run requested.

## Save and replay them

**Export run setup** in the panel's **Session details** downloads the active values and the last verified checkpoint as a file. Start a run from it:

```sh
npx moments open --setup ./review.json
```

A target on the command line is optional; if given, it must match the file. The file is UTF-8 JSON of at most 64 KiB. Its format is in [Reference](../reference.md#setup-file). Invalid values exit 2 before anything is opened or created.

From code, pass `setup: { schemaVersion, values }` to `openMoment`. Invalid values throw `MomentSetupError`, with field-level `issues`, before `beforeRun`.
