import { describe, expect, it } from 'vitest'
import { confidenceOf, findCandidates } from '../../src/lib/match'
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
