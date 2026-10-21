// End to end in a real browser: the built app in the fake Contentful (e2e/server.mjs),
// its function against a real VocalStack. Run through e2e/run.sh.
//
//   VOCALSTACK_API_KEY   a key with read + write (required)
//   VOCALSTACK_API_URL   default http://127.0.0.1:8090
//   E2E_CHROMIUM         a Chromium binary (default: Playwright's own)
//   E2E_SHOTS            where screenshots go (default e2e/results/shots)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const HOST = `http://127.0.0.1:${process.env.E2E_HOST_PORT || 5180}`
const API_URL = process.env.VOCALSTACK_API_URL || 'http://127.0.0.1:8090'
const KEY = process.env.VOCALSTACK_API_KEY
const SHOTS = process.env.E2E_SHOTS || join(here, 'results', 'shots')
const JOB_TIMEOUT = Number(process.env.E2E_JOB_TIMEOUT_MS || 240000)
if (!KEY) throw new Error('Set VOCALSTACK_API_KEY')
mkdirSync(SHOTS, { recursive: true })

const results = []
let failed = false
async function step(name, fn) {
  const t0 = Date.now()
  if (failed) {
    results.push({ name, status: 'skipped' })
    console.log(`- skip  ${name}`)
    return
  }
  try {
    const note = await fn()
    results.push({ ms: Date.now() - t0, name, note, status: 'pass' })
    console.log(`✓ pass  ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${note ? `\n        ${note}` : ''}`)
  } catch (err) {
    failed = true
    await page.screenshot({ fullPage: true, path: join(SHOTS, `failed-${results.length + 1}.png`) }).catch(() => {})
    console.log(`        field value: ${JSON.stringify(await transcriptValue().catch(() => undefined))?.slice(0, 400)}`)
    results.push({ error: String(err?.stack ?? err), ms: Date.now() - t0, name, status: 'fail' })
    console.log(`✗ FAIL  ${name}\n        ${err?.stack ?? err}`)
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const server = {
  reset: () => fetch(`${HOST}/test/reset`, { method: 'POST' }),
  state: async () => (await fetch(`${HOST}/test/state`)).json(),
  pub: async () => (await fetch(`${HOST}/api/state`)).json(),
}
const transcriptValue = async () => (await server.state()).entry.fields.transcript?.['en-US']

async function until(what, fn, timeout = 30000, every = 500) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, every))
  }
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined })
const context = await browser.newContext({ viewport: { height: 1000, width: 1280 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && pageErrors.push(`console: ${m.text()}`))
const shot = (name) => page.screenshot({ fullPage: true, path: join(SHOTS, `${name}.png`) })
const unhandled = () => page.evaluate(() => window.__fakeContentful?.unhandled ?? [])

const openConfig = async () => {
  await page.goto(`${HOST}/?view=config`)
  await page.locator('body[data-app-ready=true]').waitFor({ timeout: 20000 })
  return page.frameLocator('iframe[name=app-config]')
}
const openEntry = async () => {
  await page.goto(`${HOST}/?view=entry`)
  const field = page.frameLocator('iframe[name=field-transcript]')
  const sidebar = page.frameLocator('iframe[name=sidebar]')
  await field.getByRole('button', { name: /^(Transcribe|Transcribing…|Transcribe again)$/ }).waitFor({ timeout: 20000 })
  await sidebar.getByRole('button', { name: /^(Transcribe|Transcribing…|Transcribe again)$/ }).waitFor({ timeout: 20000 })
  return { field, sidebar }
}
const toast = (text) => page.locator('#toasts .toast', { hasText: text }).first().waitFor({ timeout: 15000 })
/** Click Transcribe, then wait for the job to start, or fail with what the app said instead. */
async function startJob(frame, name) {
  await frame.getByRole('button', { exact: true, name }).click()
  const started = frame.getByRole('button', { name: 'Stop' })
  const refused = frame.locator('[role=alert], [data-test-id=cf-ui-note]').filter({ hasText: /\S/ })
  await Promise.race([started.waitFor({ timeout: 60000 }), refused.first().waitFor({ timeout: 60000 })])
  if (!(await started.isVisible()) && (await refused.count())) throw new Error(`Transcribe was refused: ${(await refused.first().textContent()).trim()}`)
}
const PROGRESS = /^(Queued|Fetching the file|Extracting audio|Transcribing)( · \d+%|…)/

let firstTranscript
let firstRecording

await server.reset()

await step('config: paste the key, pick the content type and fields, install', async () => {
  const app = await openConfig()
  await app.getByPlaceholder('vs_key_…').fill(KEY)
  await app.getByRole('button', { name: 'Use key' }).click()
  await toast('Save the configuration to keep the key.')
  await app.getByText('Episode', { exact: true }).click()
  await app.getByLabel('Transcript field').selectOption('transcript')
  await app.getByLabel('Audio field').selectOption('audio')
  await app.getByRole('button', { name: 'Advanced' }).click()
  await app.getByLabel('API URL').fill(API_URL)
  await shot('01-config-filled')
  await page.locator('#install').click()
  await toast('App configuration saved')
  // onConfigurationCompleted: the function checks the stored key against VocalStack.
  const status = app.getByText(/^Connected to VocalStack as /)
  await status.waitFor({ timeout: 30000 })
  const s = await server.state()
  assert(s.installation.parameters.apiKey === KEY, 'the key was not stored')
  assert(s.installation.parameters.apiURL === API_URL, 'the API URL was not stored')
  assert(JSON.stringify(s.installation.parameters.contentTypes) === JSON.stringify({ episode: { audioField: 'audio', transcriptField: 'transcript' } }), `contentTypes: ${JSON.stringify(s.installation.parameters.contentTypes)}`)
  assert(JSON.stringify(s.installation.targetState) === JSON.stringify({ EditorInterface: { episode: { controls: [{ fieldId: 'transcript' }], sidebar: { position: 1 } } } }), `targetState: ${JSON.stringify(s.installation.targetState)}`)
  await shot('02-config-installed')
  return (await status.textContent()).trim()
})

await step('config: reopen and save again; the redacted key keeps the stored one', async () => {
  const app = await openConfig()
  await app.getByText(/^Connected to VocalStack/).waitFor()
  assert(!(await page.content()).includes(KEY), 'the host page carries the key')
  await page.locator('#install').click()
  await toast('App configuration saved')
  await app.getByText(/^Connected to VocalStack as /).waitFor({ timeout: 30000 })
  assert((await server.state()).installation.parameters.apiKey === KEY, 'a second save lost the key')
})

await step('entry field: Transcribe shows progress in the field and the sidebar', async () => {
  const { field, sidebar } = await openEntry()
  await startJob(field, 'Transcribe')
  await field.getByRole('button', { name: 'Transcribing…' }).waitFor({ timeout: 60000 })
  const progress = field.locator('[data-test-id=cf-ui-text]').filter({ hasText: PROGRESS })
  await progress.waitFor({ timeout: 30000 })
  await sidebar.getByRole('button', { name: 'Transcribing…' }).waitFor({ timeout: 10000 })
  const v = await transcriptValue()
  assert(v?.status === 'processing' && v.recordingId && v.transcriptionId, `field value: ${JSON.stringify(v)}`)
  firstRecording = v.recordingId
  await shot('03-entry-transcribing')
  return `${(await progress.textContent()).trim()}; recording ${v.recordingId}`
})

await step('entry field: reload mid-job, the job is picked back up', async () => {
  const before = await transcriptValue()
  assert(before?.status === 'processing', `the job ended before the reload: ${JSON.stringify(before)}`)
  const { field, sidebar } = await openEntry()
  await field.getByRole('button', { name: 'Transcribing…' }).waitFor({ timeout: 15000 })
  const progress = field.locator('[data-test-id=cf-ui-text]').filter({ hasText: PROGRESS })
  await progress.waitFor({ timeout: 30000 })
  await sidebar.getByRole('button', { name: 'Transcribing…' }).waitFor({ timeout: 10000 })
  await shot('04-entry-after-reload')
  return (await progress.textContent()).trim()
})

await step('entry field: done, real transcript saved in the JSON value', async () => {
  const field = page.frameLocator('iframe[name=field-transcript]')
  await field.getByText(/^Transcribed/).waitFor({ timeout: JOB_TIMEOUT })
  const v = await until('the saved transcript', async () => {
    const x = await transcriptValue()
    return x?.status === 'done' && x
  })
  assert(v.recordingId === firstRecording, 'another recording was saved')
  assert(typeof v.transcript === 'string' && v.transcript.split(/\s+/).length >= 10, `transcript too short: ${v.transcript}`)
  assert(Array.isArray(v.sentences) && v.sentences.length > 0 && v.sentences.every((s) => typeof s.start === 'number' && typeof s.end === 'number' && s.text), 'sentences missing')
  assert(v.language, 'no language')
  assert(v.error === null && v.transcribedAt, 'error/transcribedAt')
  // The field shows the saved text.
  await field.getByText(v.transcript.split('\n\n')[0].slice(0, 40), { exact: false }).waitFor()
  firstTranscript = v.transcript
  await shot('05-entry-done')
  return `(${v.language}, ${v.sentences.length} sentences) ${v.transcript}`
})

await step('sidebar: renders the same done state', async () => {
  const { sidebar } = await openEntry()
  await sidebar.getByRole('button', { name: 'Transcribe again' }).waitFor()
  await sidebar.getByText(/^Transcribed \(\w+\)\.$/).waitFor()
  await sidebar.getByText('The transcript is in Transcript, in English (United States).').waitFor()
  await shot('06-sidebar-done')
})

await step('stop: a second run, started in the sidebar, stopped in the field', async () => {
  const { field, sidebar } = await openEntry()
  await startJob(sidebar, 'Transcribe again')
  await field.getByRole('button', { name: 'Stop' }).waitFor({ timeout: 60000 })
  const running = await until('the second job', async () => {
    const x = await transcriptValue()
    return x?.status === 'processing' && x.recordingId !== firstRecording && x
  })
  // While it runs, the earlier transcript stays in the field's value.
  assert(running.transcript === firstTranscript, 'the earlier transcript was replaced while the job runs')
  await field.getByRole('button', { name: 'Stop' }).click()
  await page.locator('#dialog.open').waitFor()
  await shot('07-stop-confirm')
  await page.locator('#dialog-confirm').click()
  await toast('Transcription stopped.')
  const v = await until('the stopped state', async () => {
    const x = await transcriptValue()
    return x?.status === 'done' && x
  })
  assert(v.transcript === firstTranscript, 'Stop lost the earlier transcript')
  assert(v.recordingId === running.recordingId, 'recordingId')
  await field.getByRole('button', { name: 'Transcribe again' }).waitFor()
  await sidebar.getByRole('button', { name: 'Transcribe again' }).waitFor()
  // VocalStack itself says the job was stopped.
  const job = await (await fetch(`${API_URL}/v1/recordings/${running.recordingId}/job`, { headers: { authorization: `Bearer ${KEY}` } })).json()
  assert(job.state === 'stopped' && job.errorCode === 'stopped', `VocalStack job: ${JSON.stringify(job)}`)
  await shot('08-stopped')
  return `recording ${running.recordingId}: ${job.state}/${job.errorCode}`
})

await step('stop elsewhere: a third run stopped in VocalStack itself, the field goes back', async () => {
  const { field, sidebar } = await openEntry()
  await startJob(field, 'Transcribe again')
  const running = await until('the third job', async () => {
    const x = await transcriptValue()
    return x?.status === 'processing' && x
  })
  const res = await fetch(`${API_URL}/v1/recordings/${running.recordingId}/stop`, { body: JSON.stringify({ reason: 'e2e: stopped outside Contentful' }), headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, method: 'POST' })
  assert(res.ok, `stop answered ${res.status}`)
  await toast('Transcription stopped.')
  const v = await until('the stopped state', async () => {
    const x = await transcriptValue()
    return x?.status === 'done' && x
  })
  assert(v.transcript === firstTranscript, 'the earlier transcript was lost')
  await sidebar.getByRole('button', { name: 'Transcribe again' }).waitFor()
  await shot('09-stopped-elsewhere')
})

await step('nothing the app asked went unanswered, no key left the function, no page errors', async () => {
  const s = await server.state()
  assert(!JSON.stringify(s.actionCalls.map((c) => c.parameters)).includes('vs_key_'), 'an action call carried a key')
  assert(!JSON.stringify((await server.pub()).installation).includes(KEY), 'the web app state carries the key')
  const left = await unhandled()
  assert(left.length === 0, `unhandled: ${left.join('; ')}`)
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  const ops = s.actionCalls.map((c) => c.parameters.op)
  return `${s.actionCalls.length} action calls (${[...new Set(ops)].map((o) => `${o} ×${ops.filter((x) => x === o).length}`).join(', ')})`
})

await browser.close()
mkdirSync(join(here, 'results'), { recursive: true })
writeFileSync(join(here, 'results', 'summary.json'), JSON.stringify({ firstTranscript, results }, null, 2))
console.log(failed ? '\nFAILED' : '\nALL PASSED')
process.exit(failed ? 1 : 0)
