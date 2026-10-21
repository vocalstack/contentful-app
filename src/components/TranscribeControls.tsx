import { Button, Flex, Note, Stack, Text } from '@contentful/f36-components'
import tokens from '@contentful/f36-tokens'

import type { useTranscription } from './useTranscription.js'

import { BRAND, Logo } from './Brand.js'

/** 2433.0 → "40:33", 4000 → "1:06:40". */
export const clock = (s: number) => {
  const t = Math.floor(s)
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`
}

const PHASES: Record<string, string> = {
  extracting: 'Extracting audio',
  fetching: 'Fetching the file',
  queued: 'Queued',
  transcribing: 'Transcribing',
}

type Props = {
  onOpenConfig: () => void
  state: ReturnType<typeof useTranscription>
}

/** Transcribe, the job's progress and Stop, as the field editor and the sidebar show them. */
export const TranscribeControls: React.FC<Props> = ({ onOpenConfig, state }) => {
  const { busy, connected, disabled, error, progress, starting, stop, stopping, transcribe, value } = state
  const done = value?.status === 'done'

  return (
    <Stack alignItems="stretch" flexDirection="column" spacing="spacingS">
      <Logo height={14} />
      {!connected ? (
        <Flex>
          <Button onClick={onOpenConfig} size="small" variant="secondary">
            Connect VocalStack
          </Button>
        </Flex>
      ) : (
        <Flex>
          <Button isDisabled={busy || disabled} isLoading={starting} onClick={() => void transcribe()} size="small" variant="primary">
            {busy ? 'Transcribing…' : done ? 'Transcribe again' : 'Transcribe'}
          </Button>
        </Flex>
      )}

      {busy && !starting && (
        <Stack alignItems="stretch" flexDirection="column" spacing="spacing2Xs">
          <Text fontColor="gray600" fontSize="fontSizeS">
            {PHASES[progress.phase ?? 'queued'] ?? progress.phase}
            {progress.progress ? ` · ${progress.progress}%` : '…'}
            {progress.audio?.totalS ? ` · ${clock(progress.audio.processedS)} of ${clock(progress.audio.totalS)}` : ''}
          </Text>
          <div style={{ background: tokens.gray200, borderRadius: 2, height: 4, overflow: 'hidden' }}>
            <div style={{ background: BRAND.blue, height: '100%', transition: 'width .4s', width: `${progress.progress ?? 2}%` }} />
          </div>
          <Flex marginTop="spacing2Xs">
            <Button isDisabled={disabled} isLoading={stopping} onClick={() => void stop()} size="small" variant="secondary">
              {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          </Flex>
        </Stack>
      )}
      {!busy && done && !error && (
        <Text fontColor="gray600" fontSize="fontSizeS">
          Transcribed{value?.language ? ` (${value.language})` : ''}.
        </Text>
      )}
      {error && <Note variant="negative">{error}</Note>}
    </Stack>
  )
}
