import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildImport, collectKeys, detectSource, guessColumns, guessStatus, guessValues, parseTable, splitSeries, unwrap } from '../../src/lib/importer'

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

/** Imports CSV text the way the import sheet does. */
function importText(text: string) {
  const { headers, rows } = parseTable(text)
  const cols = guessColumns(headers, rows)
  const values = guessValues(rows, cols)
  return { cols, values, plan: buildImport(rows, cols, values, empty) }
}

describe('statuses and shelves', () => {
  it.each([
    ['to-read', 'want'], ['currently-reading', 'reading'], ['read', 'read'], ['did-not-finish', 'dnf'], ['DNF', 'dnf'],
    ['abandoned', 'dnf'], ['on-hold', 'paused'], ['Paused', 'paused'], ['Want to read', 'want'], ['tbr', 'want'],
    ['wishlist', 'want'], ['Currently reading', 'reading'], ['Did not finish', 'dnf'], ['Finished', 'read'], ['reading', 'reading'],
  ])('%s is %s', (v, want) => expect(guessStatus(v)).toBe(want))

  it.each(['antiquity', 'racial-equity', 'indonesia', 'current-affairs', 'plants', 'collateral', 'favourites', 'reading-list-ideas'])(
    '%s is not a status', (v) => expect(guessStatus(v)).toBeUndefined())

  it('keeps shelves that only look like statuses', () => {
    const { plan } = importText('Title,Author,Bookshelves,Exclusive Shelf\nThe Histories,Herodotus,"antiquity, current-affairs, to-read",to-read\n')
    expect(plan.data.entries[0].status).toBe('want')
    expect(plan.data.shelves.map((s) => s.name)).toEqual(['Antiquity', 'Current Affairs'])
  })
})

describe('set-aside and paused books', () => {
  const sg = 'Title,Authors,Read Status,Last Date Read,Dates Read\n'
  it('keeps a DNF with a last-read date as a DNF read', () => {
    const { plan } = importText(sg + 'Good Omens,Terry Pratchett,did-not-finish,2023/04/20,\n')
    expect(plan.data.entries[0].status).toBe('dnf')
    expect(plan.data.reads).toHaveLength(1)
    expect(plan.data.reads[0]).toMatchObject({ state: 'dnf', finishedOn: '2023-04-20' })
  })
  it('keeps a DNF with a date range as a DNF read', () => {
    const { plan } = importText(sg + 'Good Omens,Terry Pratchett,did-not-finish,,2023/04/02-2023/04/20\n')
    expect(plan.data.reads).toEqual([expect.objectContaining({ state: 'dnf', startedOn: '2023-04-02', finishedOn: '2023-04-20' })])
  })
  it('keeps earlier finished reads before the one set aside', () => {
    const { plan } = importText(sg + 'Good Omens,Terry Pratchett,did-not-finish,,"2019/01/01-2019/01/09, 2023/04/02-2023/04/20"\n')
    expect(plan.data.reads.map((r) => r.state)).toEqual(['finished', 'dnf'])
  })
  it('gives a paused read a start but no finish', () => {
    const { plan } = importText(sg + 'Middlemarch,George Eliot,paused,2024/05/01,2024/03/01-2024/05/01\n')
    expect(plan.data.entries[0].status).toBe('paused')
    expect(plan.data.reads).toEqual([expect.objectContaining({ state: 'paused', startedOn: '2024-03-01', finishedOn: undefined })])
  })
  it('reads the StoryGraph fixture’s DNF as a DNF', () => {
    const r = run('storygraph.csv')
    const omens = r.plan.data.entries[1]
    expect(r.plan.data.reads.filter((x) => x.entryId === omens.id).map((x) => x.state)).toEqual(['dnf'])
  })
})

