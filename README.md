# @vocalstack/contentful

VocalStack for [Contentful](https://www.contentful.com): a **Transcribe** button on every entry with audio. The transcript is saved in a JSON Object field as text plus timed sentences, so the Content Delivery API and GraphQL return it with the entry.

Read more about the [VocalStack transcription app for Contentful](https://vocalstack.com/contentful-transcription-app/) on the [VocalStack website](https://vocalstack.com/).

Every VocalStack call runs server-side in the app's [App Function](https://www.contentful.com/developers/docs/extensibility/app-framework/functions/), on Contentful. The browser never sends the API key to VocalStack; it calls the function through app actions. No server of your own is needed.

## Install

A custom app ([App Framework](https://www.contentful.com/developers/docs/extensibility/app-framework/)) in your Contentful organization, hosted by Contentful (Functions run only on Contentful-hosted apps). Not in the Marketplace. `build/` (the frontend and `build/functions/vocalstack.js`) is committed, so it uploads without building (run `npm run build` and commit `build/` with every change).

1. **Create the app.** Organization settings → **Apps** → **Create app**, named VocalStack. Turn on these locations:
   - **App configuration screen**
   - **Entry field**, for the **JSON object** field type
   - **Entry sidebar**

   Under **Installation parameters**, add `apiKey` of type **Secret** (display name "API key"). Under **Instance parameters**, add `audioField` (Short text, optional, display name "Audio field"). Save.
2. **Upload the bundle and its function, then create the app actions:**

   ```sh
   npm install && npm run build && npm run deploy
   ```

   `npm run deploy` is `npm run upload` (the frontend and the `vocalstack` function from `contentful-app-manifest.json`, which may call only `api.vocalstack.com`) followed by `npm run upsert-actions` (the four app actions `vocalstackTranscribe`, `vocalstackStatus`, `vocalstackStop` and `vocalstackConnect`, all invoking that function). Both ask for the organization, the app and a management token; `upload-ci` and `upsert-actions-ci` take them from `CONTENTFUL_ORG_ID`, `CONTENTFUL_APP_DEF_ID` and `CONTENTFUL_ACCESS_TOKEN`. Without building, `npm run deploy` uploads the committed `build/`.
3. **Add a Transcript field** to each content type with audio: a **JSON object** field next to its Media field.
4. **Install it in a space**: the app's page → **Install to space**. On the configuration screen, pick the content types and paste a key, then click **Install**. Or install first and then click **Connect VocalStack**: the function redeems the one-click code, so it needs the app installed. Saving checks the key through the function (**Check connection** does it again).

For development, `npm start` serves the frontend on `http://localhost:5173`; set that as the Frontend URL and open the app from a space it is installed in. The app actions still run the uploaded function.

Tests: `npm test` (unit), and `VOCALSTACK_API_KEY=vs_key_… npm run e2e`, which runs the built app and function in a real browser inside a local stand-in for Contentful, against a real VocalStack, with no Contentful account (see [e2e/README.md](e2e/README.md)).

## What it adds

- **For each content type picked on the configuration screen:**
  - the Transcript field's editor: **Transcribe**, the transcript as VocalStack hears it while the job runs, then the text, which an editor can **Edit** (or **Write transcript** without audio, or **Delete transcript**).
  - the same **Transcribe** button in the entry sidebar. Both show progress and survive a reload mid-job, and **Stop** ends a job you no longer want: the field goes back to how it was (an earlier transcript stays), and VocalStack keeps what it transcribed before the stop.
  - the Transcript field's value:
    - `transcript`: text you can edit; paragraphs break on a speaker change or a pause.
    - `sentences`: `[{ start, end, speaker, text }]` in seconds.
    - `status`, `language`, `error`, `recordingId`, `transcriptionId` and `transcribedAt`.

    ```json
    {
      "transcript": "Welcome to the show.\n\nThanks for having me.",
      "sentences": [
        { "start": 0.48, "end": 2.1, "speaker": 0, "text": "Welcome to the show." },
        { "start": 2.6, "end": 4.02, "speaker": 1, "text": "Thanks for having me." }
      ],
      "status": "done",
      "language": "en",
      "error": null,
      "recordingId": "…",
      "transcriptionId": "…",
      "transcribedAt": "2026-10-21T09:30:00.000Z"
    }
    ```

    The field is an ordinary JSON field: it is saved with the entry's draft, published with the entry, and read like any other field (`fields.transcript` in the Content Delivery API, `transcript` as JSON in GraphQL).
- **The app configuration screen**, where an admin connects an account, sets the spoken language and picks the content types.

**Where the key is kept.** In the `apiKey` installation parameter, of type Secret. Contentful hands a Secret's raw value only to the app's Function, and redacts it in the App SDK and in the Content Management API read with a personal token; the configuration screen and the entry editor never read it back. The key passes through the browser once, before it is saved: when pasted, or as the one-click connect function's answer to the configuration screen. A non-secret `connected` flag tells the editor a key is saved. On later saves the configuration screen sends the key back as Contentful redacted it, which should keep the stored value; this was not tried in a live space, so if a save ever loses the key, connect again. Revoke the key under **Developers → API keys** in the VocalStack dashboard when you uninstall the app.

## Options

Installation parameters, set on the configuration screen:

| Parameter | Default | |
|---|---|---|
| `apiKey` | none | Secret. A `vs_key_…` key with Read and Write, pasted or made by **Connect VocalStack**. Read only by the function. |
| `spokenLanguage` | auto-detect | A Whisper language code (`en`, `ro`, …). |
| `contentTypes` | none | Which content types get the app: `{ [contentTypeId]: { transcriptField, audioField? } }`. `transcriptField` is a JSON Object field; it defaults to one called Transcript. |
| `apiURL` / `dashboardURL` | `https://api.vocalstack.com` / `https://app.vocalstack.com` | Under **Advanced**. Another API host must also be in the function's `allowNetworks`. |

Instance parameter of the Transcript field (Content model → the field → **Appearance**):

| Parameter | Default | |
|---|---|---|
| `audioField` | the configuration screen's Audio field, else the first Media field linking an `audio/*` asset | The id of the Media field whose asset is transcribed. A many-files Media field gives its first audio asset. |

The entry's locale picks the asset's file and the transcript's locale: the field editor works in its own locale, the sidebar in the space's default locale.

**How the audio reaches VocalStack.** Contentful serves asset files from public addresses (`//assets.ctfassets.net/…` and `//downloads.ctfassets.net/…`), so the app passes that address, made https, to its function, which asks VocalStack to fetch it (`POST /v1/transcriptions { url }`); the function accepts `*.ctfassets.net` addresses only. Nothing is uploaded from the browser. The job runs on VocalStack, and the entry editor calls the status action every 3 s (only one open editor polls at a time), saving `recordingId` and `status` in the field; once done it saves the transcript the function returns. The account is billed per second, with a 5-minute minimum per transcription.

Spaces with embargoed assets serve files only with a signed address, which VocalStack cannot fetch; the app does not support them yet.

## One-click connect (protocol)

The alternative to pasting a key: **Connect VocalStack** opens the dashboard in a new tab, the person clicks **Authenticate**, and the tab closes. This is OAuth 2.0 authorization code + PKCE (RFC 7636) with an API key as the access token, as in the Payload plugin, with the app's Function as the server. There is no client registration: the consent screen shows the `redirect_uri` host instead.

```
Configuration screen (iframe)        Callback tab (the app's own page)    app.vocalstack.com / api.vocalstack.com
─────────────────────────────        ─────────────────────────────────    ───────────────────────────────────────
click Connect: state, verifier (memory only)
new tab ─▶ GET app/connect?response_type=code&client_name=<space> (Contentful)&redirect_uri=<app URL>?vocalstack-connect=1
           &state=…&code_challenge=…&code_challenge_method=S256&scope=read write
           (sign in if needed; pick the organization; "<app host> wants to transcribe with VocalStack")
           click Authenticate ─▶ API stores a single-use grant (code hash, challenge, redirect, scopes, principal; 2 min)
                                     ◀── 302 redirect_uri&code=…&state=…
◀── postMessage { code, state } ──── (window.opener, same origin only)
check state
app action vocalstackConnect { code, codeVerifier, redirectUri }
  ─▶ App Function (on Contentful, no Origin) ─ POST api/v1/connect/token (form) ─▶ grant_type=authorization_code, code,
                                                                                   code_verifier, redirect_uri
                                                                                   verify, burn the code, create the key
                                             ◀── { access_token: "vs_key_…", token_type: "api_key", key_id, account: { name } }
◀── { apiKey, account }
── postMessage { ok, message } ────▶ "Connected", tab closes
Save the configuration: the key becomes the Secret apiKey installation parameter
```

Cancel redirects with `?error=access_denied&state=…`. If the tab lost track of the configuration screen, it shows its address to paste there instead. The key appears in the dashboard's API keys list as `<space name> (Contentful)`, where it can be revoked.
