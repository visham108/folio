import { describe, expect, it } from 'vitest'
import { authorSimilarity, confidenceOf, findCandidates, fold, titleNumbers, titleSimilarity } from '../../src/lib/match'
import type { Edition, Work } from '../../src/lib/types'

const t = '2026-01-01T00:00:00Z'
const works: Work[] = [
  { id: 'hobbit', title: 'The Hobbit', subtitle: 'or There and Back Again', authors: ['J.R.R. Tolkien'], genres: [], createdAt: t },
  { id: 'dune', title: 'Dune', authors: ['Frank Herbert'], genres: [], createdAt: t },
  { id: 'messiah', title: 'Dune Messiah', authors: ['Frank Herbert'], genres: [], createdAt: t },
]
const editions: Edition[] = [
  { id: 'e1', workId: 'hobbit', format: 'paperback', isbn13: '9780547928227', narrators: [], translators: [], createdAt: t },
]

describe('findCandidates', () => {
  it('finds the exact edition by ISBN', () => {
    const [c] = findCandidates({ title: '', authors: [], isbn: '978-0-547-92822-7' }, works, editions)
    expect(c.work.id).toBe('hobbit')
    expect(confidenceOf(c)).toBe('exact')
  })
  it('matches a misspelt title with initials written differently', () => {
    const [c] = findCandidates({ title: 'the hobit', authors: ['Tolkien, JRR'] }, works, editions)
    expect(c?.work.id).toBe('hobbit')
  })
  it('ranks the exact title above a sequel', () => {
    const cs = findCandidates({ title: 'Dune', authors: ['Frank Herbert'] }, works, editions)
    expect(cs[0].work.id).toBe('dune')
    expect(confidenceOf(cs[0])).toBe('strong')
    const sequel = cs.find((c) => c.work.id === 'messiah')
    if (sequel) expect(confidenceOf(sequel)).not.toBe('strong')
  })
  it('ignores unrelated books', () => {
    expect(findCandidates({ title: 'Middlemarch', authors: ['George Eliot'] }, works, editions)).toHaveLength(0)
  })
})

describe('titleSimilarity', () => {
  it.each([
    ['Dune: House Atreides', 'Dune: House Harkonnen'],
    ['Star Wars: Thrawn', 'Star Wars: Heir to the Empire'],
    ['Saga, Vol. 1', 'Saga, Vol. 2'],
    ['The Walking Dead, Vol. 01: Days Gone Bye', 'The Walking Dead, Vol. 02: Miles Behind Us'],
    ['Book II', 'Book III'],
    ['The Expanse, Book One', 'The Expanse, Book Two'],
  ])('keeps %s and %s apart', (a, b) => expect(titleSimilarity(a, b)).toBeLessThan(0.8))

  it.each([
    ['Sapiens', 'Sapiens: A Brief History of Humankind'],
    ['The Hobbit', 'The Hobbit, or There and Back Again'],
    ['Fire & Blood', 'Fire and Blood'],
    ['Saga, Vol. 1', 'Saga, Vol. 1 (Saga #1)'],
    ['Sapiens: A Brief History of Humankind', 'Sapiens: a brief histroy of humankind'],
  ])('still matches %s and %s', (a, b) => expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(0.9))

  it('only counts volume numbers that are numbers', () => {
    expect(titleNumbers('I, Robot')).toBe('')
    expect(titleNumbers('Saga, Vol. 01')).toBe('1')
    expect(titleNumbers('Book II')).toBe('2')
    expect(titleNumbers('Book Two')).toBe('2')
  })

  it('compares titles in any script', () => {
    expect(fold('ノルウェイの森')).toBe('ノルウェイの森')
    expect(fold('Ὀδύσσεια')).toBe('οδυσσεια')
    expect(fold('Преступление и наказание')).toBe('преступление и наказание')
    expect(titleSimilarity('ノルウェイの森', '白夜行')).toBeLessThan(0.5)
    expect(titleSimilarity('ノルウェイの森', 'ノルウェイの森')).toBe(1)
    expect(titleSimilarity('Война и мир', 'Анна Каренина')).toBeLessThan(0.6)
    // Punctuation-only titles fold to nothing, and nothing is not a match.
    expect(titleSimilarity('???', '!!!')).toBe(0)
  })
})

describe('authorSimilarity', () => {
  it('compares names written without spaces as whole names', () => {
    expect(authorSimilarity(['村上春樹'], ['東野圭吾'])).toBeLessThan(0.5)
    expect(authorSimilarity(['村上春樹'], ['村上 春樹'])).toBe(1)
    expect(authorSimilarity(['Лев Толстой'], ['Лев Толстой'])).toBe(1)
  })
  it('keeps the surname logic for spaced names', () => {
    expect(authorSimilarity(['J.R.R. Tolkien'], ['John Ronald Reuel Tolkien'])).toBe(1)
    expect(authorSimilarity(['Christopher Tolkien'], ['J.R.R. Tolkien'])).toBe(0.85)
    expect(authorSimilarity(['Tolkien'], ['J.R.R. Tolkien'])).toBe(0.85)
  })
})

describe('findCandidates with subtitles and other scripts', () => {
  const dune: Work[] = [{ id: 'harkonnen', title: 'Dune', subtitle: 'House Harkonnen', authors: ['Brian Herbert'], genres: [], createdAt: t }]
  it('does not offer a different subtitle as a strong match', () => {
    const [c] = findCandidates({ title: 'Dune', subtitle: 'House Atreides', authors: ['Brian Herbert'] }, dune, [])
    if (c) expect(c.score).toBeLessThan(0.9)
  })
  it('matches the same subtitle', () => {
    const [c] = findCandidates({ title: 'Dune', subtitle: 'House Harkonnen', authors: ['Brian Herbert'] }, dune, [])
    expect(confidenceOf(c)).toBe('strong')
  })
  it('does not match unrelated non-Latin books', () => {
    const jp: Work[] = [{ id: 'byakuyako', title: '白夜行', authors: ['東野圭吾'], genres: [], createdAt: t }]
    expect(findCandidates({ title: 'ノルウェイの森', authors: ['村上春樹'] }, jp, [])).toHaveLength(0)
  })
})
