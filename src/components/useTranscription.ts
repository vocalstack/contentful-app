import type { FieldAppSDK, SidebarAppSDK } from '@contentful/app-sdk'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AppInstallationParameters, JobProgress, VocalStackFieldData } from '../types.js'

import { appActionBackend } from '../backend.js'
import { type FieldDef, type AssetLike, findAudio } from '../audio.js'
import { type FieldTarget, type Outcome, checkJob, describeError, startTranscription, stopTranscription } from '../transcription.js'

const POLL_MS = 3000

type EditorSDK = FieldAppSDK<AppInstallationParameters> | SidebarAppSDK<AppInstallationParameters>

/** A locale the field has: the asked one if it is localized, else the default. */
export const fieldLocale = (sdk: EditorSDK, fieldId: string, locale: string) =>
  sdk.entry.fields[fieldId]?.locales.includes(locale) ? locale : sdk.locales.default

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/**
 * Run `fn` in one place at a time per entry field: the field editor and the sidebar
 * (and other tabs) take turns, so only one of them polls VocalStack and saves.
 */
async function exclusive(name: string, signal: AbortSignal, fn: () => Promise<void>) {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) return fn()
  await locks.request(name, { signal }, fn).catch((err) => {
    if ((err as Error).name !== 'AbortError') throw err
  })
}

/**
 * The Transcribe / progress / Stop state of one Transcript field, for the Field and
 * Sidebar locations alike. Everything that must survive a reload (the job's
 * recordingId and status) is in the field itself.
 */
