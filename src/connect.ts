/**
 * One-click connect, as OAuth 2.0 authorization code + PKCE (RFC 7636) whose
 * token is a VocalStack API key, the Payload plugin's protocol with the App Function as its server:
 *
 * 1. The configuration screen makes a state and a verifier (kept in memory only) and
 *    opens {dashboard}/connect?response_type=code&redirect_uri=…&state=…&code_challenge=…
 * 2. The person clicks Authenticate on the dashboard, which redirects to this app's
 *    own page with ?code=…&state=… (the `vocalstack-connect` callback, see callback.ts).
 * 3. That tab hands the code to the configuration screen, which checks the state and has
 *    the App Function redeem the code at {api}/v1/connect/token with the verifier (the
 *    token endpoint answers servers only). The key it answers is saved as the Secret
 *    `apiKey` installation parameter.
 */

import type { Backend } from './backend.js'

export const CALLBACK_PARAM = 'vocalstack-connect'
export const CONNECT_MESSAGE = 'vocalstack:connect'
const MAX_CLIENT_NAME = 100

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)))

export type PendingConnect = { redirectURI: string; state: string; url: string; verifier: string }

/** The page the dashboard sends the code back to: this app's own address. */
export function callbackURL(location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}?${CALLBACK_PARAM}=1`
}

export async function challengeOf(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

/** The connect link, and what the configuration screen keeps to redeem its code. */
export async function beginConnect(args: { clientName: string; dashboardURL: string; redirectURI: string }): Promise<PendingConnect> {
  const state = random(24)
  const verifier = random(48)
  const url = new URL('/connect', args.dashboardURL)
  url.search = new URLSearchParams({
    client_name: args.clientName.trim().slice(0, MAX_CLIENT_NAME),
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
    redirect_uri: args.redirectURI,
    response_type: 'code',
    scope: 'read write',
    state,
  }).toString()
  return { redirectURI: args.redirectURI, state, url: url.toString(), verifier }
}

/** What the callback tab hands over: the dashboard's query, as it came. */
export type ConnectResult = { code?: string; error?: string; errorDescription?: string; state?: string }

export function readCallback(search: string): ConnectResult {
  const p = new URLSearchParams(search)
  const get = (k: string) => p.get(k) ?? undefined
  return { code: get('code'), error: get('error'), errorDescription: get('error_description'), state: get('state') }
}

/** Have the App Function redeem the code for an API key. */
export async function finishConnect(pending: PendingConnect, result: ConnectResult, backend: Pick<Backend, 'connect'>): Promise<{ account?: string; apiKey: string }> {
  if (!result.state || result.state !== pending.state) throw new Error('This connect link has expired. Start again.')
  if (result.error) throw new Error(result.error === 'access_denied' ? 'Connection cancelled.' : `VocalStack said: ${result.errorDescription ?? result.error}`)
  return backend.connect({ code: result.code ?? '', codeVerifier: pending.verifier, redirectUri: pending.redirectURI })
}
