import { describe, expect, it } from 'vitest'

import type { VocalStackFieldData } from '../src/types.js'

import { VocalStackAPIError } from '../src/api.js'
import { ActionCallError } from '../src/backend.js'
import { checkJob, describeError, startTranscription, stopTranscription } from '../src/transcription.js'
import { job, mockEntryField, mockSDK } from './harness.js'

const install = { apiKey: 'vs_key_secret', connected: true, spokenLanguage: 'en' }
const previous: VocalStackFieldData = { language: 'en', sentences: [{ end: 1, speaker: 0, start: 0, text: 'Old.' }], status: 'done', transcript: 'Old.' }
const processing = { ...previous, recordingId: 'rec_1', status: 'processing' as const, transcriptionId: 'tx_1' }

describe('startTranscription', () => {
  it('has the function send the asset URL, and saves the job in the field, keeping the earlier transcript', async () => {
    const f = mockEntryField(previous)
    const { backend, createWithResult, vs } = mockSDK(install)
    await startTranscription(backend, f.target, { idempotencyKey: 'entry1:k', name: 'Episode 1', url: 'https://assets.ctfassets.net/a/b/c/ep.mp3' })

    // The frontend sends the action no key; the function adds it.
    expect(JSON.stringify(createWithResult.mock.calls)).not.toContain('vs_key_')
    expect(createWithResult.mock.calls[0][0]).toEqual({ appActionId: 'vocalstackTranscribe', appDefinitionId: 'app1' })
    const sent = vs.calls[0]
    expect(sent.path).toBe('/v1/transcriptions')
    expect(sent.headers.authorization).toBe('Bearer vs_key_secret')
    expect(sent.headers['idempotency-key']).toBe('contentful:space1:entry1:k')
    expect(JSON.parse(sent.body!)).toEqual({ name: 'Episode 1', settings: { spokenLanguage: 'en' }, url: 'https://assets.ctfassets.net/a/b/c/ep.mp3' })
    expect(f.value()).toMatchObject({ error: null, recordingId: 'rec_1', status: 'processing', transcript: 'Old.', transcriptionId: 'tx_1' })
  })

  it('refuses addresses that are not Contentful assets', async () => {
    const f = mockEntryField()
    const { backend, vs } = mockSDK(install)
    await expect(startTranscription(backend, f.target, { idempotencyKey: 'k', name: 'x', url: 'https://example.com/a.mp3' })).rejects.toThrow(/ctfassets\.net/)
    expect(vs.calls).toHaveLength(0)
    expect(f.setValue).not.toHaveBeenCalled()
  })

  it('asks to connect when no key is saved', async () => {
    const { backend } = mockSDK({})
    const err = await backend.transcribe({ idempotencyKey: 'k', name: 'x', url: 'https://assets.ctfassets.net/x.mp3' }).catch((e) => e)
    expect(describeError(err).message).toBe('Connect VocalStack in the app configuration first.')
  })
})

