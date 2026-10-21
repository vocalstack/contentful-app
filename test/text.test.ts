import { describe, expect, it } from 'vitest'

import { paragraphs, transcriptText } from '../src/text.js'

const s = (start: number, end: number, speaker: number, text: string) => ({ end, speaker, start, text })

describe('transcriptText', () => {
  it('joins sentences, and breaks paragraphs on a speaker change or a pause over 2.5 s', () => {
    const sentences = [s(0, 2, 0, 'Hello there.'), s(2.1, 4, 0, ' How are you? '), s(4.2, 6, 1, 'Fine.'), s(9, 10, 1, 'Later on.')]
    expect(paragraphs(sentences).map((p) => p.length)).toEqual([2, 1, 1])
    expect(transcriptText(sentences)).toBe('Hello there. How are you?\n\nFine.\n\nLater on.')
  })

  it('is empty without sentences', () => {
    expect(transcriptText([])).toBe('')
  })
})
