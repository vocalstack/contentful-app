import type { FieldAppSDK } from '@contentful/app-sdk'

import { Box, Button, Flex, Note, Paragraph, Text, Textarea } from '@contentful/f36-components'
import tokens from '@contentful/f36-tokens'
import { useAutoResizer, useSDK } from '@contentful/react-apps-toolkit'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { AppInstallationParameters, AppInstanceParameters, TranscriptSentence } from '../types.js'

import { TranscribeControls } from '../components/TranscribeControls.js'
import { useTranscription } from '../components/useTranscription.js'
import { paragraphs, transcriptText } from '../text.js'

const SAVE_DELAY_MS = 600

const box: React.CSSProperties = {
  background: tokens.colorWhite,
  border: `1px solid ${tokens.gray300}`,
  borderRadius: tokens.borderRadiusMedium,
  lineHeight: 1.75,
  maxHeight: 440,
  overflowY: 'auto',
  padding: `${tokens.spacingS} ${tokens.spacingM}`,
}

const Paragraphs: React.FC<{ live?: boolean; sentences: TranscriptSentence[] }> = ({ live, sentences }) => (
  <div style={box}>
    {paragraphs(sentences).map((p, i) => (
      <Paragraph key={i} marginBottom="spacingS" style={live && i === paragraphs(sentences).length - 1 ? { color: tokens.gray700 } : undefined}>
        {p.map((s) => s.text).join(' ')}
      </Paragraph>
    ))}
  </div>
)

/** The Transcript field: Transcribe, then the text, which an editor can change. */
const Field = () => {
  const sdk = useSDK<FieldAppSDK<AppInstallationParameters, AppInstanceParameters>>()
  useAutoResizer()
  const setting = sdk.parameters.installation?.contentTypes?.[sdk.ids.contentType]
  const audioField = sdk.parameters.instance?.audioField || setting?.audioField
  const state = useTranscription(sdk, { audioField, fieldId: sdk.field.id, locale: sdk.field.locale })
  const { busy, clear, disabled, editText, progress, value } = state

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const sentences = value?.sentences ?? []
  const text = value?.transcript ?? ''
  const generated = useMemo(() => transcriptText(value?.sentences ?? []), [value?.sentences])
  const edited = Boolean(text) && sentences.length > 0 && text !== generated

  if (sdk.field.type !== 'Object') {
    return <Note variant="warning">VocalStack's transcript goes in a JSON Object field. Change this field's appearance, or use a JSON Object field.</Note>
  }

  const startEditing = () => {
    setDraft(text)
    setEditing(true)
  }
  const change = (next: string) => {
    setDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void editText(next), SAVE_DELAY_MS)
  }
  const done = () => {
    clearTimeout(timer.current)
    if (draft !== text) void editText(draft)
    setEditing(false)
  }
  const remove = async () => {
    const ok = await sdk.dialogs.openConfirm({ confirmLabel: 'Delete', intent: 'negative', message: 'Delete this transcript?', title: 'Delete transcript' })
    if (!ok) return
    clearTimeout(timer.current)
    await clear()
    setEditing(false)
  }

  const hint = busy
    ? 'Live from VocalStack.'
    : editing
      ? 'Editing. Transcribing again replaces your changes.'
      : edited
        ? 'Edited by hand, so the sentence timings no longer match the text.'
        : null

  return (
    <Box paddingBottom="spacingS">
      <TranscribeControls onOpenConfig={() => void sdk.navigator.openAppConfig()} state={state} />
      <Flex alignItems="center" justifyContent="space-between" marginBottom="spacingXs" marginTop="spacingM" style={{ minHeight: 28 }}>
        <Text fontColor="gray600" fontSize="fontSizeS">
          {hint}
        </Text>
        {!busy && !disabled && (
          <Flex gap="spacingXs">
            {editing && (text || sentences.length > 0) && (
              <Button onClick={() => void remove()} size="small" variant="negative">
                Delete transcript
              </Button>
            )}
            <Button onClick={editing ? done : startEditing} size="small" variant="secondary">
              {editing ? 'Done' : text ? 'Edit' : 'Write transcript'}
            </Button>
          </Flex>
        )}
      </Flex>
      {editing ? (
        <Textarea onChange={(e) => change(e.target.value)} rows={14} value={draft} />
      ) : busy ? (
        // Not the previous transcript: that one is only replaced once this job is done.
        progress.partial?.length ? (
          <Paragraphs live sentences={progress.partial} />
        ) : (
          <Text fontColor="gray600">The transcript appears here as VocalStack hears it.</Text>
        )
      ) : text ? (
        <div style={box}>
          {text.split(/\n{2,}/).map((p, i) => (
            <Paragraph key={i} marginBottom="spacingS">
              {p}
            </Paragraph>
          ))}
        </div>
      ) : (
        <Text fontColor="gray600">No transcript yet. Transcribe the audio, or write one yourself.</Text>
      )}
    </Box>
  )
}

export default Field
