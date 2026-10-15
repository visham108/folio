import { describe, expect, it } from 'vitest'
import { buildSeries } from '../../src/lib/series'
import { SMART_SHELVES } from '../../src/lib/smartShelves'
import type { Entry, Read, Work } from '../../src/lib/types'

const t = '2024-01-01T00:00:00Z'
const w = (id: string, title: string, idx?: number, series = 'Dune'): Work => ({ id, title, authors: ['Frank Herbert'], genres: [], series, seriesIndex: idx, createdAt: t })
const e = (id: string, workId: string, status: Entry['status'], extra: Partial<Entry> = {}): Entry => ({ id, workId, status, favorite: false, owned: false, tags: [], shelfIds: [], addedAt: t, updatedAt: t, ...extra })

describe('series', () => {
  const works = [w('d1', 'Dune', 1), w('d2', 'Dune Messiah', 2), w('d3', 'Children of Dune', 3), w('x', 'Other', 1, 'Something')]
  const entries = new Map([['d1', e('e1', 'd1', 'read')], ['d3', e('e3', 'd3', 'want')]])
  const reads = new Map<string, Read[]>([['e1', [{ id: 'r', entryId: 'e1', state: 'finished', finishedOn: '2024-02-01' }]]])
  const [dune] = buildSeries(works, entries, reads)
  it('orders books and finds the next unread one', () => {
    expect(dune.name).toBe('Dune')
    expect(dune.books.map((b) => b.work.title)).toEqual(['Dune', 'Dune Messiah', 'Children of Dune'])
    expect(dune.read).toBe(1)
    expect(dune.next?.work.id).toBe('d2')
    expect(dune.books[1].state).toBe('none')
  })
})

describe('smart shelves', () => {
  const shelf = (id: string) => SMART_SHELVES.find((s) => s.id === id)!
  const ctx = (entry: Entry, edition?: object, reads: Read[] = []) => ({
    work: w('d1', 'Dune', 1), entry, edition: edition as never, reads, nextInSeries: new Set<string>(), now: Date.parse('2026-06-01'),
  })
  it('spots quick reads, long hauls and audiobooks', () => {
    expect(shelf('quick-reads').match(ctx(e('a', 'd1', 'want'), { format: 'paperback', pages: 180 }))).toBe(true)
    expect(shelf('quick-reads').match(ctx(e('a', 'd1', 'want'), { format: 'audiobook', durationMin: 300 }))).toBe(true)
    expect(shelf('long-haul').match(ctx(e('a', 'd1', 'want'), { format: 'hardcover', pages: 700 }))).toBe(true)
    expect(shelf('listen-next').match(ctx(e('a', 'd1', 'want'), { format: 'audiobook' }))).toBe(true)
    expect(shelf('quick-reads').match(ctx(e('a', 'd1', 'read'), { format: 'paperback', pages: 180 }))).toBe(false)
  })
  it('finds books waiting over a year and rereads', () => {
    expect(shelf('waiting-longest').match(ctx(e('a', 'd1', 'want', { addedAt: '2024-01-01T00:00:00Z' })))).toBe(true)
    const twice: Read[] = [{ id: '1', entryId: 'a', state: 'finished' }, { id: '2', entryId: 'a', state: 'finished' }]
    expect(shelf('reread').match(ctx(e('a', 'd1', 'read'), undefined, twice))).toBe(true)
  })
})
