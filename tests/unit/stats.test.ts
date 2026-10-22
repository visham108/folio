import { describe, expect, it } from 'vitest'
import { completions, pageEquivalent, summarize } from '../../src/lib/stats'
import { DEFAULT_SETTINGS, type Edition, type Entry, type Read, type Work } from '../../src/lib/types'

const t = '2026-01-01T00:00:00Z'
const work: Work = { id: 'w', title: 'Dune', authors: ['Frank Herbert'], genres: ['Science Fiction'], createdAt: t }
const print: Edition = { id: 'p', workId: 'w', format: 'paperback', pages: 600, narrators: [], translators: [], createdAt: t }
const audio: Edition = { id: 'a', workId: 'w', format: 'audiobook', durationMin: 1200, narrators: [], translators: [], createdAt: t }
const entry: Entry = { id: 'e', workId: 'w', editionId: 'p', status: 'read', favorite: false, owned: true, tags: [], shelfIds: [], addedAt: t, updatedAt: t }
const reads: Read[] = [
  { id: 'r1', entryId: 'e', editionId: 'p', state: 'finished', startedOn: '2025-01-01', finishedOn: '2025-01-20', rating: 4 },
  { id: 'r2', entryId: 'e', editionId: 'a', state: 'finished', startedOn: '2026-03-01', finishedOn: '2026-03-10', rating: 5 },
  { id: 'r3', entryId: 'e', editionId: 'p', state: 'dnf' },
]
const lk = { works: new Map([['w', work]]), editions: new Map([['p', print], ['a', audio]]), entries: new Map([['e', entry]]) }

describe('stats', () => {
  const items = completions(reads, lk)
  it('counts each finished read, including rereads in another format', () => {
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ medium: 'audio', isReread: true, minutes: 1200, pages: 0 })
  })
  it('summarises a year', () => {
    const y = summarize(items, 2026)
    expect(y).toMatchObject({ books: 1, rereads: 1, minutes: 1200, pages: 0, avgRating: 5 })
    expect(y.byMedium.audio).toBe(1)
    expect(y.monthly[2].books.audio).toBe(1)
    expect(y.avgDays).toBe(10)
  })
  it('converts listening into page-equivalents', () => {
    expect(pageEquivalent({ pages: 0, minutes: 120 }, DEFAULT_SETTINGS)).toBe(40)
  })
})
