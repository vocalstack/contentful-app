// A stand-in for Contentful, for the e2e test: the web app's side of the App SDK
// channel (host/), the space's content (one entry, its audio asset, the installation),
// and the App Function runtime, which runs the built function (build/functions/vocalstack.js)
// against a real VocalStack. Three origins, as in Contentful: the host page, the app
// bundle in its own origin, and an asset host standing in for ctfassets.net.
//
//   node e2e/server.mjs      (ports from E2E_HOST_PORT, E2E_APP_PORT, E2E_ASSET_PORT)

import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

export const HOST_PORT = Number(process.env.E2E_HOST_PORT || 5180)
export const APP_PORT = Number(process.env.E2E_APP_PORT || 5181)
export const ASSET_PORT = Number(process.env.E2E_ASSET_PORT || 5182)
const AUDIO = process.env.E2E_AUDIO || join(here, 'fixtures', 'episode-042.mp3')

// The function accepts this host as an asset host, and uploads its files (VocalStack
// does not fetch private addresses). Set before the function is imported or called.
process.env.VOCALSTACK_TEST_ASSET_HOSTS = `127.0.0.1:${ASSET_PORT}`

const manifest = JSON.parse(readFileSync(join(root, 'contentful-app-manifest.json'), 'utf8'))
const fn = await import(pathToFileURL(join(root, 'build/functions/vocalstack.js')).href)

const IDS = { app: 'vocalstack-app-def', environment: 'master', organization: 'org-e2e', space: 'space-e2e', user: 'user-e2e' }
/** What a Secret parameter reads as outside the function. */
const REDACTED = '••••••••'
const SECRETS = ['apiKey']

const link = (id) => ({ sys: { id, linkType: 'Asset', type: 'Link' } })
const ctSys = (id) => ({ environment: { sys: { id: 'master', linkType: 'Environment', type: 'Link' } }, id, space: { sys: { id: IDS.space, linkType: 'Space', type: 'Link' } }, type: 'ContentType', version: 3 })
const field = (id, name, type, extra = {}) => ({ disabled: false, id, localized: false, name, omitted: false, required: false, type, validations: [], ...extra })

const contentTypes = [
  {
    description: 'A podcast episode',
    displayField: 'title',
    fields: [field('title', 'Title', 'Symbol'), field('audio', 'Audio', 'Link', { linkType: 'Asset' }), field('transcript', 'Transcript', 'Object')],
    name: 'Episode',
    sys: ctSys('episode'),
  },
  {
    displayField: 'title',
    fields: [field('title', 'Title', 'Symbol'), field('body', 'Body', 'Text')],
    name: 'Article',
    sys: ctSys('article'),
  },
]

function freshState() {
  return {
    actionCalls: [],
    asset: {
      fields: {
        file: { 'en-US': { contentType: 'audio/mpeg', details: { size: statSync(AUDIO).size }, fileName: 'episode-042.mp3', url: `//127.0.0.1:${ASSET_PORT}/space-e2e/asset-042/0f1e2d/episode-042.mp3` } },
        title: { 'en-US': 'Episode 42 audio' },
      },
      metadata: { tags: [] },
      sys: { id: 'asset-042', type: 'Asset', version: 4 },
    },
    entry: {
      fields: { audio: { 'en-US': link('asset-042') }, title: { 'en-US': 'Episode 42: the e2e episode' } },
      metadata: { tags: [] },
      sys: { contentType: { sys: { id: 'episode', linkType: 'ContentType', type: 'Link' } }, id: 'entry-042', type: 'Entry', version: 1 },
    },
    installation: undefined, // { parameters, targetState } once installed
  }
}
let state = freshState()

const redact = (params) => {
  if (!params) return params
  const out = { ...params }
  for (const k of SECRETS) if (out[k] !== undefined) out[k] = REDACTED
  return out
}

/** Contentful's side of a save: a redacted Secret sent back keeps the stored value. */
function configure({ parameters, targetState }) {
  const stored = state.installation?.parameters ?? {}
  const next = { ...parameters }
  for (const k of SECRETS) if (next[k] === REDACTED) next[k] = stored[k]
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k]
  state.installation = { parameters: JSON.parse(JSON.stringify(next)), targetState: targetState ?? {} }
}

/** The manifest's parameter checks, as Contentful makes them before invoking the function. */
function validateAction(appActionId, parameters) {
  const action = manifest.actions.find((a) => a.id === appActionId)
  if (!action) return `Unknown app action ${appActionId}`
  for (const p of action.parameters) {
    const v = parameters?.[p.id]
    if (v === undefined || v === '') {
      if (p.required) return `Missing required parameter ${p.id}`
      continue
    }
    if (typeof v !== 'string') return `Parameter ${p.id} must be a string`
    if (p.type === 'Enum' && !p.options.includes(v)) return `Parameter ${p.id} must be one of ${p.options.join(', ')}`
  }
  const known = new Set(action.parameters.map((p) => p.id))
  const extra = Object.keys(parameters ?? {}).filter((k) => !known.has(k))
  if (extra.length) return `Unknown parameters: ${extra.join(', ')}`
}