export function useTranscription(sdk: EditorSDK, args: { audioField?: string; fieldId?: string; locale: string }) {
  const { fieldId } = args
  const params = sdk.parameters.installation ?? {}
  const field = fieldId ? sdk.entry.fields[fieldId] : undefined
  const locale = fieldId ? fieldLocale(sdk, fieldId, args.locale) : args.locale
  // The key itself is a Secret parameter: only the App Function reads it.
  const connected = Boolean(params.connected || params.apiKey)
  const api = useMemo(() => (connected ? appActionBackend(sdk) : undefined), [connected, sdk])

  const [value, setValue] = useState<undefined | VocalStackFieldData>(() => (field?.getValue(locale) as undefined | VocalStackFieldData) ?? undefined)

  // What this editor writes shows at once, whether or not Contentful echoes it back
  // through onValueChanged; other editors (the sidebar, other tabs) hear it from there.
  const target = useMemo<FieldTarget | undefined>(
    () =>
      field && {
        get: () => field.getValue(locale) as undefined | VocalStackFieldData,
        set: async (v) => {
          const out = await field.setValue(v, locale)
          setValue(v)
          return out
        },
      },
    [field, locale],
  )
  const [disabled, setDisabled] = useState(false)
  const [progress, setProgress] = useState<JobProgress>({})
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Polling gave up on something VocalStack refused; a reload (or Transcribe) tries again.
  const [halted, setHalted] = useState(false)

  useEffect(() => {
    if (!field) return
    setValue(field.getValue(locale))
    const offValue = field.onValueChanged(locale, (v) => setValue(v ?? undefined))
    const offDisabled = field.onIsDisabledChanged(locale, setDisabled)
    return () => {
      offValue()
      offDisabled()
    }
  }, [field, locale])

  const channelName = `vocalstack:${sdk.ids.space}:${sdk.ids.environment}:${sdk.ids.entry}:${fieldId}:${locale}`
  const channel = useRef<BroadcastChannel>(undefined)
  useEffect(() => {
    try {
      const ch = new BroadcastChannel(channelName)
      ch.onmessage = (e) => e.data?.type === 'progress' && setProgress(e.data.progress as JobProgress)
      channel.current = ch
      return () => ch.close()
    } catch {
      return undefined
    }
  }, [channelName])

  const notify = useCallback(
    (out: Outcome) => {
      setProgress({})
      if (out.kind === 'done') sdk.notifier.success('Transcript ready.')
      else if (out.kind === 'stopped') sdk.notifier.success('Transcription stopped.')
      else if (out.kind === 'failed') setError(out.data.error ?? undefined)
    },
    [sdk],
  )

  // Follow a running job, also after a reload: every 3 s until it is over.
  const processing = value?.status === 'processing' && Boolean(value.recordingId)
  const recordingId = processing ? value!.recordingId! : undefined
  useEffect(() => {
    if (!recordingId || !api || !target) return
    const ac = new AbortController()
    setHalted(false)
    void exclusive(channelName, ac.signal, async () => {
      let wait = POLL_MS
      while (!ac.signal.aborted) {
        const now = target.get()
        if (now?.status !== 'processing' || now.recordingId !== recordingId) return
        try {
          const out = await checkJob(api, target, recordingId)
          if (ac.signal.aborted) return
          if (out.kind !== 'processing') {
            if (out.kind !== 'superseded') notify(out)
            return
          }
          setProgress(out.progress)
          channel.current?.postMessage({ progress: out.progress, type: 'progress' })
          wait = POLL_MS
        } catch (err) {
          const { message, retryable } = describeError(err)
          if (!retryable) {
            setError(message)
            setHalted(true)
            return
          }
          // A network blip should not end the wait.
          wait = Math.min(wait * 2, 30000)
        }
        await sleep(wait, ac.signal)
      }
    })
    return () => ac.abort()
  }, [api, channelName, notify, recordingId, target])

  const transcribe = useCallback(async () => {
    if (!api || !target || !fieldId) return
    setError(undefined)
    setStarting(true)
    setProgress({})
    try {
      const contentType = sdk.contentType
      const audio = await findAudio({
        audioField: args.audioField,
        defaultLocale: sdk.locales.default,
        fields: contentType.fields as FieldDef[],
        getAsset: (assetId) => sdk.cma.asset.get({ assetId }) as Promise<AssetLike>,
        locale,
        readValue: (id) => sdk.entry.fields[id]?.getValue(fieldLocale(sdk, id, locale)),
      })
      if ('error' in audio) throw new Error(audio.error)
      const display = contentType.displayField ? sdk.entry.fields[contentType.displayField]?.getValue(fieldLocale(sdk, contentType.displayField, locale)) : undefined
      const name = (typeof display === 'string' && display.trim()) || audio.title || audio.fileName
      await startTranscription(api, target, {
        idempotencyKey: `${sdk.ids.entry}:${crypto.randomUUID()}`,
        name: name.slice(0, 200),
        url: audio.url,
      })
    } catch (err) {
      setError(describeError(err).message)
    } finally {
      setStarting(false)
    }
  }, [api, args.audioField, fieldId, locale, sdk, target])

  const stop = useCallback(async () => {
    if (!api || !target) return
    const ok = await sdk.dialogs.openConfirm({
      confirmLabel: 'Stop',
      intent: 'negative',
      message: 'Stop transcribing? What VocalStack has transcribed so far stays in your VocalStack dashboard.',
      title: 'Stop transcribing',
    })
    if (!ok) return
    setStopping(true)
    try {
      const out = await stopTranscription(api, target)
      if (out.kind !== 'superseded') notify(out)
    } catch (err) {
      sdk.notifier.error(describeError(err).message)
    } finally {
      setStopping(false)
    }
  }, [api, notify, sdk, target])

  /** Save the editor's own text. The timings stay; they no longer match the words. */
  const editText = useCallback((transcript: string) => target?.set({ ...target.get(), transcript }), [target])

  const clear = useCallback(async () => {
    await field?.removeValue(locale)
    setValue(undefined)
  }, [field, locale])

  const busy = starting || (processing && !halted)
  return {
    busy,
    clear,
    connected: Boolean(api),
    disabled,
    editText,
    error: error ?? (value?.status === 'failed' ? (value.error ?? undefined) : undefined),
    progress,
    starting,
    stop,
    stopping,
    transcribe,
    value,
  }
}
