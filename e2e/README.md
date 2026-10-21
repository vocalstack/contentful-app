# End-to-end test, without a Contentful account

The built app (`build/`) runs in a real Chromium inside a stand-in for the Contentful
web app, and its App Function (`build/functions/vocalstack.js`, the bundle that
`npm run upload` ships) runs in a local Node process against a real VocalStack. Nothing
about the app is mocked: it talks to the host through the App SDK's own postMessage
channel, as it does in Contentful.

```sh
VOCALSTACK_API_KEY=vs_key_… e2e/run.sh
```

It builds the app, starts the fake Contentful, runs `contentful.spec.mjs`, and stops the
servers. Screenshots go to `e2e/results/shots/` (or `E2E_SHOTS`), and a summary with the
transcript to `e2e/results/summary.json`.

| Variable | Default | |
| --- | --- | --- |
| `VOCALSTACK_API_KEY` | required | A key with Read and Write. Each run starts three transcriptions. |
| `VOCALSTACK_API_URL` | `http://127.0.0.1:8090` | Set on the configuration screen's Advanced → API URL, as an editor would. |
| `E2E_AUDIO` | `e2e/fixtures/episode-042.mp3` | A short mp3 of speech (git-ignored; bring your own). |
| `E2E_CHROMIUM` | Playwright's Chromium | Path to a Chromium binary. |
| `E2E_SKIP_BUILD` | | `1` to test `build/` as it is. |
| `E2E_ECHO` | `1` | `0`: `valueChanged` goes only to the other frames, not back to the one that called `setValue`. |
| `E2E_HOST_PORT`, `E2E_APP_PORT`, `E2E_ASSET_PORT` | 5180, 5181, 5182 | |

## What runs where

- `server.mjs`: three origins, as in Contentful. The host page (5180) with the space's
  content in memory: two content types, one entry, its audio asset, the installation. The
  app bundle (5181), on its own origin like Contentful's app hosting. A stand-in for
  `ctfassets.net` (5182) serving the audio. App action calls are checked against
  `contentful-app-manifest.json` (action ids, required and Enum parameters, no unknown
  ones) and handed to the built function's `handler(event, context)` with the stored,
  unredacted installation parameters.
- `host/host.js`: the web app's side of the App SDK channel. It answers `init` with the
  location's `connect` data (app-config, entry-field, entry-sidebar), the SDK's
  `CMAAdapterCall` requests (content types, space, asset, `AppActionCall.createWithResult`),
  `setValue`/`removeValue` (saved, then `valueChanged` to every app frame of the entry, the caller included unless `E2E_ECHO=0`),
  `callAppMethod`, the configuration's `appHook` stages behind its Install/Save button,
  `notify` as toasts, and `openDialog('confirm')` as a real dialog. Whatever else the app
  asks is listed under "Not faked", and the test fails on it.
- The entry editor shows the Transcript field and the sidebar only where the saved
  `targetState` puts them, and reads the Secret `apiKey` as `••••••••`; saving that value
  back keeps the stored key.

VocalStack does not fetch private addresses, so the function cannot hand it a
`127.0.0.1` asset URL. `server.mjs` sets `VOCALSTACK_TEST_ASSET_HOSTS=127.0.0.1:5182`, and
the function fetches files from listed hosts itself (over http) and uploads them. The
variable is read from `globalThis.process.env`, which Contentful's Functions runtime does
not set, so a deployed function still accepts `ctfassets.net` URLs only.

## Steps

1. Configuration: paste the key, tick Episode, pick its Transcript and Audio fields, set
   the API URL, Install. The function then checks the stored key ("Connected to
   VocalStack as …"). Reopen and save again: the redacted key keeps the stored one.
2. Entry field: Transcribe; progress shows in the field and the sidebar.
3. Reload mid-job: the field and sidebar pick the job back up from the saved field value.
4. Done: the JSON value holds the transcript, sentences, language.
5. Sidebar: the same done state.
6. Stop: Transcribe again from the sidebar, Stop in the field, confirm; the earlier
   transcript comes back and VocalStack reports the job `stopped`.
7. Stop elsewhere: a third run stopped through the API directly; the field goes back.
8. No unanswered SDK calls, no key in any action call or in the web app's state, no
   page errors.

## Not covered (needs a real space)

The fake follows `@contentful/app-sdk` 4.x's wire protocol, not Contentful's behaviour
behind it. Unverified here: how Contentful redacts a Secret parameter and whether
sending the redacted value back keeps the key; the real app action runtime (its
`event`/`context` shapes, timeouts, `allowNetworks`, parameter length limits); whether the
web app echoes `valueChanged` to the frame that called `setValue`; `npm run upload` and
`upsert-actions`; one-click connect (it needs the dashboard).
