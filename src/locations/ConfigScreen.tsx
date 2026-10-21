import type { ConfigAppSDK, ContentType } from '@contentful/app-sdk'

import {
  Accordion,
  Box,
  Button,
  Checkbox,
  Flex,
  Form,
  FormControl,
  Heading,
  Note,
  Paragraph,
  Select,
  Stack,
  Text,
  TextInput,
  TextLink,
} from '@contentful/f36-components'
import tokens from '@contentful/f36-tokens'
import { useSDK } from '@contentful/react-apps-toolkit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AppInstallationParameters, ContentTypeSetting } from '../types.js'

import { DEFAULT_API_URL, DEFAULT_DASHBOARD_URL } from '../api.js'
import { type FieldDef, isMediaField, isObjectField } from '../audio.js'
import { appActionBackend } from '../backend.js'
import { Logo } from '../components/Brand.js'
import { type ConnectResult, type PendingConnect, beginConnect, callbackURL, CONNECT_MESSAGE, finishConnect, readCallback } from '../connect.js'
import { buildTargetState, defaultTranscriptField } from '../config.js'

const KEYS_URL = 'https://app.vocalstack.com/developers/keys'

type Choice = ContentTypeSetting & { enabled: boolean }

const ConfigScreen = () => {
  const sdk = useSDK<ConfigAppSDK<AppInstallationParameters>>()
  const [params, setParams] = useState<AppInstallationParameters>({})
  const [contentTypes, setContentTypes] = useState<ContentType[]>()
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [spaceName, setSpaceName] = useState<string>()
  const [keyInput, setKeyInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<PendingConnect>()
  const [pasted, setPasted] = useState('')
  const [installed, setInstalled] = useState(false)
  const [status, setStatus] = useState<string>()

  const backend = useMemo(() => appActionBackend(sdk), [sdk])
  // The saved key is a Secret parameter: redacted here, so `connected` says whether there is one.
  const connected = Boolean(params.apiKey || params.connected)
  const dashboardURL = params.dashboardURL || DEFAULT_DASHBOARD_URL

  useEffect(() => {
    void (async () => {
      const [saved, types, space, isInstalled] = await Promise.all([
        sdk.app.getParameters<AppInstallationParameters>(),
        sdk.cma.contentType.getMany({ query: { limit: 1000 } }).then((r) => r.items as ContentType[]),
        sdk.cma.space.get({ spaceId: sdk.ids.space }).catch(() => undefined),
        sdk.app.isInstalled(),
      ])
      setParams(saved ?? {})
      setInstalled(isInstalled)
      setContentTypes(types)
      setSpaceName(space?.name)
      const initial: Record<string, Choice> = {}
      for (const ct of types) {
        const configured = saved?.contentTypes?.[ct.sys.id]
        const transcriptField = configured?.transcriptField ?? defaultTranscriptField(ct.fields as FieldDef[])
        if (transcriptField) initial[ct.sys.id] = { audioField: configured?.audioField, enabled: Boolean(configured), transcriptField }
      }
      setChoices(initial)
      await sdk.app.setReady()
    })()
  }, [sdk])

  const onConfigure = useCallback(async () => {
    const selected: Record<string, ContentTypeSetting> = {}
    for (const [id, c] of Object.entries(choices)) {
      if (c.enabled && c.transcriptField) selected[id] = c.audioField ? { audioField: c.audioField, transcriptField: c.transcriptField } : { transcriptField: c.transcriptField }
    }
    // An unchanged key goes back as Contentful redacted it; a new one replaces it.
    const parameters: AppInstallationParameters = {
      ...params,
      connected,
      apiURL: params.apiURL?.trim() || undefined,
      contentTypes: selected,
      dashboardURL: params.dashboardURL?.trim() || undefined,
      spokenLanguage: params.spokenLanguage?.trim() || undefined,
    }
    return { parameters, targetState: buildTargetState(selected) }
  }, [choices, connected, params])

  useEffect(() => {
    sdk.app.onConfigure(() => onConfigure())
  }, [sdk, onConfigure])

  /** Ask the App Function whether the saved key works. Only after a save: it reads the stored key. */
  const check = useCallback(async () => {
    setChecking(true)
    setError(undefined)
    try {
      const res = await backend.check()
      setStatus(res.account ? `Connected to VocalStack as ${res.account}.` : 'Connected to VocalStack.')
      if (res.account) setParams((p) => ({ ...p, account: res.account }))
    } catch (err) {
      setStatus(undefined)
      setError(`VocalStack did not accept the saved key: ${(err as Error).message}`)
    } finally {
      setChecking(false)
    }
  }, [backend])

  useEffect(() => {
    sdk.app.onConfigurationCompleted((err) => {
      if (err) return
      setInstalled(true)
      void check()
    })
  }, [check, sdk])

  const applyKey = (apiKey: string, account: string | undefined) => {
    setParams((p) => ({ ...p, account, apiKey, connected: true }))
    setKeyInput('')
    setStatus(undefined)
    sdk.notifier.success(`${account ? `Connected as ${account}. ` : ''}Save the configuration to keep the key.`)
  }

  const useTypedKey = () => {
    const apiKey = keyInput.trim()
    setError(undefined)
    if (!apiKey.startsWith('vs_key_')) return setError('A VocalStack API key starts with vs_key_.')
    // Checked by the App Function once saved: the browser never calls VocalStack with it.
    applyKey(apiKey, undefined)
  }

  // The callback tab hands back the dashboard's answer; redeem it and tell the tab how it went.
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const redeem = useCallback(
    async (result: ConnectResult): Promise<{ message: string; ok: boolean }> => {
      const p = pendingRef.current
      if (!p) return { message: 'This connect link has expired. Start again from the app configuration.', ok: false }
      try {
        const { account, apiKey } = await finishConnect(p, result, backend)
        setPending(undefined)
        applyKey(apiKey, account)
        return { message: account ? `Connected to VocalStack as ${account}. Save the app configuration in Contentful to keep it.` : 'Connected to VocalStack.', ok: true }
      } catch (err) {
        setPending(undefined)
        setError((err as Error).message)
        return { message: (err as Error).message, ok: false }
      }
    },
    [backend],
  )
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== CONNECT_MESSAGE) return
      void redeem(e.data as ConnectResult).then((outcome) => (e.source as null | Window)?.postMessage({ type: `${CONNECT_MESSAGE}:done`, ...outcome }, e.origin))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [redeem])

  const connect = async () => {
    setError(undefined)
    // Open the tab inside the click, before any await, or the popup blocker eats it.
    const tab = window.open('about:blank', '_blank')
    try {
      const p = await beginConnect({ clientName: `${spaceName ?? sdk.ids.space} (Contentful)`, dashboardURL, redirectURI: callbackURL(window.location) })
      setPending(p)
      if (tab) tab.location.href = p.url
      else setError('Allow pop-ups for Contentful, then click Connect VocalStack again.')
    } catch (err) {
      tab?.close()
      setError((err as Error).message)
    }
  }

  const redeemPasted = async () => {
    try {
      await redeem(readCallback(new URL(pasted.trim()).search))
      setPasted('')
    } catch {
      setError('Paste the whole address of the VocalStack tab.')
    }
  }

  const setChoice = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } as Choice }))
  const usable = (contentTypes ?? []).filter((ct) => choices[ct.sys.id])
  const without = (contentTypes ?? []).filter((ct) => !choices[ct.sys.id])

  return (
    <Flex justifyContent="center" padding="spacingXl" style={{ background: tokens.gray100, minHeight: '100vh' }}>
      <Box style={{ background: tokens.colorWhite, borderRadius: tokens.borderRadiusMedium, maxWidth: 760, padding: tokens.spacingXl, width: '100%' }}>
        <Form>
          <Stack alignItems="stretch" flexDirection="column" spacing="spacingL">
            <Logo height={28} />
            <Paragraph>
              Transcribe the audio in your entries. The transcript is saved in a JSON Object field as text plus timed sentences, so the Content Delivery API and GraphQL return it
              with the entry. Billed per second, with a 5-minute minimum per transcription.
            </Paragraph>

            <section>
              <Heading as="h2">Connection</Heading>
              {connected ? (
                <Stack alignItems="flex-start" flexDirection="column" spacing="spacingS">
                  <Paragraph marginBottom="none">{status ?? `Connected to VocalStack${params.account ? ` as ${params.account}` : ''}.`}</Paragraph>
                  <Flex gap="spacingXs">
                    {installed && (
                      <Button isLoading={checking} onClick={() => void check()} size="small" variant="secondary">
                        Check connection
                      </Button>
                    )}
                    <Button onClick={() => setParams((p) => ({ ...p, account: undefined, apiKey: undefined, connected: false }))} size="small" variant="secondary">
                      Disconnect
                    </Button>
                  </Flex>
                  <Text fontColor="gray600" fontSize="fontSizeS">
                    Disconnecting removes the key from this space when you save. Revoke it under Developers → API keys in VocalStack too.
                  </Text>
                </Stack>
              ) : (
                <Stack alignItems="stretch" flexDirection="column" spacing="spacingM">
                  <Paragraph marginBottom="none">Connect a VocalStack account to transcribe audio. Transcriptions use that account's credit.</Paragraph>
                  <div>
                    <Button isDisabled={!installed} isLoading={Boolean(pending)} onClick={() => void connect()} variant="primary">
                      {pending ? 'Waiting for VocalStack…' : 'Connect VocalStack'}
                    </Button>
                    <Text as="p" fontColor="gray600" fontSize="fontSizeS" marginTop="spacingXs">
                      {installed
                        ? 'Opens VocalStack in a new tab; click Authenticate there.'
                        : 'Install the app first (the key is redeemed by its App Function), then connect here. Or paste a key below.'}
                    </Text>
                  </div>
                  {pending && (
                    <FormControl marginBottom="none">
                      <FormControl.Label>The tab did not come back? Paste its address</FormControl.Label>
                      <Flex gap="spacingXs">
                        <TextInput onChange={(e) => setPasted(e.target.value)} placeholder="https://…?vocalstack-connect=1&code=…" value={pasted} />
                        <Button isDisabled={!pasted.trim()} onClick={() => void redeemPasted()} variant="secondary">
                          Use
                        </Button>
                      </Flex>
                    </FormControl>
                  )}
                  <FormControl marginBottom="none">
                    <FormControl.Label>Or paste an API key</FormControl.Label>
                    <Flex gap="spacingXs">
                      <TextInput
                        onChange={(e) => setKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && keyInput.trim()) {
                            e.preventDefault()
                            useTypedKey()
                          }
                        }}
                        placeholder="vs_key_…"
                        type="password"
                        value={keyInput}
                      />
                      <Button isDisabled={!keyInput.trim()} onClick={useTypedKey} variant="secondary">
                        Use key
                      </Button>
                    </Flex>
                    <FormControl.HelpText>
                      Create one with Read and Write permissions under{' '}
                      <TextLink href={KEYS_URL} rel="noreferrer" target="_blank">
                        Developers → API keys
                      </TextLink>
                      , just for this space.
                    </FormControl.HelpText>
                  </FormControl>
                </Stack>
              )}
              {error && (
                <Note style={{ marginTop: tokens.spacingS }} variant="negative">
                  {error}
                </Note>
              )}
              <Note style={{ marginTop: tokens.spacingM }} variant="neutral">
                The key is saved as a Secret installation parameter: Contentful hands it only to the app's Function, which makes every VocalStack call. This screen and the
                entry editor never read it back. Revoke it under Developers → API keys in VocalStack if you uninstall the app.
              </Note>
            </section>

            <section>
              <Heading as="h2">Spoken language</Heading>
              <FormControl marginBottom="none">
                <TextInput maxLength={8} onChange={(e) => setParams((p) => ({ ...p, spokenLanguage: e.target.value }))} placeholder="Auto-detect" value={params.spokenLanguage ?? ''} />
                <FormControl.HelpText>A Whisper language code (en, ro, …). Leave empty to auto-detect.</FormControl.HelpText>
              </FormControl>
            </section>

            <section>
              <Heading as="h2">Content types</Heading>
              <Paragraph>
                Each one gets a Transcribe button in the entry sidebar, and its Transcript field (a JSON Object field) shows the transcript. The audio comes from the Audio field:
                by default, the first Media field linking an audio file.
              </Paragraph>
              {!contentTypes ? (
                <Text fontColor="gray600">Loading content types…</Text>
              ) : (
                <Stack alignItems="stretch" flexDirection="column" spacing="spacingS">
                  {usable.map((ct) => {
                    const c = choices[ct.sys.id]
                    const fields = ct.fields as FieldDef[]
                    return (
                      <Box key={ct.sys.id} padding="spacingS" style={{ border: `1px solid ${tokens.gray300}`, borderRadius: tokens.borderRadiusMedium }}>
                        <Checkbox isChecked={c.enabled} onChange={(e) => setChoice(ct.sys.id, { enabled: e.target.checked })}>
                          {ct.name}
                        </Checkbox>
                        {c.enabled && (
                          <Flex gap="spacingM" marginTop="spacingS">
                            <FormControl marginBottom="none" style={{ flex: 1 }}>
                              <FormControl.Label>Transcript field</FormControl.Label>
                              <Select onChange={(e) => setChoice(ct.sys.id, { transcriptField: e.target.value })} value={c.transcriptField}>
                                {fields.filter(isObjectField).map((f) => (
                                  <Select.Option key={f.id} value={f.id}>
                                    {f.name}
                                  </Select.Option>
                                ))}
                              </Select>
                            </FormControl>
                            <FormControl marginBottom="none" style={{ flex: 1 }}>
                              <FormControl.Label>Audio field</FormControl.Label>
                              <Select onChange={(e) => setChoice(ct.sys.id, { audioField: e.target.value || undefined })} value={c.audioField ?? ''}>
                                <Select.Option value="">First Media field with audio</Select.Option>
                                {fields.filter(isMediaField).map((f) => (
                                  <Select.Option key={f.id} value={f.id}>
                                    {f.name}
                                  </Select.Option>
                                ))}
                              </Select>
                            </FormControl>
                          </Flex>
                        )}
                      </Box>
                    )
                  })}
                  {!usable.length && <Note variant="warning">No content type has a JSON Object field yet. Add one named Transcript, then come back here.</Note>}
                  {without.length > 0 && (
                    <Text fontColor="gray600" fontSize="fontSizeS">
                      Without a JSON Object field: {without.map((ct) => ct.name).join(', ')}. Add a field named Transcript to transcribe them.
                    </Text>
                  )}
                </Stack>
              )}
            </section>

            <Accordion>
              <Accordion.Item title="Advanced">
                <Stack alignItems="stretch" flexDirection="column" spacing="spacingS">
                  <FormControl marginBottom="none">
                    <FormControl.Label>API URL</FormControl.Label>
                    <TextInput onChange={(e) => setParams((p) => ({ ...p, apiURL: e.target.value }))} placeholder={DEFAULT_API_URL} value={params.apiURL ?? ''} />
                  </FormControl>
                  <FormControl marginBottom="none">
                    <FormControl.Label>Dashboard URL</FormControl.Label>
                    <TextInput onChange={(e) => setParams((p) => ({ ...p, dashboardURL: e.target.value }))} placeholder={DEFAULT_DASHBOARD_URL} value={params.dashboardURL ?? ''} />
                  </FormControl>
                </Stack>
              </Accordion.Item>
            </Accordion>
          </Stack>
        </Form>
      </Box>
    </Flex>
  )
}

export default ConfigScreen
