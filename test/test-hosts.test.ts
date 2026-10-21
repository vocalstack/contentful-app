import { afterEach, describe, expect, it, vi } from 'vitest'

import { run } from '../functions/vocalstack.js'

const install = { apiKey: 'vs_key_secret', connected: true }
const params = { idempotencyKey: 'e:k', name: 'Episode 42', op: 'transcribe' as const, url: 'https://127.0.0.1:5182/episode-042.mp3' }

afterEach(() => {
  delete process.env.VOCALSTACK_TEST_ASSET_HOSTS
  vi.unstubAllGlobals()
})

describe('test asset hosts (e2e only)', () => {
  it('refuses a local asset host unless VOCALSTACK_TEST_ASSET_HOSTS lists it', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    expect(await run(params, install, { spaceId: 's' })).toMatchObject({ error: { code: 'invalid_url', status: 400 } })
    process.env.VOCALSTACK_TEST_ASSET_HOSTS = '127.0.0.1:9999'
    expect(await run(params, install, { spaceId: 's' })).toMatchObject({ error: { code: 'invalid_url', status: 400 } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches a listed host over http itself and uploads the bytes', async () => {
    process.env.VOCALSTACK_TEST_ASSET_HOSTS = '127.0.0.1:5182'
    const calls: { body?: unknown; url: string }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ body: init.body, url: String(input) })
      if (String(input).startsWith('http://127.0.0.1:5182/')) return new Response(new Uint8Array([1, 2, 3]))
      return new Response(JSON.stringify({ id: 'tx_1', job: { progress: { pct: 0 }, recordingId: 'rec_1', state: 'queued', transcriptionId: 'tx_1' }, name: 'Episode 42' }), { status: 201 })
    })
    expect(await run(params, install, { spaceId: 's' })).toEqual({ recordingId: 'rec_1', state: 'queued', transcriptionId: 'tx_1' })
    expect(calls[0].url).toBe('http://127.0.0.1:5182/episode-042.mp3')
    const form = calls[1].body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect((form.get('file') as File).name).toBe('episode-042.mp3')
    expect(JSON.parse(String(form.get('options')))).toEqual({ name: 'Episode 42' })
  })
})
