import type { Edition, Entry, Format, Read, Shelf, Snapshot, Status, Work } from './types'
import { findCandidates } from './match'
import { cleanIsbn, nowIso, uid } from './util'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

const BINDING: [RegExp, Format][] = [
  [/audio|audible|mp3|cd/i, 'audiobook'],
  [/kindle|ebook|e-book|nook|digital/i, 'ebook'],
  [/hard/i, 'hardcover'],
  [/paper|mass market/i, 'paperback'],
]

const EXCLUSIVE: Record<string, Status> = {
  read: 'read', 'currently-reading': 'reading', 'to-read': 'want',
  'did-not-finish': 'dnf', dnf: 'dnf', abandoned: 'dnf', 'on-hold': 'paused', paused: 'paused',
}

const gDate = (s?: string) => {
  const m = s?.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined
}

export interface ImportResult {
  data: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'shelves'>
  added: number
  matched: number
  skipped: number
}

export function importGoodreads(
  csv: string,
  existing: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'shelves'>,
): ImportResult {
  const rows = parseCsv(csv)
  const header = rows.shift()?.map((h) => h.trim()) ?? []
  const col = (name: string) => header.indexOf(name)
  if (col('Title') < 0 || col('Author') < 0) throw new Error("This doesn't look like a Goodreads export (no Title/Author columns).")
  const get = (r: string[], name: string) => {
    const i = col(name)
    return i >= 0 ? (r[i] ?? '').replace(/^="?|"$/g, '').trim() : ''
  }

  const works = [...existing.works]
  const editions = [...existing.editions]
  const haveEntry = new Set(existing.entries.map((e) => e.workId))
  const shelfByName = new Map(existing.shelves.map((s) => [s.name.toLowerCase(), s]))
  const out: ImportResult['data'] = { works: [], editions: [], entries: [], reads: [], shelves: [] }
  let added = 0, matched = 0, skipped = 0

  for (const r of rows) {
    const rawTitle = get(r, 'Title')
    if (!rawTitle) continue
    const seriesM = rawTitle.match(/\(([^()]+?),?\s*#(\d+(?:\.\d+)?)\)\s*$/)
    const title = rawTitle.replace(/\s*\([^()]*#[^()]*\)\s*$/, '').trim()
    const authors = [get(r, 'Author'), ...get(r, 'Additional Authors').split(',')].map((a) => a.trim()).filter(Boolean)
    const isbn13 = cleanIsbn(get(r, 'ISBN13'))
    const isbn10 = cleanIsbn(get(r, 'ISBN'))
    const binding = get(r, 'Binding')
    const format = BINDING.find(([re]) => re.test(binding))?.[1] ?? 'paperback'
    const pages = parseInt(get(r, 'Number of Pages'), 10) || undefined

    const cands = findCandidates({ title, authors, isbn: isbn13 ?? isbn10 }, works, editions, 1)
    const hit = cands[0] && (cands[0].sameEdition || cands[0].score >= 0.93) ? cands[0] : undefined
    let work: Work
    let edition: Edition | undefined = hit?.sameEdition
    if (hit) {
      work = hit.work
      matched++
    } else {
      work = {
        id: uid(), title, authors: authors.length ? authors : ['Unknown'], genres: [],
        series: seriesM?.[1].trim(), seriesIndex: seriesM ? parseFloat(seriesM[2]) : undefined,
        firstPublished: parseInt(get(r, 'Original Publication Year'), 10) || undefined, createdAt: nowIso(),
      }
      works.push(work)
      out.works.push(work)
      added++
    }
    if (haveEntry.has(work.id)) { skipped++; continue }
    if (!edition) {
      edition = hit?.editions.find((e) => e.format === format && (!pages || e.pages === pages))
    }
    if (!edition) {
      edition = {
        id: uid(), workId: work.id, format, publisher: get(r, 'Publisher') || undefined,
        publishedDate: get(r, 'Year Published') || undefined,
        isbn13, isbn10: isbn10?.length === 10 ? isbn10 : undefined,
        pages: format === 'audiobook' ? undefined : pages, narrators: [], translators: [], createdAt: nowIso(),
        // Goodreads exports no covers; Open Library serves them by ISBN.
        coverUrl: isbn13 ?? isbn10 ? `https://covers.openlibrary.org/b/isbn/${isbn13 ?? isbn10}-L.jpg?default=false` : undefined,
      }
      editions.push(edition)
      out.editions.push(edition)
    }

    const shelfNames = get(r, 'Bookshelves').split(',').map((s) => s.trim()).filter(Boolean)
    const excl = get(r, 'Exclusive Shelf')
    const status: Status = EXCLUSIVE[excl] ?? 'want'
    const shelfIds: string[] = []
    for (const name of shelfNames) {
      if (EXCLUSIVE[name] || name === excl) continue
      let s = shelfByName.get(name.toLowerCase())
      if (!s) {
        s = { id: uid(), name: name.replace(/-/g, ' '), position: shelfByName.size } satisfies Shelf
        shelfByName.set(name.toLowerCase(), s)
        out.shelves.push(s)
      }
      shelfIds.push(s.id)
    }
    const rating = parseInt(get(r, 'My Rating'), 10) || undefined
    const addedOn = gDate(get(r, 'Date Added'))
    const entry: Entry = {
      id: uid(), workId: work.id, editionId: edition.id, status, rating,
      review: get(r, 'My Review').replace(/<br\s*\/?>/g, '\n') || undefined, favorite: false,
      owned: parseInt(get(r, 'Owned Copies'), 10) > 0, tags: [], shelfIds,
      addedAt: addedOn ? addedOn + 'T12:00:00Z' : nowIso(), updatedAt: nowIso(),
    }
    out.entries.push(entry)
    haveEntry.add(work.id)

    const readCount = Math.max(status === 'read' ? 1 : 0, parseInt(get(r, 'Read Count'), 10) || 0)
    const finished = gDate(get(r, 'Date Read'))
    // Goodreads only keeps the latest date; earlier rereads are recorded undated.
    for (let i = 0; i < readCount; i++) {
      const last = i === readCount - 1
      out.reads.push({
        id: uid(), entryId: entry.id, editionId: edition.id, state: 'finished',
        finishedOn: last ? finished : undefined, rating: last ? rating : undefined,
      } satisfies Read)
    }
    if (status === 'reading' || status === 'dnf' || status === 'paused') {
      out.reads.push({ id: uid(), entryId: entry.id, editionId: edition.id, state: status === 'reading' ? 'reading' : status, startedOn: addedOn })
    }
  }
  return { data: out, added, matched, skipped }
}
