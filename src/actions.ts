/**
 * The app actions the frontend calls, all served by one App Function
 * (functions/vocalstack.ts), which alone holds the VocalStack API key. Ids and
 * parameters match contentful-app-manifest.json.
 */

import type { Job, Transcript } from './api.js'

export const ACTION_IDS = {
  connect: 'vocalstackConnect',
  status: 'vocalstackStatus',
  stop: 'vocalstackStop',
  transcribe: 'vocalstackTranscribe',
} as const

export type ActionParams =
  | { code: string; codeVerifier: string; op: 'connect'; redirectUri: string }
  /** Without `recordingId`: whether the saved key works, and for which account. */
  | { op: 'status'; recordingId?: string }
  | { op: 'stop'; recordingId: string }
  | { idempotencyKey: string; name: string; op: 'transcribe'; url: string }

/** A transcript's sentences as the function returns them: no segments, no words. */
export type CompactTranscript = Pick<Transcript, 'lang' | 'sentences'>

export type ConnectResult = { account?: string; apiKey: string }
export type CheckResult = { account?: string; connected: boolean }
/** The job, plus its sentences while it transcribes (the latest ones) or once done (all of them). */
export type StatusResult = { job: Job; transcript?: CompactTranscript }
export type StopResult = { ended: boolean }
export type TranscribeResult = { recordingId: string; state: string; transcriptionId: string }

/** Every answer is either the result or what VocalStack refused, so the frontend can tell them apart. */
export type ActionError = { error: { code: string; message: string; status: number } }

/** How many sentences a status answer carries while the job runs: enough for the live view. */
export const LIVE_SENTENCES = 40
