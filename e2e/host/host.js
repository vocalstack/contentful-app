// The Contentful web app's side of the App SDK channel (@contentful/app-sdk 4.x):
//
//   app → host  { id, method: 'init', params: [] }                    on SDK init
//   host → app  { method: 'connect', params: [connectData, queue] }   the location's data
//   app → host  { source, id, method, params }                       calls and sends
//   host → app  { id, result } | { id, error }                       answers to calls
//   host → app  { method, params }                                   events (valueChanged, appHook…)
//
// The CMA client inside the SDK sends every request as `CMAAdapterCall` with
// { entityType, action, params, payload }; app action calls go to the server's
// function runtime. Anything else the app asks lands in #unhandled, which the spec
// asserts is empty.

const view = new URLSearchParams(location.search).get('view') || 'entry'
const LOCALE = 'en-US'
const locales = { available: [LOCALE], default: LOCALE, direction: { [LOCALE]: 'ltr' }, fallbacks: {}, names: { [LOCALE]: 'English (United States)' }, optional: { [LOCALE]: false } }
const user = { email: 'editor@example.com', firstName: 'E2E', lastName: 'Editor', spaceMembership: { admin: true, roles: [] }, sys: { id: 'user-e2e', type: 'User' } }

const state = await (await fetch('/api/state')).json()
const { ids } = state
const frames = new Map() // contentWindow → { data, iframe }
const unhandled = []

const api = async (path, body) => {
  const res = await fetch(path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' })
  const out = await res.json()
  if (!res.ok) throw new Error(out?.message ?? `${path} answered ${res.status}`)
  return out
}

function noteUnhandled(what) {
  unhandled.push(what)
  document.getElementById('unhandled').textContent = `Not faked:\n${unhandled.join('\n')}`
  console.warn('fake Contentful: not faked', what)
}

function toast(type, message) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message })
  el.dataset.type = type
  document.getElementById('toasts').append(el)
  setTimeout(() => el.remove(), 8000)
}

function confirmDialog({ confirmLabel, intent, message, title }) {
  const dialog = document.getElementById('dialog')
  document.getElementById('dialog-title').textContent = title ?? ''
  document.getElementById('dialog-message').textContent = message ?? ''
  const ok = document.getElementById('dialog-confirm')
  ok.textContent = confirmLabel ?? 'Confirm'
  ok.className = intent === 'negative' ? 'negative' : ''
  dialog.classList.add('open')
  return new Promise((resolve) => {
    const close = (answer) => {
      dialog.classList.remove('open')
      ok.onclick = cancel.onclick = null
      resolve(answer)
    }
    const cancel = document.getElementById('dialog-cancel')
    ok.onclick = () => close(true)
    cancel.onclick = () => close(false)
  })
}

const post = (win, msg) => win.postMessage(msg, '*')

// ---- The space, as the CMA answers it (through the SDK's CMA adapter) ----

async function cma({ action, entityType, params, payload }) {
  const key = `${entityType}.${action}`
  switch (key) {
    case 'ContentType.getMany':
      return { items: state.contentTypes, limit: 1000, skip: 0, sys: { type: 'Array' }, total: state.contentTypes.length }
    case 'ContentType.get': {
      const ct = state.contentTypes.find((c) => c.sys.id === params.contentTypeId)
      if (!ct) throw { message: 'The resource could not be found.', status: 404 }
      return ct
    }
    case 'Space.get':
      return { name: 'Podcasts (e2e)', sys: { id: ids.space, type: 'Space' } }
    case 'Asset.get':
      if (params.assetId !== state.asset.sys.id) throw { message: 'The resource could not be found.', status: 404 }
      return state.asset
    case 'AppActionCall.createWithResult':
      return api('/api/action', { appActionId: params.appActionId, appDefinitionId: params.appDefinitionId, parameters: payload?.parameters })
    default:
      noteUnhandled(`CMA ${key}`)
      throw { message: `${key} is not faked`, status: 501 }
  }
}

// ---- The installation, as the app configuration page drives it ----

let configFrame
let hookId = 0
const hookWaiters = new Map()

function runHook(stage, err) {
  const installationRequestId = `req-${++hookId}`
  const win = configFrame.contentWindow
  return new Promise((resolve) => {
    hookWaiters.set(installationRequestId, resolve)
    post(win, { method: 'appHook', params: [{ err, installationRequestId, stage }] })
  })
}

