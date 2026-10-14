import type { Edition, Entry, LogPoint, Read, Shelf, Snapshot, Work } from './types'
import { mediumOf } from './types'
import { nowIso, uid } from './util'

/** A realistic demo library so the stats pages have something to show. */

type B = [title: string, author: string, year: number, pages: number, isbn: string, genres: string, audioMin?: number, extra?: Partial<Work>]
const BOOKS: B[] = [
  ['Piranesi', 'Susanna Clarke', 2020, 272, '9781635575637', 'Fantasy', 500],
  ['Project Hail Mary', 'Andy Weir', 2021, 476, '9780593135204', 'Science Fiction', 970],
  ['The Remains of the Day', 'Kazuo Ishiguro', 1989, 258, '9780679731726', 'Literary Fiction'],
  ['Klara and the Sun', 'Kazuo Ishiguro', 2021, 303, '9780593318171', 'Literary Fiction,Science Fiction'],
  ['Sapiens', 'Yuval Noah Harari', 2011, 443, '9780062316097', 'History,Nonfiction', 917, { subtitle: 'A Brief History of Humankind' }],
  ['Dune', 'Frank Herbert', 1965, 658, '9780441172719', 'Science Fiction', 1262, { series: 'Dune', seriesIndex: 1 }],
  ['The Hobbit', 'J.R.R. Tolkien', 1937, 310, '9780547928227', 'Fantasy,Classics', 682],
  ['Educated', 'Tara Westover', 2018, 334, '9780399590504', 'Memoir,Nonfiction', 730],
  ['Tomorrow, and Tomorrow, and Tomorrow', 'Gabrielle Zevin', 2022, 401, '9780593321201', 'Literary Fiction'],
  ['The Overstory', 'Richard Powers', 2018, 502, '9780393635522', 'Literary Fiction'],
  ['Circe', 'Madeline Miller', 2018, 393, '9780316556347', 'Fantasy,Mythology', 728],
  ['A Gentleman in Moscow', 'Amor Towles', 2016, 462, '9780670026197', 'Historical Fiction'],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 2011, 499, '9780374533557', 'Psychology,Nonfiction', 1202],
  ['The Name of the Wind', 'Patrick Rothfuss', 2007, 662, '9780756404741', 'Fantasy', undefined, { series: 'The Kingkiller Chronicle', seriesIndex: 1 }],
  ['Never Let Me Go', 'Kazuo Ishiguro', 2005, 288, '9781400078776', 'Literary Fiction'],
  ['Atomic Habits', 'James Clear', 2018, 320, '9780735211292', 'Self Help,Nonfiction', 335],
  ['The Midnight Library', 'Matt Haig', 2020, 304, '9780525559474', 'Fiction,Fantasy'],
  ['Station Eleven', 'Emily St. John Mandel', 2014, 333, '9780804172448', 'Science Fiction,Literary Fiction'],
  ['Babel', 'R. F. Kuang', 2022, 545, '9780063021426', 'Fantasy,Historical Fiction', undefined, { subtitle: 'An Arcane History' }],
  ['The Left Hand of Darkness', 'Ursula K. Le Guin', 1969, 304, '9780441478125', 'Science Fiction,Classics'],
  ['Normal People', 'Sally Rooney', 2018, 273, '9781984822178', 'Literary Fiction,Romance'],
  ['The Martian', 'Andy Weir', 2011, 369, '9780553418026', 'Science Fiction', 653],
  ['Born a Crime', 'Trevor Noah', 2016, 304, '9780399588174', 'Memoir,Nonfiction', 524],
  ['Lessons in Chemistry', 'Bonnie Garmus', 2022, 390, '9780385547345', 'Historical Fiction'],
  ['The Three-Body Problem', 'Cixin Liu', 2008, 400, '9780765382030', 'Science Fiction', undefined, { originalLanguage: 'Chinese' }],
  ['Demon Copperhead', 'Barbara Kingsolver', 2022, 548, '9780063251922', 'Literary Fiction'],
  ['Intermezzo', 'Sally Rooney', 2024, 448, '9780374602635', 'Literary Fiction'],
  ['The Anxious Generation', 'Jonathan Haidt', 2024, 385, '9780593655030', 'Psychology,Nonfiction', 660],
  ['The Covenant of Water', 'Abraham Verghese', 2023, 724, '9780802162175', 'Literary Fiction,Historical Fiction'],
  ['James', 'Percival Everett', 2024, 303, '9780385550369', 'Literary Fiction'],
  ['Orbital', 'Samantha Harvey', 2023, 207, '9780802161543', 'Literary Fiction'],
  ['The Wager', 'David Grann', 2023, 352, '9780385534260', 'History,Nonfiction', 815],
  ['Yellowface', 'R. F. Kuang', 2023, 336, '9780063250833', 'Fiction'],
  ['The Bee Sting', 'Paul Murray', 2023, 656, '9780374600303', 'Literary Fiction'],
  ['North Woods', 'Daniel Mason', 2023, 384, '9780593597033', 'Historical Fiction'],
  ['All Fours', 'Miranda July', 2024, 336, '9780593190258', 'Fiction'],
  ['Wolf Hall', 'Hilary Mantel', 2009, 653, '9780312429980', 'Historical Fiction'],
  ['Pachinko', 'Min Jin Lee', 2017, 496, '9781455563920', 'Historical Fiction'],
  ['Kindred', 'Octavia E. Butler', 1979, 264, '9780807083697', 'Science Fiction,Classics'],
  ['The Goldfinch', 'Donna Tartt', 2013, 771, '9780316055437', 'Literary Fiction'],
]

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => iso(new Date(Date.parse(s) + n * 86400000))

