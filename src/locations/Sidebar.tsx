import type { SidebarAppSDK } from '@contentful/app-sdk'

import { Note, Text } from '@contentful/f36-components'
import { useAutoResizer, useSDK } from '@contentful/react-apps-toolkit'

import type { AppInstallationParameters } from '../types.js'

import { TranscribeControls } from '../components/TranscribeControls.js'
import { useTranscription } from '../components/useTranscription.js'

/**
 * The entry's Transcript field: the one chosen on the configuration screen, else the
 * first field this app edits.
 */
function transcriptField(sdk: SidebarAppSDK<AppInstallationParameters>) {
  const configured = sdk.parameters.installation?.contentTypes?.[sdk.ids.contentType]
  if (configured?.transcriptField && sdk.entry.fields[configured.transcriptField]) return configured
  const control = sdk.editor.editorInterface.controls?.find((c) => c.widgetNamespace === 'app' && c.widgetId === sdk.ids.app && sdk.entry.fields[c.fieldId])
  return control ? { audioField: (control.settings as { audioField?: string } | undefined)?.audioField || configured?.audioField, transcriptField: control.fieldId } : undefined
}

const Sidebar = () => {
  const sdk = useSDK<SidebarAppSDK<AppInstallationParameters>>()
  useAutoResizer()
  const setting = transcriptField(sdk)
  const state = useTranscription(sdk, { audioField: setting?.audioField, fieldId: setting?.transcriptField, locale: sdk.locales.default })

  if (!setting) {
    return <Note variant="warning">Pick this content type's Transcript field in the VocalStack app configuration.</Note>
  }
  const name = sdk.entry.fields[setting.transcriptField]?.name
  return (
    <>
      <TranscribeControls onOpenConfig={() => void sdk.navigator.openAppConfig()} state={state} />
      {state.value?.status === 'done' && (
        <Text as="p" fontColor="gray600" fontSize="fontSizeS" marginTop="spacingXs">
          The transcript is in {name ?? setting.transcriptField}, in {sdk.locales.names[sdk.locales.default] ?? sdk.locales.default}.
        </Text>
      )}
    </>
  )
}

export default Sidebar
