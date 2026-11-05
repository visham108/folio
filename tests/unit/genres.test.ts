import { describe, expect, it } from 'vitest'
import { canonicalGenres, GENRES, genreOf, typedGenre } from '../../src/lib/genres'

describe('Folio genres', () => {
  it('keeps its own genres as they are, whatever the case', () => {
    for (const g of GENRES) expect(genreOf(g.toUpperCase())).toBe(g)
  })

  it('folds lookup and import tags into the set', () => {
    expect(canonicalGenres(['Religion', 'Hinduism', 'Sacred Writings'])).toEqual(['Scripture & Commentary'])
    expect(canonicalGenres(['Biography & Autobiography', 'Religious'])).toEqual(['Biography & Memoir'])
    expect(canonicalGenres(['Travel', 'Spirituality', 'Hinduism'])).toEqual(['Holy Places & Pilgrimage'])
    expect(canonicalGenres(['Computers', 'Cloud Security', 'Certification'])).toEqual(['Technology'])
    expect(canonicalGenres(['Personal Finance', 'Investing'])).toEqual(['Business & Finance'])
    expect(canonicalGenres(['Science Fiction', 'Space Opera'])).toEqual(['Fiction & Fantasy'])
    expect(canonicalGenres(['Fantasy', 'Mythology', 'Classics'])).toEqual(['Fiction & Fantasy', 'Epics & Stories', 'Classics'])
    expect(canonicalGenres(['Psychology', 'Neuroscience', 'Self-Help'])).toEqual(['Self-Help & Psychology'])
    expect(canonicalGenres(['Poetry', 'Music', 'Hinduism'])).toEqual(['Poetry & Song'])
  })

  it('a book tagged only as spiritual counts as philosophy; noise is dropped', () => {
    expect(canonicalGenres(['Spirituality', 'Hinduism'])).toEqual(['Philosophy & Teachings'])
    expect(canonicalGenres(['Accessible book', 'Protected DAISY'])).toEqual([])
  })

  it('scripture titles are scripture whatever the tags say', () => {
    expect(canonicalGenres(['Spirituality', 'Philosophy'], { title: 'Srimad-Bhagavatam, Fifth Canto' })).toEqual(['Scripture & Commentary', 'Philosophy & Teachings'])
  })

  it('splits subject paths and keeps at most three', () => {
    expect(canonicalGenres(['Religion / Hinduism / Biography', 'History', 'Travel', 'Poetry'])).toEqual(['Biography & Memoir', 'History & Politics', 'Holy Places & Pilgrimage'])
  })

  it('a typed genre becomes the matching one, or is refused', () => {
    expect(typedGenre('memoir')).toBe('Biography & Memoir')
    expect(typedGenre('Hinduism')).toBe('Philosophy & Teachings')
    expect(typedGenre('asdf')).toBe('')
  })
})
