/** Where the app looks for a content type's audio and writes its transcript. */
export type ContentTypeSetting = {
  /** The JSON Object field that holds the transcript (the field editor is this app). */
  transcriptField: string
  /** The Media field with the audio. Left out: the first Media field linking an `audio/*` asset. */
  audioField?: string
}

/** Installation parameters, set on the app configuration screen. */
export type AppInstallationParameters = {
  /**
   * A VocalStack API key (`vs_key_…`, Read + Write). Defined as a Secret parameter on
   * the app definition: Contentful hands its raw value to the App Function only, and
   * redacts it everywhere else (the App SDK, the CMA with a personal token).
   */
  apiKey?: string
  /** Set when a key was saved, so the editor knows without reading the key. */
  connected?: boolean
  /** The account the key acts for, as VocalStack named it when it was checked. */
  account?: string
  /** A Whisper language code (`en`, `ro`, …). Leave out to auto-detect. */
  spokenLanguage?: string
  /** Content type id → its transcript field and audio field. */
  contentTypes?: Record<string, ContentTypeSetting>
  /** Default https://api.vocalstack.com (the function's allowNetworks must list its host). */
  apiURL?: string
  /** Default https://app.vocalstack.com */
  dashboardURL?: string
}

/** Instance parameters of the Transcript field (Content model → field → Appearance). */
export type AppInstanceParameters = {
  /** The id of the Media field whose asset is transcribed. Wins over the configuration screen's choice. */
  audioField?: string
}

export type TranscriptStatus = 'done' | 'failed' | 'idle' | 'processing'

/** One sentence as saved in the field: seconds, and VocalStack's speaker number. */
export type SavedSentence = {
  end: number
  speaker: number
  start: number
  text: string
}

/** The Transcript field's JSON value, as the Content Delivery API and GraphQL return it. */
export type VocalStackFieldData = {
  error?: null | string
  language?: null | string
  recordingId?: null | string
  sentences?: null | SavedSentence[]
  status?: null | TranscriptStatus
  transcript?: null | string
  transcriptionId?: null | string
  transcribedAt?: null | string
}

/** [start, end, text], seconds. */
export type TranscriptWord = [number, number, string]

/** A sentence as text.ts works with it (shared with the Payload plugin). */
export type TranscriptSentence = {
  /** Live only: words heard after the last settled sentence. */
  draft?: boolean
  end: number
  /** VocalStack's sentenceId. */
  id?: number
  speaker: number
  start: number
  text: string
  words?: TranscriptWord[]
}

/** Where a running job stands, for the Transcribe controls. */
export type JobProgress = {
  /** Seconds of audio transcribed so far, and in all (while transcribing). */
  audio?: { processedS: number; totalS?: number }
  /** The sentences so far, while the job runs. Not saved. */
  partial?: TranscriptSentence[]
  phase?: string
  progress?: number
}