async function saveConfiguration() {
  const button = document.getElementById('install')
  button.disabled = true
  try {
    const result = await runHook('preInstall')
    if (!result || result.result === false) return toast('error', 'The app refused to save.')
    const { parameters, targetState } = result.result
    let err = null
    try {
      await api('/api/configure', { parameters, targetState })
      state.installation = { parameters, targetState }
      toast('success', 'App configuration saved')
      button.textContent = 'Save'
    } catch (e) {
      err = { message: e.message }
      toast('error', e.message)
    }
    await runHook('postInstall', err)
  } finally {
    button.disabled = false
  }
}

// ---- The channel ----

async function handleCall(frame, method, params) {
  switch (method) {
    case 'callAppMethod': {
      const [name] = params
      if (name === 'setReady') return document.body.setAttribute('data-app-ready', 'true') ?? null
      if (name === 'isInstalled') return Boolean(state.installation)
      if (name === 'getParameters') return state.installation?.parameters ?? null
      if (name === 'getCurrentState') return state.installation?.targetState ?? null
      break
    }
    case 'CMAAdapterCall':
      return cma(params[0])
    case 'setValue':
    case 'removeValue': {
      const [fieldId, locale, value] = params
      const v = method === 'removeValue' ? undefined : value
      await api('/api/field', { fieldId, locale, value: v ?? null })
      if (v === undefined) delete state.entry.fields[fieldId]?.[locale]
      else (state.entry.fields[fieldId] ??= {})[locale] = v
      // Every editor of the entry hears the change; the one that made it too, unless
      // E2E_ECHO=0 (the app must not depend on the echo).
      for (const win of frames.keys()) if (state.echo || win !== frame.iframe.contentWindow) post(win, { method: 'valueChanged', params: [fieldId, locale, v] })
      return v
    }
    case 'openDialog': {
      const [type, options] = params
      if (type === 'confirm') return confirmDialog(options)
      break
    }
    case 'navigateToAppConfig':
      location.href = '?view=config'
      return null
    case 'checkAccess':
    case 'checkAppConfigAccess':
      return true
  }
  noteUnhandled(`${method}(${JSON.stringify(params).slice(0, 120)})`)
  throw { message: `${method} is not faked` }
}

function handleSend(frame, method, params) {
  switch (method) {
    case 'setHeight':
      frame.iframe.style.height = `${Math.max(0, Number(params[0]) || 0)}px`
      return
    case 'notify':
      return toast(params[0].type, params[0].message)
    case 'setActive':
      return
    case 'appHookResult': {
      const resolve = hookWaiters.get(params[0].installationRequestId)
      hookWaiters.delete(params[0].installationRequestId)
      return resolve?.(params[0])
    }
  }
  noteUnhandled(`send ${method}`)
}

// The SDK's send() and call() look alike on the wire; these methods are sends.
const SENDS = new Set(['setHeight', 'notify', 'setActive', 'appHookResult', 'closeDialog'])

window.addEventListener('message', async (e) => {
  const frame = frames.get(e.source)
  const msg = e.data
  if (!frame || !msg || typeof msg !== 'object' || !msg.method) return
  if (msg.method === 'init') return post(e.source, { method: 'connect', params: [frame.data, []] })
  if (SENDS.has(msg.method)) return handleSend(frame, msg.method, msg.params ?? [])
  try {
    const result = await handleCall(frame, msg.method, msg.params ?? [])
    post(e.source, { id: msg.id, result: result ?? null })
  } catch (err) {
    post(e.source, { error: { message: err?.message ?? String(err), status: err?.status }, id: msg.id })
  }
})

function mount(container, name, data) {
  const iframe = document.createElement('iframe')
  iframe.name = name
  iframe.dataset.location = data.location
  container.append(iframe)
  frames.set(iframe.contentWindow, { data: { id: `${name}-${Math.random().toString(36).slice(2, 8)}`, ...data }, iframe })
  iframe.src = state.appURL
  return iframe
}

const base = (location, extra = {}) => ({
  hostnames: { delivery: 'cdn.contentful.com', management: 'api.contentful.com', preview: 'preview.contentful.com', upload: 'upload.contentful.com', webapp: 'app.contentful.com' },
  initialContentTypes: state.contentTypes,
  locales,
  location,
  user,
  ...extra,
  ids: { app: ids.app, environment: ids.environment, environmentAlias: undefined, organization: ids.organization, space: ids.space, user: ids.user, ...extra.ids },
  parameters: { installation: state.installation?.parameters ?? {}, instance: {}, invocation: undefined, ...extra.parameters },
})

