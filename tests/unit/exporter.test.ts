import { describe, expect, it } from 'vitest'
import { fullCsv, goodreadsCsv } from '../../src/lib/exporter'
import { buildImport, guessColumns, guessValues, parseTable } from '../../src/lib/importer'
import { sampleLibrary } from '../../src/lib/sample'
import type { Edition, Entry, Snapshot } from '../../src/lib/types'

const lib = sampleLibrary() as Required<ReturnType<typeof sampleLibrary>>

describe('Goodreads export', () => {
  const csv = goodreadsCsv(lib)
  it('round-trips through the importer', () => {
    const { headers, rows } = parseTable(csv)
    expect(headers[0]).toBe('Book Id')
    expect(rows).toHaveLength(lib.entries.length)
    const cols = guessColumns(headers, rows)
    const plan = buildImport(rows, cols, guessValues(rows, cols), { works: [], editions: [], entries: [], shelves: [] })
    expect(plan.data.entries).toHaveLength(lib.entries.length)
    const dune = plan.data.works.find((w) => w.title === 'Dune')!
    expect(dune.series).toBe('Dune')
    const duneEntry = plan.data.entries.find((e) => e.workId === dune.id)!
    const original = lib.entries.find((e) => lib.works.find((w) => w.id === e.workId)?.title === 'Dune')!
    expect(duneEntry.status).toBe(original.status === 'paused' ? 'paused' : original.status)
    const finishedBefore = lib.reads.filter((r) => r.entryId === original.id && r.state === 'finished').length
    expect(plan.data.reads.filter((r) => r.entryId === duneEntry.id && r.state === 'finished')).toHaveLength(finishedBefore)
  })
})

describe('full CSV', () => {
  it('has one row per read plus books never started', () => {
    const { rows } = parseTable(fullCsv(lib))
    const started = new Set(lib.reads.map((r) => r.entryId))
    expect(rows).toHaveLength(lib.reads.length + lib.entries.filter((e) => !started.has(e.id)).length)
  })
})

// A small library with the awkward cases: a reread on another edition with its own
// ratings, a DNF, a numbered series, a half-star rating, a subtitle and a formula-like title.
const t = '2026-01-01T00:00:00Z'
const ed = (id: string, workId: string, more: Partial<Edition>): Edition => ({ id, workId, format: 'paperback', narrators: [], translators: [], createdAt: t, ...more })
const en = (id: string, workId: string, editionId: string, more: Partial<Entry>): Entry =>
  ({ id, workId, editionId, status: 'read', favorite: false, owned: false, tags: [], shelfIds: [], addedAt: '2020-01-05T12:00:00Z', updatedAt: t, ...more })
