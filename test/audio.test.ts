import { describe, expect, it } from 'vitest'

import { type AssetLike, type FieldDef, assetFileURL, findAudio, linkedAssetIds } from '../src/audio.js'
import { buildTargetState, defaultTranscriptField } from '../src/config.js'

const fields: FieldDef[] = [
  { id: 'title', name: 'Title', type: 'Symbol' },
  { id: 'cover', linkType: 'Asset', name: 'Cover', type: 'Link' },
  { id: 'files', items: { linkType: 'Asset', type: 'Link' }, name: 'Files', type: 'Array' },
  { id: 'transcript', name: 'Transcript', type: 'Object' },
]
const link = (id: string) => ({ sys: { id, linkType: 'Asset', type: 'Link' } })
const assets: Record<string, AssetLike> = {
  img: { fields: { file: { 'en-US': { contentType: 'image/png', fileName: 'c.png', url: '//images.ctfassets.net/s/img/x/c.png' } } }, sys: { id: 'img' } },
  mp3: {
    fields: { file: { 'en-US': { contentType: 'audio/mpeg', fileName: 'ep.mp3', url: '//assets.ctfassets.net/s/mp3/x/ep.mp3' } }, title: { 'en-US': 'Episode 1' } },
    sys: { id: 'mp3' },
  },
}
const values: Record<string, unknown> = { cover: link('img'), files: [link('img'), link('mp3')] }
const base = { defaultLocale: 'en-US', fields, getAsset: async (id: string) => assets[id], locale: 'de-DE', readValue: (id: string) => values[id] }

describe('findAudio', () => {
  it('takes the first Media field that links audio, falling back to the default locale', async () => {
    expect(await findAudio(base)).toEqual({ assetId: 'mp3', fieldId: 'files', fileName: 'ep.mp3', title: 'Episode 1', url: 'https://assets.ctfassets.net/s/mp3/x/ep.mp3' })
  })
  it('keeps to the audioField parameter', async () => {
    expect(await findAudio({ ...base, audioField: 'cover' })).toEqual({ error: 'Only audio files can be transcribed.' })
    expect(await findAudio({ ...base, audioField: 'nope' })).toEqual({ error: 'There is no Media field "nope" in this content type.' })
  })
  it('asks for a file when nothing is linked', async () => {
    expect(await findAudio({ ...base, readValue: () => undefined })).toEqual({ error: 'Add an audio file to this entry first.' })
  })
})

describe('asset addresses', () => {
  it('makes protocol-relative Contentful URLs https', () => {
    expect(assetFileURL('//downloads.ctfassets.net/s/a/b/x.wav')).toBe('https://downloads.ctfassets.net/s/a/b/x.wav')
    expect(assetFileURL('http://assets.ctfassets.net/x.mp3')).toBe('https://assets.ctfassets.net/x.mp3')
    expect(linkedAssetIds([link('a'), { sys: { id: 'e', linkType: 'Entry' } }, null])).toEqual(['a'])
  })
})

describe('configuration', () => {
  it('suggests the Transcript field and assigns the field editor and the sidebar', () => {
    expect(defaultTranscriptField([{ id: 'meta', name: 'Meta', type: 'Object' }, ...fields])).toBe('transcript')
    expect(buildTargetState({ episode: { transcriptField: 'transcript' } })).toEqual({
      EditorInterface: { episode: { controls: [{ fieldId: 'transcript' }], sidebar: { position: 1 } } },
    })
  })
})
