/**
 * The VocalStack workspace a key belongs to: what the key makes lands there and is billed
 * there. A key never changes workspace; connecting again and picking another workspace
 * on the consent screen makes a new key for it.
 */

import type { AppInstallationParameters, SavedWorkspace } from './types.js'

/** As `GET /v1/me` and `POST /v1/connect/token` answer it (an older API leaves it out). */
export type Workspace = SavedWorkspace & {
  /**
   * The workspace's own icon, a PNG, as a link relative to the API's address that needs
   * no key. Its signature is renewed monthly, so it is read again and never saved.
   */
  iconUrl?: null | string
}

/** One or two letters for a workspace with no icon, as the VocalStack dashboard draws them. */
export function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  const first = (w: string) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? ''
  if (words.length === 0) return '?'
  if (words.length === 1) return Array.from(words[0].replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase() || '?'
  return (first(words[0]) + first(words[1])).toUpperCase()
}

const HUES = [252, 200, 160, 128, 85, 40, 12, 330, 296]

/** The tile's hue (degrees), the dashboard's choice for this workspace. */
export function workspaceHue(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return HUES[(h >>> 0) % HUES.length]
}

/** The workspace in an API answer, or undefined when it is missing or not one. */
export function readWorkspace(value: unknown): undefined | Workspace {
  if (!value || typeof value !== 'object') return undefined
  const w = value as Record<string, unknown>
  if (typeof w.id !== 'string' || !w.id || typeof w.name !== 'string' || !w.name) return undefined
  return { id: w.id, name: w.name, personal: w.personal === true, iconUrl: typeof w.iconUrl === 'string' && w.iconUrl ? w.iconUrl : null }
}

/** What is kept in the installation parameters: never the icon's signed link. */
export const savedWorkspace = (w: undefined | Workspace): SavedWorkspace | undefined => (w ? { id: w.id, name: w.name, personal: w.personal } : undefined)

/** The icon's address for an <img>: the API's address plus the relative link. Only http(s). */
export function workspaceIconSrc(apiURL: string, iconUrl: null | string | undefined): string | undefined {
  if (!iconUrl) return undefined
  try {
    const u = new URL(iconUrl, `${apiURL.replace(/\/+$/, '')}/`)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

/** The parameters after a new key: its workspace when the answer names one. */
export function withConnection(params: AppInstallationParameters, c: { account?: string; apiKey: string; workspace?: Workspace }): AppInstallationParameters {
  return { ...params, account: c.workspace?.name ?? c.account, apiKey: c.apiKey, connected: true, workspace: savedWorkspace(c.workspace) }
}

/** The parameters after the saved key was checked: a rename reaches them; an older API's answer keeps what is there. */
export function withChecked(params: AppInstallationParameters, c: { account?: string; workspace?: Workspace }): AppInstallationParameters {
  const account = c.workspace?.name ?? c.account ?? params.account
  return { ...params, account, workspace: savedWorkspace(c.workspace) ?? params.workspace }
}

export const withoutConnection = (params: AppInstallationParameters): AppInstallationParameters => ({ ...params, account: undefined, apiKey: undefined, connected: false, workspace: undefined })