async function callAction({ appActionId, appDefinitionId, parameters }) {
  const id = `call-${state.actionCalls.length + 1}`
  const sys = { action: { sys: { id: appActionId } }, id, type: 'AppActionCall' }
  const logged = { appActionId, id, parameters }
  state.actionCalls.push(logged)
  if (appDefinitionId !== IDS.app) return { sys: { ...sys, error: { message: 'Unknown app definition' }, status: 'failed' } }
  if (!state.installation) return { sys: { ...sys, error: { message: 'The app is not installed' }, status: 'failed' } }
  const invalid = validateAction(appActionId, parameters)
  if (invalid) return { sys: { ...sys, error: { message: invalid }, status: 'failed' } }
  try {
    const event = { body: parameters, headers: {}, type: 'appaction.call' }
    const context = { appInstallationParameters: state.installation.parameters, environmentId: IDS.environment, spaceId: IDS.space }
    const result = await fn.handler(event, context)
    logged.result = result
    return { sys: { ...sys, result, status: 'succeeded' } }
  } catch (err) {
    logged.error = String(err)
    return { sys: { ...sys, error: { message: (err && err.message) || String(err) }, status: 'failed' } }
  }
}

const TYPES = { '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' }

function serveFile(res, file, type) {
  try {
    const body = readFileSync(file)
    res.writeHead(200, { 'cache-control': 'no-store', 'content-type': type ?? TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}

const readBody = (req) =>
  new Promise((ok, fail) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => ok(s ? JSON.parse(s) : {}))
    req.on('error', fail)
  })

const json = (res, status, body) => {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' })
  res.end(JSON.stringify(body ?? null))
}

const host = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(res, join(here, 'host/index.html'))
    if (req.method === 'GET' && url.pathname === '/host.js') return serveFile(res, join(here, 'host/host.js'))
    if (url.pathname === '/api/state' && req.method === 'GET') {
      // What the web app hands the app: no Secret values.
      return json(res, 200, {
        appURL: `http://127.0.0.1:${APP_PORT}/index.html`,
        asset: state.asset,
        contentTypes,
        echo: process.env.E2E_ECHO !== '0',
        entry: state.entry,
        ids: IDS,
        installation: state.installation && { parameters: redact(state.installation.parameters), targetState: state.installation.targetState },
      })
    }
    if (url.pathname === '/api/configure' && req.method === 'POST') {
      configure(await readBody(req))
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/field' && req.method === 'POST') {
      const { fieldId, locale, value } = await readBody(req)
      if (!contentTypes[0].fields.some((f) => f.id === fieldId)) return json(res, 422, { message: `Unknown field ${fieldId}` })
      if (value === undefined || value === null) {
        if (state.entry.fields[fieldId]) delete state.entry.fields[fieldId][locale]
      } else (state.entry.fields[fieldId] ??= {})[locale] = value
      state.entry.sys.version++
      return json(res, 200, { version: state.entry.sys.version })
    }
    if (url.pathname === '/api/action' && req.method === 'POST') return json(res, 200, await callAction(await readBody(req)))
    // Test introspection: the stored (unredacted) state and every action call.
    if (url.pathname === '/test/state' && req.method === 'GET') return json(res, 200, state)
    if (url.pathname === '/test/reset' && req.method === 'POST') {
      state = freshState()
      return json(res, 200, { ok: true })
    }
    res.writeHead(404).end('not found')
  } catch (err) {
    json(res, 500, { message: String(err) })
  }
})

// The app bundle, as Contentful hosts it: its own origin, relative asset paths.
const appRoot = join(root, 'build')
const app = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(appRoot, path === '/' ? 'index.html' : path)
  if (!file.startsWith(appRoot) || file.startsWith(join(appRoot, 'functions'))) return res.writeHead(404).end()
  serveFile(res, file)
})

// ctfassets.net's stand-in: the audio file at any path ending in .mp3.
const assets = createServer((req, res) => {
  if (!new URL(req.url, 'http://x').pathname.endsWith('.mp3')) return res.writeHead(404).end()
  serveFile(res, AUDIO, 'audio/mpeg')
})

const listen = (server, port) => new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', ok))
await Promise.all([listen(host, HOST_PORT), listen(app, APP_PORT), listen(assets, ASSET_PORT)])
console.log(`fake Contentful on http://127.0.0.1:${HOST_PORT} (app ${APP_PORT}, assets ${ASSET_PORT})`)