describe('dates', () => {
  afterEach(() => { vi.useRealTimers() })
  it('reads written-out dates on the calendar they were written in', () => {
    const { plan } = importText('Title,Author,Date Read\nDune,Frank Herbert,"March 4, 2021"\n')
    expect(plan.data.reads[0].finishedOn).toBe('2021-03-04')
  })
  it('puts two-digit years in the right century', () => {
    vi.setSystemTime(new Date(2026, 5, 1, 12))
    const { plan } = importText('Title,Author,Date Read\nA,Ann Author,12/31/99\nB,Bea Author,03/14/21\nC,Cy Author,01/02/27\nD,Di Author,01/02/28\n')
    expect(plan.data.reads.map((r) => r.finishedOn)).toEqual(['1999-12-31', '2021-03-14', '2027-01-02', '1928-01-02'])
  })
})

describe('cells that look like formulas', () => {
  it('unwraps only Goodreads’ ="…" and our own apostrophe', () => {
    expect(unwrap('="0618260307"')).toBe('0618260307')
    expect(unwrap('=""')).toBe('')
    expect(unwrap('=SUM(A1)')).toBe('=SUM(A1)')
    expect(unwrap('= the equals sign')).toBe('= the equals sign')
    expect(unwrap("'=HYPERLINK(\"x\")")).toBe('=HYPERLINK("x")')
    expect(unwrap("'+44 notes")).toBe('+44 notes')
    expect(unwrap("'Salem's Lot")).toBe("'Salem's Lot")
  })
})

describe('series in the title', () => {
  it.each([
    ['Catching Fire (The Hunger Games, #2)', 'Catching Fire', 'The Hunger Games', 2],
    ['Catching Fire (The Hunger Games #2)', 'Catching Fire', 'The Hunger Games', 2],
    ['Dune Messiah (Dune Chronicles)', 'Dune Messiah', 'Dune Chronicles', undefined],
    ['The Lord of the Rings (Illustrated Edition)', 'The Lord of the Rings (Illustrated Edition)', undefined, undefined],
  ])('%s', (input, title, series, seriesIndex) => expect(splitSeries(input)).toEqual({ title, ...(series ? { series, seriesIndex } : {}) }))

  it('takes a bare "(Series)" as the series in a Goodreads-style file', () => {
    const { plan } = importText('Title,Author\nDune Messiah (Dune Chronicles),Frank Herbert\n')
    expect(plan.data.works[0]).toMatchObject({ title: 'Dune Messiah', series: 'Dune Chronicles' })
  })
})

describe('Folio’s full CSV headers', () => {
  it('map to their own fields', () => {
    const { cols } = importText('Title,Series,Series #,Status,Your rating,Read #,Read state,Started,Finished,Read rating,Format,Audio length (min),Edition published,Read notes\nDune,,,,,,,,,,,,,\n')
    const f = (h: string) => cols.find((c) => c.header === h)?.field
    expect([f('Series'), f('Series #'), f('Status'), f('Read state'), f('Read rating'), f('Your rating'), f('Edition published'), f('Format'), f('Audio length (min)'), f('Read notes'), f('Read #')])
      .toEqual(['series', 'seriesIndex', 'status', 'readState', 'readRating', 'rating', 'published', 'format', 'duration', 'readNotes', 'ignore'])
  })
  it('groups a book’s rows into one book with several reads', () => {
    const { plan } = importText([
      'Title,Authors,Status,Your rating,Read state,Started,Finished,Read rating,Format,ISBN-13',
      'Piranesi,Susanna Clarke,Read,,finished,2021-02-10,2021-02-20,4,Paperback,9781635575637',
      'Piranesi,Susanna Clarke,Read,,finished,2024-06-01,2024-06-09,5,Audiobook,9781635576214',
      'Kindred,Octavia E. Butler,Want to read,,,,,,Paperback,',
    ].join('\n'))
    expect(plan.data.entries).toHaveLength(2)
    expect(plan.added).toBe(2)
    const reads = plan.data.reads.filter((r) => r.entryId === plan.data.entries[0].id)
    expect(reads.map((r) => [r.finishedOn, r.rating])).toEqual([['2021-02-20', 4], ['2024-06-09', 5]])
    const eds = new Map(plan.data.editions.map((e) => [e.id, e]))
    expect(reads.map((r) => eds.get(r.editionId!)?.format)).toEqual(['paperback', 'audiobook'])
    expect(plan.data.reads.filter((r) => r.entryId === plan.data.entries[1].id)).toHaveLength(0)
  })
})
