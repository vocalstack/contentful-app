import { describe, expect, it } from 'vitest'

import { readWorkspace, savedWorkspace, withChecked, withConnection, withoutConnection, workspaceHue, workspaceIconSrc, workspaceInitials } from '../src/workspace.js'

describe('the workspace mark, as the VocalStack dashboard draws it', () => {
  it('a two-word workspace shows the first letter of each word', () => {
    expect(workspaceInitials('Acme studio')).toBe('AS')
    expect(workspaceInitials('  north   radio  live ')).toBe('NR')
  })

  it('a one-word workspace shows its first two letters', () => {
    expect(workspaceInitials('Podcast')).toBe('PO')
    expect(workspaceInitials('X')).toBe('X')
  })

  it('punctuation and emoji-only words are skipped', () => {
    expect(workspaceInitials('— Church & choir')).toBe('CC')
    expect(workspaceInitials('"Évora" talks')).toBe('ÉT')
    expect(workspaceInitials('   ')).toBe('?')
  })

  it('the same workspace always gets the same colour', () => {
    expect(workspaceHue('ws_1')).toBe(workspaceHue('ws_1'))
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(workspaceHue))
    expect(seen.size).toBeGreaterThan(2)
  })

  it('picks the hues the dashboard picks', () => {
    expect(workspaceHue('')).toBe(330)
    expect(workspaceHue('a')).toBe(330)
    expect(workspaceHue('ws_1')).toBe(12)
  })
})

describe('the workspace in an API answer', () => {
  it('reads id, name, personal and the icon link, and nothing else', () => {
    expect(readWorkspace({ iconUrl: '/workspace-icons/ws_1?v=2', id: 'ws_1', name: 'North Radio', personal: false, secret: 'x' })).toEqual({ iconUrl: '/workspace-icons/ws_1?v=2', id: 'ws_1', name: 'North Radio', personal: false })
    expect(readWorkspace({ id: 'ws_me', name: 'Personal workspace', personal: true })).toEqual({ iconUrl: null, id: 'ws_me', name: 'Personal workspace', personal: true })
  })

  it('is undefined from an older API, or when it is not a workspace', () => {
    expect(readWorkspace(undefined)).toBeUndefined()
    expect(readWorkspace(null)).toBeUndefined()
    expect(readWorkspace('ws_1')).toBeUndefined()
    expect(readWorkspace({ name: 'No id' })).toBeUndefined()
    expect(readWorkspace({ id: 'ws_1', name: '' })).toBeUndefined()
  })

  it('makes the icon address from the API address, for the browser to load without a key', () => {
    expect(workspaceIconSrc('https://api.vocalstack.com', '/workspace-icons/ws_1?v=2&exp=9&sig=s')).toBe('https://api.vocalstack.com/workspace-icons/ws_1?v=2&exp=9&sig=s')
    expect(workspaceIconSrc('http://127.0.0.1:8090/', '/workspace-icons/ws_1')).toBe('http://127.0.0.1:8090/workspace-icons/ws_1')
    expect(workspaceIconSrc('https://api.vocalstack.com', null)).toBeUndefined()
    expect(workspaceIconSrc('https://api.vocalstack.com', 'javascript:alert(1)')).toBeUndefined()
  })
})

describe('the installation parameters', () => {
  const north = { iconUrl: '/workspace-icons/ws_1?v=2&exp=9&sig=s', id: 'ws_1', name: 'North Radio', personal: false }
  const old = { account: 'Acme', apiKey: 'vs_key_old', connected: true, spokenLanguage: 'en', workspace: { id: 'ws_0', name: 'Acme', personal: false } }

  it('never keep the icon link, whose signature runs out', () => {
    expect(savedWorkspace(north)).toEqual({ id: 'ws_1', name: 'North Radio', personal: false })
    expect(JSON.stringify(withConnection({}, { apiKey: 'vs_key_new', workspace: north }))).not.toContain('workspace-icons')
    expect(JSON.stringify(withChecked(old, { workspace: north }))).not.toContain('workspace-icons')
  })

  it('take the new key and its workspace on a change, and keep everything else', () => {
    expect(withConnection(old, { account: 'North Radio', apiKey: 'vs_key_new', workspace: north })).toEqual({
      account: 'North Radio',
      apiKey: 'vs_key_new',
      connected: true,
      spokenLanguage: 'en',
      workspace: { id: 'ws_1', name: 'North Radio', personal: false },
    })
  })

  it('forget the earlier workspace when a new key names none (a pasted key, an older API)', () => {
    expect(withConnection(old, { apiKey: 'vs_key_pasted' })).toMatchObject({ account: undefined, apiKey: 'vs_key_pasted', workspace: undefined })
    expect(withConnection(old, { account: 'Acme Ltd', apiKey: 'vs_key_new' })).toMatchObject({ account: 'Acme Ltd', workspace: undefined })
  })

  it('take a rename from a check, and keep what is saved when an older API names no workspace', () => {
    expect(withChecked(old, { account: 'Acme Studio', workspace: { ...old.workspace, name: 'Acme Studio' } })).toMatchObject({ account: 'Acme Studio', apiKey: 'vs_key_old', workspace: { id: 'ws_0', name: 'Acme Studio', personal: false } })
    expect(withChecked(old, { account: 'Acme' })).toEqual(old)
    expect(withChecked({ apiKey: 'k', connected: true }, { account: 'Acme' })).toEqual({ account: 'Acme', apiKey: 'k', connected: true, workspace: undefined })
  })

  it('lose the key and the workspace on Disconnect', () => {
    expect(withoutConnection(old)).toEqual({ account: undefined, apiKey: undefined, connected: false, spokenLanguage: 'en', workspace: undefined })
  })
})
