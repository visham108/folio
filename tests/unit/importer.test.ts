import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildImport, collectKeys, detectSource, guessColumns, guessValues, parseTable } from '../../src/lib/importer'

const empty = { works: [], editions: [], entries: [], shelves: [] }
function run(file: string) {
  const { headers, rows } = parseTable(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'))
  const cols = guessColumns(headers, rows)
  const values = guessValues(rows, cols)
  const plan = buildImport(rows, cols, values, empty)
  const field = (h: string) => cols.find((c) => c.header === h)?.field
  return { headers, rows, cols, values, plan, field }
}

describe('Goodreads export', () => {
  const r = run('goodreads.csv')
  it('is recognised and mapped', () => {
    expect(detectSource(r.headers)).toBe('Goodreads')
    expect(r.field('Exclusive Shelf')).toBe('status')
    expect(r.field('Average Rating')).toBe('ignore')
    expect(r.field('Author l-f')).toBe('ignore')
  })
  it('translates statuses, formats, series and rereads', () => {
    const [hobbit, hunger, habits] = r.plan.data.works
    expect(hobbit.title).toBe('The Hobbit, or There and Back Again')
    expect(hobbit.series).toBe('The Lord of the Rings')
    expect(hunger.series).toBe('The Hunger Games')
    expect(habits.subtitle).toMatch(/^An Easy/)
    expect(r.plan.data.entries.map((e) => e.status)).toEqual(['read', 'want', 'reading'])
    expect(r.plan.data.editions.map((e) => e.format)).toEqual(['paperback', 'ebook', 'audiobook'])
    const hobbitReads = r.plan.data.reads.filter((x) => x.entryId === r.plan.data.entries[0].id)
    expect(hobbitReads).toHaveLength(2)
    expect(hobbitReads.at(-1)?.finishedOn).toBe('2023-03-14')
    expect(r.plan.data.shelves.map((s) => s.name)).toEqual(['Favorites', 'Fantasy'])
  })
})

describe('StoryGraph export', () => {
  const r = run('storygraph.csv')
  it('reads read-date ranges, contributors and quarter-star ratings', () => {
    expect(detectSource(r.headers)).toBe('StoryGraph')
    const piranesi = r.plan.data.entries[0]
    expect(piranesi.rating).toBe(5)
    const reads = r.plan.data.reads.filter((x) => x.entryId === piranesi.id)
    expect(reads.map((x) => `${x.startedOn}→${x.finishedOn}`)).toEqual(['2021-02-10→2021-02-20', '2024-06-01→2024-06-09'])
    expect(r.plan.data.editions[0].narrators).toEqual(['Chiwetel Ejiofor'])
    expect(r.plan.data.editions[2].translators).toEqual(['Ken Liu'])
    expect(r.plan.data.works[1].authors).toEqual(['Terry Pratchett', 'Neil Gaiman'])
    expect(r.plan.data.entries[1].status).toBe('dnf')
    expect(piranesi.moods).toEqual(['mysterious'])
    expect(piranesi.pace).toBe('medium')
    expect(r.plan.data.entries[1]).toMatchObject({ moods: ['funny'], pace: 'fast' })
  })
})

describe('a hand-made spreadsheet', () => {
  const r = run('generic.csv')
  it('guesses columns, tidies casing, rescales ratings and reads day-first dates', () => {
    expect(r.field('Book')).toBe('title')
    expect(r.values.ratingDivisor).toBe(2)
    expect(r.values.dateOrder).toBe('dmy')
    const [lhod] = r.plan.data.works
    expect(lhod.title).toBe('The Left Hand of Darkness')
    expect(lhod.authors).toEqual(['Ursula K. Le Guin'])
    expect(r.plan.data.entries[0].rating).toBe(4.5)
    expect(r.plan.data.reads[0]).toMatchObject({ startedOn: '2022-03-01', finishedOn: '2022-03-14' })
  })
})

describe('matching existing books', () => {
  it('reuses a catalogue book with the same ISBN instead of adding a duplicate', () => {
    const { rows, cols, values } = run('goodreads.csv')
    const t = '2026-01-01T00:00:00Z'
    const existing = {
      works: [{ id: 'w-hobbit', title: 'The Hobbit', authors: ['J.R.R. Tolkien'], genres: [], createdAt: t }],
      editions: [{ id: 'e-hobbit', workId: 'w-hobbit', format: 'paperback' as const, isbn13: '9780618260300', narrators: [], translators: [], createdAt: t }],
      entries: [], shelves: [],
    }
    const plan = buildImport(rows, cols, values, existing)
    expect(plan.matched).toBe(1)
    expect(plan.data.entries[0]).toMatchObject({ workId: 'w-hobbit', editionId: 'e-hobbit' })
    expect(plan.data.works.some((w) => w.title.startsWith('The Hobbit'))).toBe(false)
  })
  it('collects titles and ISBNs for the catalogue lookup', () => {
    const { rows, cols } = run('goodreads.csv')
    const keys = collectKeys(rows, cols)
    expect(keys.titles).toContain('The Hunger Games')
    expect(keys.isbns).toContain('9780618260300')
  })
})