/**
 * Reading plan: [bookIndex, kind, startOffsetDays-from-2023-01-05, durationDays, rating]
 * kind: p = print, a = audio
 */
const PLAN: [number, 'p' | 'a', number, number, number][] = [
  [6, 'p', 0, 9, 4.5], [2, 'p', 14, 12, 5], [21, 'a', 30, 10, 4], [11, 'p', 48, 26, 4.5], [7, 'a', 80, 14, 4.5],
  [19, 'p', 110, 16, 4], [14, 'p', 140, 9, 4.5], [24, 'p', 170, 21, 3.5], [16, 'p', 205, 6, 3], [4, 'a', 230, 19, 4],
  [17, 'p', 262, 11, 4.5], [5, 'p', 300, 34, 5],
  [0, 'p', 370, 5, 5], [1, 'a', 382, 15, 5], [20, 'p', 404, 7, 3.5], [10, 'a', 420, 13, 4.5], [8, 'p', 445, 18, 5],
  [22, 'a', 470, 9, 4.5], [3, 'p', 500, 12, 4], [13, 'p', 530, 40, 4], [15, 'a', 590, 6, 3.5], [23, 'p', 620, 14, 4],
  [25, 'p', 660, 25, 4.5], [6, 'a', 700, 10, 5],
  [26, 'p', 735, 17, 4], [12, 'p', 760, 8, 4.5], [27, 'a', 790, 12, 4], [0, 'a', 812, 7, 5], [18, 'p', 830, 22, 4.5],
  [29, 'p', 860, 9, 5], [31, 'a', 880, 18, 4.5], [5, 'a', 912, 24, 5], [30, 'p', 945, 8, 4], [32, 'p', 965, 14, 4],
  [4, 'p', 990, 30, 4], [9, 'p', 1030, 0, 0], [33, 'p', 1050, 16, 4.5], [24, 'a', 1070, 12, 4], [34, 'p', 1100, 12, 4],
  [35, 'p', 1120, 8, 4.5],
]

