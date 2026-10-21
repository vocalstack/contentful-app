import { describe, expect, it, vi } from 'vitest'

import type { VocalStackFieldData } from '../src/types.js'

import { type Job, type Transcript, VocalStackAPI, VocalStackAPIError } from '../src/api.js'
import { type FieldTarget, checkJob, describeError, startTranscription, stopTranscription } from '../src/transcription.js'

/** An entry field as the App SDK exposes it, per locale, autosaving like Contentful does. */
function mockEntryField(initial?: VocalStackFieldData) {
  const values: Record<string, unknown> = { 'en-US': initial }
  const setValue = vi.fn(async (v: unknown, locale = 'en-US') => {
    values[locale] = JSON.parse(JSON.stringify(v))
    return values[locale] as never
  })
  const field = { getValue: (locale = 'en-US') => values[locale], setValue }
  const target: FieldTarget = { get: () => field.getValue('en-US') as VocalStackFieldData | undefined, set: (v) => field.setValue(v, 'en-US') }
  return { setValue, target, value: () => values['en-US'] as VocalStackFieldData | undefined }
}

const job = (patch: Partial<Job>): Job => ({ progress: { pct: 0 }, recordingId: 'rec_1', state: 'queued', transcriptionId: 'tx_1', ...patch })

const transcript: Transcript = {
  lang: 'en',
  segments: [],
  sentences: [
    { end: 2.004, sentenceId: 1, speaker: 0, start: 0.5, text: 'Hello there.' },
    { end: 3, sentenceId: 2, speaker: 0, start: 2.5, suppressed: true, text: 'uh' },
    { end: 6, sentenceId: 3, speaker: 1, start: 4, text: ' Hi. ' },
  ],
}

function mockAPI(over: Partial<Record<'job' | 'stop' | 'transcribeURL' | 'transcript', (...a: never[]) => unknown>>) {
  const api = Object.create(VocalStackAPI.prototype) as VocalStackAPI
  return Object.assign(api, {
    job: vi.fn(async () => job({})),
    stop: vi.fn(async () => ({})),
    transcribeURL: vi.fn(async () => ({ id: 'tx_1', job: job({}), name: 'Episode 1' })),
    transcript: vi.fn(async () => transcript),
    ...over,
  })
}

const previous: VocalStackFieldData = { language: 'en', sentences: [{ end: 1, speaker: 0, start: 0, text: 'Old.' }], status: 'done', transcript: 'Old.' }

describe('startTranscription', () => {
  it('sends the asset URL and saves the job in the field, keeping the earlier transcript', async () => {
    const f = mockEntryField(previous)
    const api = mockAPI({})
    await startTranscription(api, f.target, { idempotencyKey: 'k', name: 'Episode 1', spokenLanguage: 'en', url: 'https://assets.ctfassets.net/a/b/c/ep.mp3' })
    expect(api.transcribeURL).toHaveBeenCalledWith('https://assets.ctfassets.net/a/b/c/ep.mp3', { idempotencyKey: 'k', name: 'Episode 1', spokenLanguage: 'en' })
    expect(f.value()).toMatchObject({ error: null, recordingId: 'rec_1', status: 'processing', transcript: 'Old.', transcriptionId: 'tx_1' })
  })
})

describe('checkJob', () => {
  const processing = { ...previous, recordingId: 'rec_1', status: 'processing' as const, transcriptionId: 'tx_1' }

  it('reports progress without writing while the job runs', async () => {
    const f = mockEntryField(processing)
    const api = mockAPI({ job: async () => job({ progress: { pct: 40, processedS: 60, totalS: 150 }, state: 'transcribing' }) })
    const out = await checkJob(api, f.target, 'rec_1')
    expect(out).toMatchObject({ kind: 'processing', progress: { audio: { processedS: 60, totalS: 150 }, phase: 'transcribing', progress: 40 } })
    if (out.kind === 'processing') expect(out.progress.partial?.map((s) => s.text)).toEqual(['Hello there.', 'Hi.'])
    expect(f.setValue).not.toHaveBeenCalled()
  })

  it('saves the transcript, sentences in seconds and the language when done', async () => {
    const f = mockEntryField(processing)
    const out = await checkJob(mockAPI({ job: async () => job({ state: 'done' }) }), f.target, 'rec_1')
    expect(out.kind).toBe('done')
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
    await checkJob(mockAPI({ job: async () => job({ error: 'Could not fetch the file.', state: 'failed' }) }), f.target, 'rec_1')
    expect(f.value()).toMatchObject({ error: 'Could not fetch the file.', status: 'failed', transcript: 'Old.' })
  })

  it('goes back to the earlier transcript when the job was stopped elsewhere', async () => {
    const f = mockEntryField(processing)
    const out = await checkJob(mockAPI({ job: async () => job({ errorCode: 'stopped', state: 'failed' }) }), f.target, 'rec_1')
    expect(out.kind).toBe('stopped')
    expect(f.value()).toMatchObject({ status: 'done', transcript: 'Old.' })
  })

  it('leaves the field alone when it moved on to another job', async () => {
    const f = mockEntryField({ ...processing, recordingId: 'rec_2' })
    const api = mockAPI({ job: async () => job({ state: 'done' }) })
    expect((await checkJob(api, f.target, 'rec_1')).kind).toBe('superseded')
    expect(api.transcript).not.toHaveBeenCalled()
    expect(f.setValue).not.toHaveBeenCalled()
  })
})

describe('stopTranscription', () => {
  it('stops the job and restores idle when there was no transcript before', async () => {
    const f = mockEntryField({ recordingId: 'rec_1', status: 'processing', transcriptionId: 'tx_1' })
    const api = mockAPI({})
    expect((await stopTranscription(api, f.target)).kind).toBe('stopped')
    expect(api.stop).toHaveBeenCalledWith('rec_1', 'Stopped from Contentful')
    expect(f.value()?.status).toBe('idle')
  })

  it('takes the outcome when the job ended before the stop (409)', async () => {
    const f = mockEntryField({ recordingId: 'rec_1', status: 'processing', transcriptionId: 'tx_1' })
    const api = mockAPI({
      job: async () => job({ state: 'done' }),
      stop: async () => {
        throw new VocalStackAPIError(409, 'conflict', 'The job is over.')
      },
    })
    expect((await stopTranscription(api, f.target)).kind).toBe('done')
    expect(f.value()?.transcript).toBe('Hello there.\n\nHi.')
  })
})

describe('describeError', () => {
  it('asks to reconnect on 401 and retries network failures', () => {
    expect(describeError(new VocalStackAPIError(401, 'invalid_token', 'no'))).toMatchObject({ retryable: false })
    expect(describeError(new VocalStackAPIError(401, 'invalid_token', 'no')).message).toMatch(/Reconnect VocalStack/)
    expect(describeError(new TypeError('Failed to fetch')).retryable).toBe(true)
    expect(describeError(new VocalStackAPIError(503, 'unavailable', 'later')).retryable).toBe(true)
  })
})
