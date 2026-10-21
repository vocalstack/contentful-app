import type { JobProgress, SavedSentence, TranscriptSentence, VocalStackFieldData } from './types.js'

import { type Transcript, VocalStackAPI, VocalStackAPIError } from './api.js'
import { transcriptText } from './text.js'

/** The Transcript field, in one locale: what the Field and Sidebar locations read and write. */
export type FieldTarget = {
  get: () => undefined | VocalStackFieldData
  set: (value: VocalStackFieldData) => Promise<unknown>
}

export type Outcome =
  | { data: VocalStackFieldData; kind: 'done' | 'failed' | 'stopped' }
  /** The field moved on meanwhile (another tab finished or stopped this job, or a new one started). */
  | { data: undefined | VocalStackFieldData; kind: 'superseded' }
  | { kind: 'processing'; progress: JobProgress }

const round = (n: number) => Math.round(n * 100) / 100

/** A transcript's sentences, without the suppressed ones. */
export function toSentences(t: Pick<Transcript, 'sentences'>): TranscriptSentence[] {
  return t.sentences
    .filter((s) => !s.suppressed && s.text.trim())
    .map(({ end, sentenceId, speaker, start, text }) => ({ id: sentenceId, end, speaker, start, text: text.trim() }))
}

/** As saved in the field: `{ start, end, speaker, text }` in seconds. */
export const toSaved = (sentences: TranscriptSentence[]): SavedSentence[] =>
  sentences.map(({ end, speaker, start, text }) => ({ start: round(start), end: round(end), speaker, text }))

/** A job has started. The earlier transcript stays until this one is done. */
export const startedState = (prev: undefined | VocalStackFieldData, ids: { recordingId: string; transcriptionId: string }): VocalStackFieldData => ({
  ...prev,
  error: null,
  recordingId: ids.recordingId,
  status: 'processing',
  transcriptionId: ids.transcriptionId,
})

export function doneState(prev: undefined | VocalStackFieldData, transcript: Transcript, now = new Date()): VocalStackFieldData {
  const sentences = toSentences(transcript)
  return {
    ...prev,
    error: null,
    language: transcript.lang ?? transcript.sentences.find((s) => s.language)?.language ?? null,
    sentences: toSaved(sentences),
    status: 'done',
    transcribedAt: now.toISOString(),
    transcript: transcriptText(sentences),
  }
}

export const failedState = (prev: undefined | VocalStackFieldData, error: string): VocalStackFieldData => ({ ...prev, error, status: 'failed' })

/**
 * A stopped job leaves the field as it was before Transcribe: the earlier transcript, if
 * there was one, or none. The job's partial transcript stays in VocalStack.
 */
export const stoppedState = (prev: undefined | VocalStackFieldData): VocalStackFieldData => ({ ...prev, error: null, status: prev?.transcript ? 'done' : 'idle' })

/** Whether the field still waits on this job. */
const waitsOn = (data: undefined | VocalStackFieldData, recordingId: string) => data?.status === 'processing' && data.recordingId === recordingId

/** Write `next(current)`, unless the field has moved on from this job. */
async function settle(target: FieldTarget, recordingId: string, kind: 'done' | 'failed' | 'stopped', next: (prev: undefined | VocalStackFieldData) => VocalStackFieldData): Promise<Outcome> {
  const current = target.get()
  if (!waitsOn(current, recordingId)) return { data: current, kind: 'superseded' }
  const data = next(current)
  await target.set(data)
  return { data, kind }
}

/** Start transcribing the audio at `url`, and mark the field as processing. */
export async function startTranscription(
  api: VocalStackAPI,
  target: FieldTarget,
  call: { idempotencyKey: string; name: string; spokenLanguage?: string; url: string },
): Promise<VocalStackFieldData> {
  const tx = await api.transcribeURL(call.url, { idempotencyKey: call.idempotencyKey, name: call.name, spokenLanguage: call.spokenLanguage })
  if (!tx.job) throw new Error('VocalStack did not start a job for this file.')
  const data = startedState(target.get(), { recordingId: tx.job.recordingId, transcriptionId: tx.id })
  await target.set(data)
  return data
}

/**
 * Where a job stands, saving the outcome in the field once it is over: the whole
 * transcript when done, the reason when it failed.
 */
export async function checkJob(api: VocalStackAPI, target: FieldTarget, recordingId: string): Promise<Outcome> {
  const job = await api.job(recordingId)
  if (job.state === 'failed' && job.errorCode === 'stopped') return settle(target, recordingId, 'stopped', stoppedState)
  if (job.state === 'failed' || job.state === 'cropping') {
    const error = job.state === 'cropping' ? 'VocalStack is waiting for a crop window; open the transcription in VocalStack.' : (job.error ?? 'The transcription failed.')
    return settle(target, recordingId, 'failed', (prev) => failedState(prev, error))
  }
  if (job.state !== 'done') {
    const progress = job.state === 'fetching' ? (job.progress.phasePct ?? 0) : job.progress.pct
    if (job.state !== 'transcribing') return { kind: 'processing', progress: { phase: job.progress.phase ?? job.state, progress } }
    // Sentences are readable while the job runs; show what is there so far.
    const partial = await api.transcript(recordingId).then(toSentences, () => undefined)
    return {
      kind: 'processing',
      progress: { audio: { processedS: job.progress.processedS ?? 0, totalS: job.progress.totalS ?? undefined }, partial, phase: 'transcribing', progress },
    }
  }
  if (!waitsOn(target.get(), recordingId)) return { data: target.get(), kind: 'superseded' }
  const transcript = await api.transcript(recordingId)
  return settle(target, recordingId, 'done', (prev) => doneState(prev, transcript))
}

/** Stop the job. The field goes back to how it was; VocalStack keeps what it heard so far. */
export async function stopTranscription(api: VocalStackAPI, target: FieldTarget, reason = 'Stopped from Contentful'): Promise<Outcome> {
  const current = target.get()
  const recordingId = current?.recordingId
  if (current?.status !== 'processing' || !recordingId) return { data: current, kind: 'superseded' }
  try {
    await api.stop(recordingId, reason)
  } catch (err) {
    // Too late to stop: the job ended meanwhile, so take its outcome instead.
    if (err instanceof VocalStackAPIError && err.status === 409) return checkJob(api, target, recordingId)
    throw err
  }
  return settle(target, recordingId, 'stopped', stoppedState)
}

/** A message for the editor, and whether trying again later could help. */
export function describeError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof VocalStackAPIError) {
    if (err.status === 401) return { message: 'The VocalStack API key was refused. Reconnect VocalStack in the app configuration.', retryable: false }
    if (err.status === 429 || err.status >= 500) return { message: err.message, retryable: true }
    return { message: err.message, retryable: false }
  }
  // fetch() throws a TypeError when the network (or CORS) fails.
  if (err instanceof TypeError) return { message: 'Could not reach VocalStack. Check the connection and try again.', retryable: true }
  return { message: err instanceof Error ? err.message : String(err), retryable: false }
}
