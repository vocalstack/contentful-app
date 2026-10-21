import type { FunctionEventHandler, FunctionTypeEnum } from '@contentful/node-apps-toolkit'

import type { AppInstallationParameters } from '../src/types.js'

import { type ActionError, type ActionParams, type CompactTranscript, LIVE_SENTENCES } from '../src/actions.js'
import { type Transcript, accountLabel, DEFAULT_API_URL, VocalStackAPI, VocalStackAPIError } from '../src/api.js'

/**
 * Every VocalStack call the app makes, server-side on Contentful. The API key is the
 * `apiKey` installation parameter, of type Secret: Contentful hands its raw value to
 * Functions only, and the frontend never sees it.
 */

const refused = (status: number, code: string, message: string): ActionError => ({ error: { code, message, status } })

/** Contentful's own asset hosts: the function fetches nothing else on the account's credit. */
export function isContentfulAssetURL(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'ctfassets.net' || u.hostname.endsWith('.ctfassets.net'))
  } catch {
    return false
  }
}

const compact = (t: Transcript, latest?: number): CompactTranscript => {
  const sentences = t.sentences.filter((s) => !s.suppressed && s.text.trim())
  return { lang: t.lang, sentences: latest ? sentences.slice(-latest) : sentences }
}

export async function run(params: ActionParams, install: AppInstallationParameters, ctx: { spaceId: string }): Promise<object> {
  const apiURL = (install.apiURL || DEFAULT_API_URL).replace(/\/+$/, '')
  try {
    if (params.op === 'connect') {
      // No Origin and no Sec-Fetch-Site from here: the token endpoint answers servers only.
      const res = await fetch(`${apiURL}/v1/connect/token`, {
        body: new URLSearchParams({ code: params.code ?? '', code_verifier: params.codeVerifier ?? '', grant_type: 'authorization_code', redirect_uri: params.redirectUri ?? '' }),
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      })
      const token = (await res.json().catch(() => ({}))) as { access_token?: string; account?: { name?: string }; error?: string; error_description?: string }
      if (!res.ok || !token.access_token) return refused(res.status, token.error ?? 'invalid_grant', `VocalStack did not issue a key: ${token.error_description ?? res.status}`)
      return { account: token.account?.name, apiKey: token.access_token }
    }

    if (!install.apiKey) return refused(401, 'not_connected', 'Connect VocalStack first.')
    const api = new VocalStackAPI(install.apiKey, apiURL)

    switch (params.op) {
      case 'status': {
        if (!params.recordingId) return { account: accountLabel(await api.me()), connected: true }
        const job = await api.job(params.recordingId)
        if (job.state === 'transcribing') {
          const transcript = await api.transcript(params.recordingId).then((t) => compact(t, LIVE_SENTENCES), () => undefined)
          return { job, transcript }
        }
        if (job.state === 'done') return { job, transcript: compact(await api.transcript(params.recordingId)) }
        return { job }
      }
      case 'stop':
        try {
          await api.stop(params.recordingId, 'Stopped from Contentful')
          return { ended: false }
        } catch (err) {
          // Too late to stop: the job ended meanwhile.
          if (err instanceof VocalStackAPIError && err.status === 409) return { ended: true }
          throw err
        }
      case 'transcribe': {
        if (!isContentfulAssetURL(params.url)) return refused(400, 'invalid_url', 'Only Contentful asset files (ctfassets.net) can be transcribed.')
        const tx = await api.transcribeURL(params.url, {
          idempotencyKey: `contentful:${ctx.spaceId}:${params.idempotencyKey}`,
          name: params.name || 'Contentful audio',
          spokenLanguage: install.spokenLanguage || undefined,
        })
        if (!tx.job) return refused(502, 'no_job', 'VocalStack did not start a job for this file.')
        return { recordingId: tx.job.recordingId, state: tx.job.state, transcriptionId: tx.id }
      }
      default:
        return refused(400, 'unknown_op', 'Unknown VocalStack action.')
    }
  } catch (err) {
    if (err instanceof VocalStackAPIError) return refused(err.status, err.code, err.message)
    return refused(502, 'unreachable', `Could not reach VocalStack: ${(err as Error).message}`)
  }
}

export const handler: FunctionEventHandler<FunctionTypeEnum.AppActionCall, AppInstallationParameters> = async (event, context) =>
  (await run(event.body as unknown as ActionParams, context.appInstallationParameters, context)) as Record<string, unknown>
