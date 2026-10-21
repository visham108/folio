import { describe, expect, it } from 'vitest'
import { completions, readingSlices, summarize } from '../../src/lib/stats'
import type { Edition, Entry, LogPoint, Read, Work } from '../../src/lib/types'

const t = '2025-01-01T00:00:00Z'
const work: Work = { id: 'w', title: 'A Hundred Pages', authors: ['Someone'], genres: [], createdAt: t }
const ed: Edition = { id: 'p', workId: 'w', format: 'paperback', pages: 100, narrators: [], translators: [], createdAt: t }
const entry: Entry = { id: 'e', workId: 'w', editionId: 'p', status: 'read', favorite: false, owned: true, tags: [], shelfIds: [], addedAt: t, updatedAt: t }
const lk = { works: new Map([['w', work]]), editions: new Map([['p', ed]]), entries: new Map([['e', entry]]) }
const log = (on: string, amount: number, readId = 'r'): LogPoint => ({ id: on + amount, readId, on, amount, medium: 'print' })
const pagesIn = (sl: ReturnType<typeof readingSlices>, year: number) => sl.filter((x) => x.year === year).reduce((s, x) => s + x.pages, 0)

describe('pages fall on the days you read them', () => {
  const read: Read = { id: 'r', entryId: 'e', editionId: 'p', state: 'finished', startedOn: '2025-11-01', finishedOn: '2026-01-15' }

  it('splits a book read across New Year: half in each year, the book itself in the finish year', () => {
    const sl = readingSlices([read], [log('2025-12-20', 50)], lk)
    expect(pagesIn(sl, 2025)).toBe(50)
    expect(pagesIn(sl, 2026)).toBe(50)
    const items = completions([read], lk)
    expect(summarize(items, 2025, sl)).toMatchObject({ books: 0, pages: 50 })
    expect(summarize(items, 2026, sl)).toMatchObject({ books: 1, pages: 50 })
    expect(summarize(items, 2025, sl).monthly[11].pages).toBe(50)
  })

  it('with no progress updates, the whole book counts when finished (as before)', () => {
    const sl = readingSlices([read], [], lk)
    expect(pagesIn(sl, 2025)).toBe(0)
    expect(pagesIn(sl, 2026)).toBe(100)
  })

  it('never takes pages back from a year already counted, and never counts more than the book', () => {
    // Read to 60 in 2025, corrected back to 40 in 2026, then finished.
    const sl = readingSlices([read], [log('2025-12-01', 60), log('2026-01-05', -20), log('2026-01-10', 30)], lk)
    expect(pagesIn(sl, 2025)).toBe(60)
    expect(pagesIn(sl, 2026)).toBe(40)
    // Overshooting the page count is capped.
    const over = readingSlices([read], [log('2025-12-01', 150)], lk)
    expect(pagesIn(over, 2025) + pagesIn(over, 2026)).toBe(100)
  })

  it('counts pages from books still being read, or given up, in the year they were read', () => {
    const reading: Read = { id: 'r2', entryId: 'e', editionId: 'p', state: 'reading' }
    const dnf: Read = { id: 'r3', entryId: 'e', editionId: 'p', state: 'dnf', finishedOn: '2026-02-01' }
    const sl = readingSlices([reading, dnf], [log('2026-01-03', 25, 'r2'), log('2026-01-20', 10, 'r3')], lk)
    expect(pagesIn(sl, 2026)).toBe(35)
  })

  it('without slices, summarize keeps the old finish-date totals', () => {
    expect(summarize(completions([read], lk), 2026)).toMatchObject({ pages: 100 })
  })
})