export function sampleLibrary(): Partial<Snapshot> {
  const r = rng(42)
  const works: Work[] = []
  const editions: Edition[] = []
  const entries: Entry[] = []
  const reads: Read[] = []
  const logs: LogPoint[] = []
  const t = nowIso()

  const printEd: Edition[] = []
  const audioEd: (Edition | undefined)[] = []
  for (const [title, author, year, pages, isbn, genres, audio, extra] of BOOKS) {
    const w: Work = { id: uid(), title, authors: [author], firstPublished: year, genres: genres.split(','), createdAt: t, ...extra }
    works.push(w)
    const cover = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
    const pe: Edition = { id: uid(), workId: w.id, format: r() > 0.5 ? 'paperback' : 'hardcover', pages, isbn13: isbn, narrators: [], translators: extra?.originalLanguage ? ['Ken Liu'] : [], coverUrl: cover, createdAt: t }
    editions.push(pe)
    printEd.push(pe)
    if (audio) {
      const ae: Edition = { id: uid(), workId: w.id, format: 'audiobook', durationMin: audio, narrators: ['Narrator'], translators: [], coverUrl: cover, createdAt: t }
      editions.push(ae)
      audioEd.push(ae)
    } else audioEd.push(undefined)
  }

  const shelves: Shelf[] = [
    { id: uid(), name: 'All-time favourites', emoji: '✦', position: 0 },
    { id: uid(), name: 'Book club', emoji: '☕', position: 1 },
  ]
  const entryFor = new Map<number, Entry>()
  // Anchor the plan so the most recent reads land a few weeks before today.
  const base = Date.now() - 1165 * 86400000
  const todayIso = iso(new Date())
  for (const [bi, kind, off, dur, rating] of PLAN) {
    const ed = kind === 'a' ? audioEd[bi] ?? printEd[bi] : printEd[bi]
    let entry = entryFor.get(bi)
    if (!entry) {
      entry = {
        id: uid(), workId: works[bi].id, editionId: printEd[bi].id, status: 'read', favorite: rating === 5 && r() > 0.4,
        owned: kind === 'p', tags: [], shelfIds: rating === 5 ? [shelves[0].id] : r() > 0.85 ? [shelves[1].id] : [],
        addedAt: new Date(base + (off - 20) * 86400000).toISOString(), updatedAt: t,
      }
      entryFor.set(bi, entry)
      entries.push(entry)
    }
    const startedOn = iso(new Date(base + off * 86400000))
    if (startedOn > todayIso) continue
    if (!dur) {
      entry.status = 'dnf'
      reads.push({ id: uid(), entryId: entry.id, editionId: ed.id, state: 'dnf', startedOn, progress: 140 })
      continue
    }
    const finishedOn = addDays(startedOn, dur - 1)
    const done = finishedOn <= todayIso
    const read: Read = {
      id: uid(), entryId: entry.id, editionId: ed.id, state: done ? 'finished' : 'reading', startedOn,
      finishedOn: done ? finishedOn : undefined, rating: done ? rating : undefined,
    }
    reads.push(read)
    if (!done) entry.status = 'reading'
    else entry.rating = rating
    // Daily progress logs.
    const total = ed.format === 'audiobook' ? ed.durationMin! : ed.pages!
    let left = total
    for (let d = 0; d < dur && left > 0; d++) {
      const day = addDays(startedOn, d)
      if (day > todayIso) break
      if (r() < 0.18 && d < dur - 1) continue
      const amt = d === dur - 1 ? left : Math.min(left, Math.round((total / dur) * (0.5 + r() * 1.1)))
      left -= amt
      logs.push({ id: uid(), readId: read.id, on: day, amount: amt, medium: mediumOf(ed.format) })
    }
    if (!done) read.progress = total - left
  }

  // Currently reading + want-to-read.
  const now = new Date()
  const cur = (bi: number, audio: boolean, progress: number, daysAgo: number) => {
    const ed = audio ? audioEd[bi]! : printEd[bi]
    const e: Entry = { id: uid(), workId: works[bi].id, editionId: ed.id, status: 'reading', favorite: false, owned: !audio, tags: [], shelfIds: [], addedAt: t, updatedAt: t }
    entries.push(e)
    const rd: Read = { id: uid(), entryId: e.id, editionId: ed.id, state: 'reading', startedOn: iso(new Date(now.getTime() - daysAgo * 86400000)), progress }
    reads.push(rd)
    for (let d = daysAgo; d >= 0; d--) {
      if (r() < 0.25) continue
      logs.push({ id: uid(), readId: rd.id, on: iso(new Date(now.getTime() - d * 86400000)), amount: Math.round(progress / (daysAgo + 1) * (0.6 + r() * 0.8)), medium: audio ? 'audio' : 'print' })
    }
  }
  cur(28, false, 212, 9)
  const tfs = entries.find((e) => e.workId === works[12].id)
  if (tfs) {
    tfs.status = 'reading'
    tfs.editionId = audioEd[12]!.id
    const rd: Read = { id: uid(), entryId: tfs.id, editionId: audioEd[12]!.id, state: 'reading', startedOn: iso(new Date(now.getTime() - 6 * 86400000)), progress: 540 }
    reads.push(rd)
    for (let d = 6; d >= 0; d--) logs.push({ id: uid(), readId: rd.id, on: iso(new Date(now.getTime() - d * 86400000)), amount: 60 + Math.round(r() * 40), medium: 'audio' })
  }
  for (const [i, w] of works.entries()) {
    if (!entries.some((e) => e.workId === w.id)) {
      entries.push({ id: uid(), workId: w.id, editionId: printEd[i].id, status: 'want', favorite: false, owned: r() > 0.6, tags: [], shelfIds: [], addedAt: t, updatedAt: t })
    }
  }
  return { works, editions, entries, reads, logs, shelves }
}
