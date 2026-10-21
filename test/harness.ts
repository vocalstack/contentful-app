import { vi } from 'vitest'

import type { Job, Transcript } from '../src/api.js'
import type { AppInstallationParameters, VocalStackFieldData } from '../src/types.js'

import { run } from '../functions/vocalstack.js'
import { appActionBackend } from '../src/backend.js'
import { type FieldTarget } from '../src/transcription.js'

export const transcript: Transcript = {
  lang: 'en',
  segments: [],
  sentences: [
    { end: 2.004, sentenceId: 1, speaker: 0, start: 0.5, text: 'Hello there.' },
    { end: 3, sentenceId: 2, speaker: 0, start: 2.5, suppressed: true, text: 'uh' },
    { end: 6, sentenceId: 3, speaker: 1, start: 4, text: ' Hi. ' },
  ],
}

export const job = (patch: Partial<Job> = {}): Job => ({ progress: { pct: 0 }, recordingId: 'rec_1', state: 'queued', transcriptionId: 'tx_1', ...patch })

/** VocalStack, as the App Function's fetch sees it. */
export function mockVocalStack() {
  const state = { job: job(), stopStatus: 200 }
  const calls: { body?: string; headers: Record<string, string>; method: string; path: string }[] = []
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    calls.push({ body: typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined, headers: (init.headers ?? {}) as Record<string, string>, method, path: url.pathname })
    const route = `${method} ${url.pathname}`
    if (route === 'POST /v1/connect/token') return reply(200, { access_token: 'vs_key_new', account: { name: 'Acme' }, token_type: 'api_key' })
    if (route === 'GET /v1/me') return reply(200, { principal: { name: 'Acme' } })
    if (route === 'POST /v1/transcriptions') return reply(201, { id: 'tx_1', job: state.job, name: 'Episode 1' })
    if (route === 'GET /v1/recordings/rec_1/job') return reply(200, state.job)
    if (route === 'GET /v1/recordings/rec_1/transcript') return reply(200, transcript)
    if (route === 'POST /v1/recordings/rec_1/stop') return state.stopStatus === 200 ? reply(200, {}) : reply(409, { error: { code: 'conflict', message: 'Over.' } })
    return reply(404, { error: { code: 'not_found', message: route } })
  })
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch, state }
}

/**
 * The App SDK's CMA client, whose app action calls run the real App Function against
 * mocked VocalStack, with the Secret installation parameters only the function sees.
 */
export function mockSDK(install: AppInstallationParameters, vs = mockVocalStack()) {
  // The function's runtime fetch; nothing reaches the real API.
  vi.stubGlobal('fetch', vs.fetchImpl)
  const createWithResult = vi.fn(async (ids: { appActionId: string; appDefinitionId: string }, payload: { parameters: Record<string, unknown> }) => {
    const result = await run(payload.parameters as never, install, { spaceId: 'space1' })
    return { sys: { status: 'succeeded', result } }
  })
  const sdk = { cma: { appActionCall: { createWithResult } }, ids: { app: 'app1' } }
  return { backend: appActionBackend(sdk as never), createWithResult, vs }
}

/** An entry field as the App SDK exposes it, per locale, autosaving like Contentful does. */
export function mockEntryField(initial?: VocalStackFieldData) {
  const values: Record<string, unknown> = { 'en-US': initial }
  const setValue = vi.fn(async (v: unknown, locale = 'en-US') => {
    values[locale] = JSON.parse(JSON.stringify(v))
    return values[locale] as never
  })
  const field = { getValue: (locale = 'en-US') => values[locale], setValue }
  const target: FieldTarget = { get: () => field.getValue('en-US') as undefined | VocalStackFieldData, set: (v) => field.setValue(v, 'en-US') }
  return { setValue, target, value: () => values['en-US'] as undefined | VocalStackFieldData }
}