const small: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'shelves'> = {
  works: [
    { id: 'w1', title: 'Piranesi', authors: ['Susanna Clarke'], genres: ['Fantasy'], firstPublished: 2020, createdAt: t },
    { id: 'w2', title: 'Sapiens', subtitle: 'A Brief History of Humankind', authors: ['Yuval Noah Harari'], genres: [], createdAt: t },
    { id: 'w3', title: 'Catching Fire', series: 'The Hunger Games', seriesIndex: 2, authors: ['Suzanne Collins'], genres: [], createdAt: t },
    { id: 'w4', title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'], genres: [], createdAt: t },
    { id: 'w5', title: '=HYPERLINK("http://evil.example","x")', authors: ['Mallory Example'], genres: [], createdAt: t },
    { id: 'w6', title: 'Dune Messiah', series: 'Dune', authors: ['Frank Herbert'], genres: [], createdAt: t },
  ],
  editions: [
    ed('e1', 'w1', { isbn13: '9781635575637', isbn10: '1635575630', pages: 272, publisher: 'Bloomsbury' }),
    ed('e1a', 'w1', { format: 'audiobook', isbn13: '9781635576214', durationMin: 500, narrators: ['Chiwetel Ejiofor'] }),
    ed('e2', 'w2', { format: 'hardcover', isbn13: '9780062316097', pages: 443 }),
    ed('e3', 'w3', { format: 'ebook', pages: 391 }),
    ed('e4', 'w4', { pages: 412 }),
    ed('e5', 'w5', {}),
    ed('e6', 'w6', { pages: 256 }),
  ],
  entries: [
    en('n1', 'w1', 'e1', { rating: 4.5, favorite: true, owned: true, tags: ['Comfort'], shelfIds: ['s1'] }),
    en('n2', 'w2', 'e2', { rating: 3.5, review: 'Big ideas.' }),
    en('n3', 'w3', 'e3', { status: 'reading' }),
    en('n4', 'w4', 'e4', { status: 'dnf' }),
    en('n5', 'w5', 'e5', { status: 'want' }),
    en('n6', 'w6', 'e6', { status: 'want' }),
  ],
  reads: [
    { id: 'r1', entryId: 'n1', editionId: 'e1', state: 'finished', startedOn: '2021-02-10', finishedOn: '2021-02-20', rating: 4 },
    { id: 'r2', entryId: 'n1', editionId: 'e1a', state: 'finished', startedOn: '2024-06-01', finishedOn: '2024-06-09', rating: 5, notes: 'Better on audio' },
    { id: 'r3', entryId: 'n2', editionId: 'e2', state: 'finished', startedOn: '2023-01-01', finishedOn: '2023-01-31', rating: 3.5 },
    { id: 'r4', entryId: 'n3', editionId: 'e3', state: 'reading', startedOn: '2026-10-01' },
    { id: 'r5', entryId: 'n4', editionId: 'e4', state: 'dnf', startedOn: '2023-04-02', finishedOn: '2023-04-20' },
  ],
  shelves: [{ id: 's1', name: 'Book Club', position: 0 }],
}
const reimport = (csv: string) => {
  const { headers, rows } = parseTable(csv)
  const cols = guessColumns(headers, rows)
  return buildImport(rows, cols, guessValues(rows, cols), { works: [], editions: [], entries: [], shelves: [] }).data
}

describe('full CSV round trip', () => {
  const back = reimport(fullCsv(small))
  const work = (title: string) => back.works.find((w) => w.title === title)!
  const entry = (title: string) => back.entries.find((e) => e.workId === work(title).id)!
  const reads = (title: string) => back.reads.filter((r) => r.entryId === entry(title).id)
  const edition = (id?: string) => back.editions.find((e) => e.id === id)!

  it('brings back every book once', () => {
    expect(back.works.map((w) => w.title).sort()).toEqual(small.works.map((w) => w.title).sort())
    expect(back.entries).toHaveLength(small.entries.length)
  })
  it('keeps rereads, each with its own dates, rating, notes and edition', () => {
    const rs = reads('Piranesi')
    expect(rs.map((r) => ({ state: r.state, startedOn: r.startedOn, finishedOn: r.finishedOn, rating: r.rating, notes: r.notes }))).toEqual(
      small.reads.filter((r) => r.entryId === 'n1').map((r) => ({ state: r.state, startedOn: r.startedOn, finishedOn: r.finishedOn, rating: r.rating, notes: r.notes })))
    expect(edition(rs[1].editionId)).toMatchObject({ format: 'audiobook', durationMin: 500, isbn13: '9781635576214', narrators: ['Chiwetel Ejiofor'] })
    expect(edition(rs[0].editionId)).toMatchObject({ format: 'paperback', pages: 272, isbn13: '9781635575637', isbn10: '1635575630', publisher: 'Bloomsbury' })
  })
  it('keeps the book-level details', () => {
    expect(entry('Piranesi')).toMatchObject({ status: 'read', rating: 4.5, favorite: true, owned: true, tags: ['Comfort'] })
    expect(back.shelves.map((s) => s.name)).toEqual(['Book Club'])
    expect(work('Piranesi')).toMatchObject({ genres: ['Fantasy'], firstPublished: 2020 })
    expect(entry('Piranesi').addedAt.slice(0, 10)).toBe('2020-01-05')
  })
  it('keeps half stars, subtitles and series numbers', () => {
    expect(entry('Sapiens')).toMatchObject({ rating: 3.5, review: 'Big ideas.' })
    expect(reads('Sapiens')[0].rating).toBe(3.5)
    expect(work('Sapiens').subtitle).toBe('A Brief History of Humankind')
    expect(work('Catching Fire')).toMatchObject({ series: 'The Hunger Games', seriesIndex: 2 })
    expect(work('Dune Messiah')).toMatchObject({ series: 'Dune', seriesIndex: undefined })
  })
  it('keeps DNF and current reads in their states', () => {
    expect(entry('Good Omens').status).toBe('dnf')
    expect(reads('Good Omens')).toEqual([expect.objectContaining({ state: 'dnf', startedOn: '2023-04-02', finishedOn: '2023-04-20' })])
    expect(entry('Catching Fire').status).toBe('reading')
    expect(reads('Catching Fire')).toEqual([expect.objectContaining({ state: 'reading', startedOn: '2026-10-01' })])
    expect(reads('Dune Messiah')).toHaveLength(0)
  })
  it('keeps a formula-like title as plain text', () => {
    expect(work('=HYPERLINK("http://evil.example","x")').authors).toEqual(['Mallory Example'])
  })
})

describe('formula-like cells', () => {
  it('are made plain text in both exports, leaving Goodreads’ ISBN cells alone', () => {
    for (const csv of [fullCsv(small), goodreadsCsv(small)]) {
      expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`)
      expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
    }
    const gr = goodreadsCsv(small)
    expect(gr).toContain('"=""9781635575637"""')
    // An empty ISBN is ="" as Goodreads writes it, with no stray quote.
    expect(gr).toContain(',"=""""",')
    expect(gr).not.toContain('"=""""""')
  })
})

describe('Goodreads CSV details', () => {
  const csv = goodreadsCsv(small)
  const { headers, rows } = parseTable(csv)
  const title = (i: number) => rows[i][headers.indexOf('Title')]
  const row = (w: string) => rows.findIndex((r) => r[headers.indexOf('Title')].startsWith(w))
  it('writes titles as Goodreads shows them', () => {
    expect(title(row('Sapiens'))).toBe('Sapiens: A Brief History of Humankind')
    expect(title(row('Catching Fire'))).toBe('Catching Fire (The Hunger Games, #2)')
    expect(title(row('Dune Messiah'))).toBe('Dune Messiah (Dune)')
  })
  it('rounds to whole stars', () => {
    expect(rows[row('Piranesi')][headers.indexOf('My Rating')]).toBe('5')
  })
  it('reads back subtitles and series, with or without a number', () => {
    const back = reimport(csv)
    expect(back.works.find((w) => w.title === 'Sapiens')?.subtitle).toBe('A Brief History of Humankind')
    expect(back.works.find((w) => w.title === 'Catching Fire')).toMatchObject({ series: 'The Hunger Games', seriesIndex: 2 })
    expect(back.works.find((w) => w.title === 'Dune Messiah')).toMatchObject({ series: 'Dune' })
    expect(back.entries.find((e) => e.workId === back.works.find((w) => w.title === 'Good Omens')!.id)?.status).toBe('dnf')
  })
})