const main = document.getElementById('main')

if (view === 'config') {
  document.getElementById('title').textContent = 'Apps › VocalStack › Configuration'
  const button = document.getElementById('install')
  button.hidden = false
  button.textContent = state.installation ? 'Save' : 'Install'
  button.onclick = () => void saveConfiguration()
  configFrame = mount(main, 'app-config', base('app-config'))
  configFrame.style.height = '1400px'
} else {
  const ct = state.contentTypes.find((c) => c.sys.id === state.entry.sys.contentType.sys.id)
  const ei = state.installation?.targetState?.EditorInterface?.[ct.sys.id]
  const controls = ct.fields.map((f) => {
    const own = ei?.controls?.find((c) => c.fieldId === f.id)
    return own ? { fieldId: f.id, widgetId: ids.app, widgetNamespace: 'app' } : { fieldId: f.id, widgetId: f.type === 'Object' ? 'objectEditor' : f.type === 'Link' ? 'assetLinkEditor' : 'singleLine', widgetNamespace: 'builtin' }
  })
  const editorInterface = { controls, sidebar: ei?.sidebar ? [{ widgetId: ids.app, widgetNamespace: 'app' }] : undefined, sys: { id: 'default', type: 'EditorInterface' } }
  const fieldInfo = ct.fields.map((f) => ({
    id: f.id,
    isDisabled: { [LOCALE]: false },
    items: f.items,
    linkType: f.linkType,
    locales: [LOCALE],
    name: f.name,
    required: f.required,
    schemaErrors: { [LOCALE]: [] },
    type: f.type,
    validations: f.validations,
    values: { [LOCALE]: state.entry.fields[f.id]?.[LOCALE] },
  }))
  const entryData = { contentType: ct, editor: { editorInterface, localeSettings: { focusedLocale: LOCALE, mode: 'single' }, showHiddenFields: false }, editorInterface, entry: { metadata: state.entry.metadata, sys: state.entry.sys }, fieldInfo }

  document.getElementById('title').textContent = `Content › ${ct.name} › ${state.entry.fields.title?.[LOCALE] ?? 'Untitled'}`
  main.innerHTML = '<div class="editor"><section id="fields"></section><aside id="sidebar"><h3>Sidebar</h3></aside></div>'
  const fields = document.getElementById('fields')
  for (const f of ct.fields) {
    const box = Object.assign(document.createElement('div'), { className: 'field' })
    box.dataset.field = f.id
    box.append(Object.assign(document.createElement('label'), { textContent: f.name }))
    fields.append(box)
    const control = controls.find((c) => c.fieldId === f.id)
    if (control.widgetNamespace === 'app') {
      const fi = fieldInfo.find((x) => x.id === f.id)
      mount(
        box,
        `field-${f.id}`,
        base('entry-field', {
          ...entryData,
          field: { id: f.id, isDisabled: false, locale: LOCALE, name: f.name, required: f.required, schemaErrors: [], type: f.type, validations: f.validations, value: fi.values[LOCALE] },
          ids: { contentType: ct.sys.id, entry: state.entry.sys.id, field: f.id },
        }),
      )
    } else if (f.type === 'Link') {
      const file = state.asset.fields.file[LOCALE]
      box.append(Object.assign(document.createElement('div'), { textContent: `${state.asset.fields.title[LOCALE]} (${file.fileName}, ${file.contentType})` }))
    } else if (f.type === 'Object') {
      const pre = Object.assign(document.createElement('pre'), { textContent: JSON.stringify(state.entry.fields[f.id]?.[LOCALE] ?? null, null, 2) })
      box.append(pre)
    } else {
      const input = Object.assign(document.createElement('input'), { readOnly: true, value: state.entry.fields[f.id]?.[LOCALE] ?? '' })
      box.append(input)
    }
  }
  if (ei?.sidebar) {
    mount(document.getElementById('sidebar'), 'sidebar', base('entry-sidebar', { ...entryData, ids: { contentType: ct.sys.id, entry: state.entry.sys.id } }))
  } else {
    document.getElementById('sidebar').append('VocalStack is not in this content type’s sidebar.')
  }
}

window.__fakeContentful = { unhandled }
