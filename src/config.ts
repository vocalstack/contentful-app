import type { AppState } from '@contentful/app-sdk'

import type { ContentTypeSetting } from './types.js'

import { type FieldDef, isObjectField } from './audio.js'

/** The JSON Object field to suggest: one called Transcript, else the first. */
export function defaultTranscriptField(fields: FieldDef[]): string | undefined {
  const objects = fields.filter(isObjectField)
  return (objects.find((f) => /^transcript$/i.test(f.id) || /^transcript$/i.test(f.name.trim())) ?? objects[0])?.id
}

/**
 * Where Contentful shows the app: the field editor of each Transcript field, and the
 * sidebar of its content type. Content types left out lose both.
 */
export function buildTargetState(selected: Record<string, ContentTypeSetting>): AppState {
  const EditorInterface: AppState['EditorInterface'] = {}
  for (const [id, setting] of Object.entries(selected)) {
    EditorInterface[id] = { controls: [{ fieldId: setting.transcriptField }], sidebar: { position: 1 } }
  }
  return { EditorInterface }
}
