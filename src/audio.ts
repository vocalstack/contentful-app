/** The content type field shape this file needs (a subset of Contentful's). */
export type FieldDef = {
  id: string
  items?: { linkType?: string; type: string }
  linkType?: string
  name: string
  type: string
}

/** The asset shape this file needs (a subset of the CMA's). */
export type AssetLike = {
  fields: {
    file?: Record<string, undefined | { contentType?: string; fileName?: string; url?: string }>
    title?: Record<string, string | undefined>
  }
  sys: { id: string }
}

export type AudioSource = { assetId: string; fieldId: string; fileName: string; title?: string; url: string }

/** A Media field: one asset (`Link` to `Asset`), or many (`Array` of them). */
export const isMediaField = (f: FieldDef) => (f.type === 'Link' && f.linkType === 'Asset') || (f.type === 'Array' && f.items?.type === 'Link' && f.items.linkType === 'Asset')

/** A JSON Object field: where the transcript goes. */
export const isObjectField = (f: FieldDef) => f.type === 'Object'

/** The asset ids a Media field's value links to, in order. */
export function linkedAssetIds(value: unknown): string[] {
  const links = Array.isArray(value) ? value : value ? [value] : []
  return links
    .map((l) => (l as { sys?: { id?: string; linkType?: string } })?.sys)
    .filter((s): s is { id: string; linkType?: string } => typeof s?.id === 'string' && (s.linkType === undefined || s.linkType === 'Asset'))
    .map((s) => s.id)
}

/**
 * The address VocalStack fetches. Contentful serves asset files protocol-relative
 * (`//assets.ctfassets.net/…`, `//downloads.ctfassets.net/…`); VocalStack needs https.
 */
export function assetFileURL(url: string): string {
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`
  return url
}

/** A localized value: this locale's, else the default locale's. */
export const localized = <T>(values: Record<string, T | undefined> | undefined, locale: string, defaultLocale: string): T | undefined =>
  values?.[locale] ?? values?.[defaultLocale]

/** The asset's file, if it is processed audio. */
export function audioFile(asset: AssetLike, locale: string, defaultLocale: string) {
  const file = localized(asset.fields.file, locale, defaultLocale)
  if (!file?.url || !file.contentType?.startsWith('audio/')) return undefined
  return file as { contentType: string; fileName?: string; url: string }
}

/**
 * The audio to transcribe. With `audioField` (the instance parameter, or the
 * configuration screen's choice), that field's first audio asset; otherwise the
 * first Media field, in content type order, that links an `audio/*` asset.
 */
export async function findAudio(args: {
  audioField?: string
  defaultLocale: string
  fields: FieldDef[]
  getAsset: (id: string) => Promise<AssetLike>
  locale: string
  readValue: (fieldId: string) => unknown
}): Promise<{ error: string } | AudioSource> {
  const { audioField, defaultLocale, fields, getAsset, locale, readValue } = args
  const media = fields.filter(isMediaField)
  const candidates = audioField ? media.filter((f) => f.id === audioField) : media
  if (audioField && !candidates.length) return { error: `There is no Media field "${audioField}" in this content type.` }
  if (!candidates.length) return { error: 'This content type has no Media field to transcribe.' }

  let linkedAny = false
  for (const field of candidates) {
    for (const id of linkedAssetIds(readValue(field.id))) {
      linkedAny = true
      const asset = await getAsset(id).catch(() => undefined)
      const file = asset && audioFile(asset, locale, defaultLocale)
      if (!file) continue
      return {
        assetId: id,
        fieldId: field.id,
        fileName: file.fileName ?? 'audio',
        title: localized(asset.fields.title, locale, defaultLocale) || undefined,
        url: assetFileURL(file.url),
      }
    }
  }
  if (!linkedAny) return { error: audioField ? `Add an audio file to ${candidates[0].name} first.` : 'Add an audio file to this entry first.' }
  return { error: 'Only audio files can be transcribed.' }
}
