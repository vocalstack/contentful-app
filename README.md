# @vocalstack/contentful

VocalStack for [Contentful](https://www.contentful.com): a **Transcribe** button on every entry with audio. The transcript is saved in a JSON Object field as text plus timed sentences, so the Content Delivery API and GraphQL return it with the entry.

## Install

A custom app ([App Framework](https://www.contentful.com/developers/docs/extensibility/app-framework/)) in your Contentful organization. Not in the Marketplace. `build/` is committed, so it uploads without building (run `npm run build` and commit `build/` with every change).

1. **Create the app.** Organization settings → **Apps** → **Create app**, named VocalStack. Turn on these locations:
   - **App configuration screen**
   - **Entry field**, for the **JSON object** field type
   - **Entry sidebar**

   Under **Instance parameters**, add `audioField` (Short text, optional, display name "Audio field"). Save.
2. **Upload the bundle** to Contentful's hosting:

   ```sh
   npm install && npm run build && npm run upload
   ```

   `npm run upload` (`@contentful/app-scripts`) asks for the organization, the app and a management token. Without building, `npx @contentful/app-scripts upload --bundle-dir ./build` uploads the committed bundle. Or host `build/` yourself on any https static host and set it as the app's Frontend URL.
3. **Add a Transcript field** to each content type with audio: a **JSON object** field next to its Media field.
4. **Install it in a space**: the app's page → **Install to space**. On the configuration screen, connect a VocalStack account, pick the content types, and click **Install**.

For development, `npm start` serves the app on `http://localhost:5173`; set that as the Frontend URL and open the app from a space it is installed in.

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

**Where the key is kept.** The key is an installation parameter of the app. Contentful gives installation parameters to the app wherever it runs, so the app can call VocalStack from the entry editor, and space members who can open the app's configuration can read the key. Connect with a key made for this space (one-click connect makes one, named after the space), and revoke it under **Developers → API keys** in the VocalStack dashboard if it leaks or when you uninstall the app.

## Options

Installation parameters, set on the configuration screen:

| Parameter | Default | |
|---|---|---|
| `apiKey` | none | A `vs_key_…` key with Read and Write, pasted or made by **Connect VocalStack**. |
| `spokenLanguage` | auto-detect | A Whisper language code (`en`, `ro`, …). |
| `contentTypes` | none | Which content types get the app: `{ [contentTypeId]: { transcriptField, audioField? } }`. `transcriptField` is a JSON Object field; it defaults to one called Transcript. |
| `apiURL` / `dashboardURL` | `https://api.vocalstack.com` / `https://app.vocalstack.com` | Under **Advanced**. |

Instance parameter of the Transcript field (Content model → the field → **Appearance**):

| Parameter | Default | |
|---|---|---|
| `audioField` | the configuration screen's Audio field, else the first Media field linking an `audio/*` asset | The id of the Media field whose asset is transcribed. A many-files Media field gives its first audio asset. |

The entry's locale picks the asset's file and the transcript's locale: the field editor works in its own locale, the sidebar in the space's default locale.

**How the audio reaches VocalStack.** Contentful serves asset files from public addresses (`//assets.ctfassets.net/…` and `//downloads.ctfassets.net/…`), so the app sends that address, made https, and VocalStack fetches the file (`POST /v1/transcriptions { url }`). Nothing is uploaded from the browser. The job runs on VocalStack, and the entry editor polls every 3 s; only one open editor polls at a time. The account is billed per second, with a 5-minute minimum per transcription.

Spaces with embargoed assets serve files only with a signed address, which VocalStack cannot fetch; the app does not support them yet.

## One-click connect (protocol)

The alternative to pasting a key: **Connect VocalStack** opens the dashboard in a new tab, the person clicks **Authenticate**, and the tab closes. This is OAuth 2.0 authorization code + PKCE (RFC 7636) with an API key as the access token, as in the Payload plugin, but run in the browser: the app has no server, and PKCE is what makes that safe. There is no client registration: the consent screen shows the `redirect_uri` host instead.

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
POST api/v1/connect/token (form) ───────────────────────────────────────▶ grant_type=authorization_code, code,
                                                                           code_verifier, redirect_uri
                                                                           verify, burn the code, create the key
◀── { access_token: "vs_key_…", token_type: "api_key", key_id, account: { name } }
── postMessage { ok, message } ────▶ "Connected", tab closes
Save the configuration: the key becomes the apiKey installation parameter
```

Cancel redirects with `?error=access_denied&state=…`. If the tab lost track of the configuration screen, it shows its address to paste there instead. The key appears in the dashboard's API keys list as `<space name> (Contentful)`, where it can be revoked.
