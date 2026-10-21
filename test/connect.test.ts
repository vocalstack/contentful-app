import { describe, expect, it } from 'vitest'

import { beginConnect, callbackURL, challengeOf, readCallback } from '../src/connect.js'

describe('one-click connect', () => {
  it('computes the S256 challenge: BASE64URL(SHA256(verifier))', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFbEjXk')).toBe('N4-5v7LG-T8x3fWSLZ-7W4IevaqpPl0Ln-6oRgYUj1Q')
  })

  it('builds the dashboard link the Payload plugin does, named after the space', async () => {
    const redirectURI = callbackURL({ origin: 'https://abc.ctfcloud.net', pathname: '/index.html' })
    const p = await beginConnect({ clientName: 'Podcasts (Contentful)', dashboardURL: 'https://app.vocalstack.com', redirectURI })
    const u = new URL(p.url)
    expect(u.origin + u.pathname).toBe('https://app.vocalstack.com/connect')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_name: 'Podcasts (Contentful)',
      code_challenge: await challengeOf(p.verifier),
      code_challenge_method: 'S256',
      redirect_uri: 'https://abc.ctfcloud.net/index.html?vocalstack-connect=1',
      response_type: 'code',
      scope: 'read write',
      state: p.state,
    })
    expect(p.verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('reads the dashboard answer', () => {
    expect(readCallback('?vocalstack-connect=1&code=c&state=s')).toEqual({ code: 'c', error: undefined, errorDescription: undefined, state: 's' })
  })
})