describe('checkJob', () => {
  it('reports progress and the sentences so far without writing while the job runs', async () => {
    const f = mockEntryField(processing)
    const { backend, vs } = mockSDK(install)
    vs.state.job = job({ progress: { pct: 40, processedS: 60, totalS: 150 }, state: 'transcribing' })
    const out = await checkJob(backend, f.target, 'rec_1')
    expect(out).toMatchObject({ kind: 'processing', progress: { audio: { processedS: 60, totalS: 150 }, phase: 'transcribing', progress: 40 } })
    if (out.kind === 'processing') expect(out.progress.partial?.map((s) => s.text)).toEqual(['Hello there.', 'Hi.'])
    expect(f.setValue).not.toHaveBeenCalled()
  })

  it('saves the transcript, sentences in seconds and the language when done', async () => {
    const f = mockEntryField(processing)
    const { backend, vs } = mockSDK(install)
    vs.state.job = job({ state: 'done' })
    expect((await checkJob(backend, f.target, 'rec_1')).kind).toBe('done')
    const v = f.value()!
    expect(v.status).toBe('done')
    expect(v.transcript).toBe('Hello there.\n\nHi.')
    expect(v.sentences).toEqual([
      { end: 2, speaker: 0, start: 0.5, text: 'Hello there.' },
      { end: 6, speaker: 1, start: 4, text: 'Hi.' },
    ])
    expect(v.language).toBe('en')
    expect(v.recordingId).toBe('rec_1')
    expect(Date.parse(v.transcribedAt!)).not.toBeNaN()
  })

  it('saves the reason when the job failed', async () => {
    const f = mockEntryField(processing)
    const { backend, vs } = mockSDK(install)
    vs.state.job = job({ error: 'Could not fetch the file.', state: 'failed' })
    await checkJob(backend, f.target, 'rec_1')
    expect(f.value()).toMatchObject({ error: 'Could not fetch the file.', status: 'failed', transcript: 'Old.' })
  })

  it('goes back to the earlier transcript when the job was stopped elsewhere', async () => {
    // VocalStack answers `stopped` (as the API does today); `failed` + `stopped` is the older shape.
    for (const stopped of [job({ errorCode: 'stopped', state: 'stopped' }), job({ errorCode: 'stopped', state: 'failed' })]) {
      const f = mockEntryField(processing)
      const { backend, vs } = mockSDK(install)
      vs.state.job = stopped
      expect((await checkJob(backend, f.target, 'rec_1')).kind).toBe('stopped')
      expect(f.value()).toMatchObject({ status: 'done', transcript: 'Old.' })
    }
  })

  it('leaves the field alone when it moved on to another job', async () => {
    const f = mockEntryField({ ...processing, recordingId: 'rec_2' })
    const { backend, vs } = mockSDK(install)
    vs.state.job = job({ state: 'done' })
    expect((await checkJob(backend, f.target, 'rec_1')).kind).toBe('superseded')
    expect(f.setValue).not.toHaveBeenCalled()
  })
})

describe('stopTranscription', () => {
  it('stops the job and restores idle when there was no transcript before', async () => {
    const f = mockEntryField({ recordingId: 'rec_1', status: 'processing', transcriptionId: 'tx_1' })
    const { backend, vs } = mockSDK(install)
    expect((await stopTranscription(backend, f.target)).kind).toBe('stopped')
    expect(vs.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/recordings/rec_1/stop'])
    expect(JSON.parse(vs.calls[0].body!)).toEqual({ reason: 'Stopped from Contentful' })
    expect(f.value()?.status).toBe('idle')
  })

  it('takes the outcome when the job ended before the stop (409)', async () => {
    const f = mockEntryField({ recordingId: 'rec_1', status: 'processing', transcriptionId: 'tx_1' })
    const { backend, vs } = mockSDK(install)
    Object.assign(vs.state, { job: job({ state: 'done' }), stopStatus: 409 })
    expect((await stopTranscription(backend, f.target)).kind).toBe('done')
    expect(f.value()?.transcript).toBe('Hello there.\n\nHi.')
  })
})

describe('the App Function', () => {
  it('redeems a one-click code server-side, with no Origin', async () => {
    const { backend, vs } = mockSDK({})
    expect(await backend.connect({ code: 'c', codeVerifier: 'v'.repeat(43), redirectUri: 'https://x.ctfcloud.net/?vocalstack-connect=1' })).toEqual({ account: 'Acme', apiKey: 'vs_key_new' })
    expect(vs.calls[0].path).toBe('/v1/connect/token')
    expect(Object.keys(vs.calls[0].headers).map((h) => h.toLowerCase())).not.toContain('origin')
    expect(new URLSearchParams(vs.calls[0].body).get('code_verifier')).toBe('v'.repeat(43))
  })

  it('checks the saved key', async () => {
    expect(await mockSDK(install).backend.check()).toEqual({ account: 'Acme', connected: true })
  })
})

describe('describeError', () => {
  it('asks to reconnect on 401 and retries failed calls', () => {
    expect(describeError(new VocalStackAPIError(401, 'invalid_token', 'no'))).toMatchObject({ retryable: false })
    expect(describeError(new VocalStackAPIError(401, 'invalid_token', 'no')).message).toMatch(/Reconnect VocalStack/)
    expect(describeError(new ActionCallError('timeout')).retryable).toBe(true)
    expect(describeError(new VocalStackAPIError(503, 'unavailable', 'later')).retryable).toBe(true)
  })
})
