import { coreTitle, findCandidates, fold } from './match'
import { nameCase, titleCase } from './titleCase'
import { MOODS, type Edition, type Entry, type Format, type Read, type ReadState, type Shelf, type Snapshot, type Status, type Work } from './types'
import { cleanIsbn, isbn10to13, localIso, nowIso, parseDuration, uid } from './util'

/**
 * Imports a CSV export from any reading app (Goodreads, StoryGraph,
 * LibraryThing, Hardcover, Bookly, a hand-made spreadsheet…).
 *
 * 1. parse   – sniff the delimiter, handle quotes and Excel's ="…" wrappers
 * 2. map     – match each column to a Folio field by header name (with
 *              synonyms) and, failing that, by what the values look like
 * 3. values  – translate statuses, formats, rating scales and date orders
 * 4. build   – create works/editions/entries/reads, matching books already
 *              in the catalogue instead of duplicating them
 *
 * Steps 2 and 3 return suggestions the person can correct before importing.
 */

// ── 1. Parse ───────────────────────────────────────────────────────────────

export function parseTable(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '')
  const nl = clean.indexOf('\n')
  const firstLine = nl < 0 ? clean : clean.slice(0, nl)
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const)
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (q) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()))
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim())
  return { headers, rows: nonEmpty.map((r) => r.map(unwrap)) }
}

/**
 * Goodreads writes ISBNs as ="0123456789" so Excel keeps leading zeros: unwrap exactly that.
 * Folio's exports put an apostrophe before a cell starting with = + - @ so spreadsheets
 * don't run it as a formula: take that off again. Anything else is left as written.
 */
export const unwrap = (v: string) => {
  const m = v.match(/^="(.*)"$/s)
  return (m ? m[1] : v.replace(/^'(?=[=+\-@\t\r])/, '')).trim()
}

// ── 2. Map columns ─────────────────────────────────────────────────────────

export type FieldId =
  | 'ignore' | 'title' | 'subtitle' | 'authors' | 'authorsLastFirst' | 'additionalAuthors' | 'contributors'
  | 'narrators' | 'translators' | 'isbn' | 'isbn13' | 'isbn10' | 'asin' | 'publisher' | 'pages' | 'duration'
  | 'published' | 'firstPublished' | 'format' | 'status' | 'rating' | 'review' | 'notes' | 'dateAdded'
  | 'dateStarted' | 'dateFinished' | 'datesRead' | 'readCount' | 'shelves' | 'tags' | 'owned' | 'favorite'
  | 'series' | 'seriesIndex' | 'genres' | 'language' | 'moods' | 'pace' | 'readState' | 'readRating' | 'readNotes'

export const FIELDS: { id: FieldId; label: string; multi?: boolean }[] = [
  { id: 'ignore', label: 'Don’t import' },
  { id: 'title', label: 'Title' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'authors', label: 'Author(s)' },
  { id: 'authorsLastFirst', label: 'Author (Last, First)' },
  { id: 'additionalAuthors', label: 'Additional authors', multi: true },
  { id: 'contributors', label: 'Contributors (with roles)' },
  { id: 'narrators', label: 'Narrator(s)' },
  { id: 'translators', label: 'Translator(s)' },
  { id: 'series', label: 'Series' },
  { id: 'seriesIndex', label: 'Number in series' },
  { id: 'isbn', label: 'ISBN (either)' },
  { id: 'isbn13', label: 'ISBN-13' },
  { id: 'isbn10', label: 'ISBN-10' },
  { id: 'asin', label: 'ASIN' },
  { id: 'format', label: 'Format' },
  { id: 'pages', label: 'Pages' },
  { id: 'duration', label: 'Audiobook length' },
  { id: 'publisher', label: 'Publisher' },
  { id: 'published', label: 'Edition published' },
  { id: 'firstPublished', label: 'First published' },
  { id: 'language', label: 'Language' },
  { id: 'genres', label: 'Genres', multi: true },
  { id: 'status', label: 'Status / pile' },
  { id: 'rating', label: 'Your rating' },
  { id: 'review', label: 'Review', multi: true },
  { id: 'notes', label: 'Private notes', multi: true },
  { id: 'dateAdded', label: 'Date added' },
  { id: 'dateStarted', label: 'Date started' },
  { id: 'dateFinished', label: 'Date finished' },
  { id: 'datesRead', label: 'All read dates (ranges)' },
  { id: 'readCount', label: 'Times read' },
  { id: 'readState', label: 'This read: state' },
  { id: 'readRating', label: 'This read: rating' },
  { id: 'readNotes', label: 'This read: notes' },
  { id: 'shelves', label: 'Shelves', multi: true },
  { id: 'tags', label: 'Tags', multi: true },
  { id: 'moods', label: 'Moods', multi: true },
  { id: 'pace', label: 'Pace' },
  { id: 'owned', label: 'Owned' },
  { id: 'favorite', label: 'Favourite' },
]

// "#" means number: "Series #" must not read as "Series".
const norm = (h: string) => h.toLowerCase().replace(/#/g, 'number').replace(/[^a-z0-9]/g, '')

// Headers we know are *not* the reader's own data, however close they look.
const NEVER = new Set(['averagerating', 'avgrating', 'bookid', 'id', 'goodreadsid', 'workid', 'uid', 'numratings', 'ratingscount',
  'bookshelveswithpositions', 'spoiler', 'readingposition', 'cover', 'coverurl', 'url', 'link', 'price', 'value',
  'readnumber']) // Folio's "Read #": the order is in the dates

const SYNONYMS: Record<Exclude<FieldId, 'ignore'>, string[]> = {
  title: ['title', 'booktitle', 'name', 'bookname', 'titlename', 'book', 'work'],
  subtitle: ['subtitle'],
  authors: ['author', 'authors', 'authorname', 'authornames', 'primaryauthor', 'writer', 'writers', 'by', 'creator', 'creators'],
  authorsLastFirst: ['authorlf', 'authorlastfirst', 'sortauthor', 'authorsort', 'lastfirst'],
  additionalAuthors: ['additionalauthors', 'secondaryauthor', 'secondaryauthors', 'coauthor', 'coauthors', 'otherauthors'],
  contributors: ['contributors', 'contributor', 'otherpeople'],
  narrators: ['narrator', 'narrators', 'readby', 'performedby'],
  translators: ['translator', 'translators', 'translatedby'],
  series: ['series', 'seriesname', 'seriestitle'],
  seriesIndex: ['seriesnumber', 'seriesindex', 'numberinseries', 'seriesposition', 'volume', 'vol', 'booknumber', 'seriesno', 'seriesnum'],
  isbn: ['isbn', 'isbnuid', 'isbnorasin', 'isbns'],
  isbn13: ['isbn13', 'ean', 'ean13'],
  isbn10: ['isbn10'],
  asin: ['asin', 'kindleasin', 'audibleasin'],
  format: ['binding', 'format', 'bookformat', 'editionformat', 'media', 'mediatype', 'type', 'edition'],
  pages: ['numberofpages', 'pages', 'pagecount', 'numpages', 'totalpages', 'pagestotal'],
  duration: ['duration', 'listeninglength', 'runtime', 'audiolength', 'audiolengthmin', 'audioduration', 'lengthinminutes', 'minutes', 'hours'],
  publisher: ['publisher', 'publishername', 'imprint', 'publishers'],
  published: ['yearpublished', 'editionpublished', 'publicationdate', 'published', 'pubdate', 'datepublished', 'publicationyear', 'editionyear', 'releasedate', 'year'],
  firstPublished: ['originalpublicationyear', 'firstpublished', 'originalyear', 'originalpublicationdate', 'firstpublicationyear', 'yearfirstpublished'],
  language: ['language', 'lang', 'languages'],
  genres: ['genres', 'genre', 'categories', 'category', 'subjects', 'subject'],
  status: ['exclusiveshelf', 'readstatus', 'status', 'readingstatus', 'shelf', 'state', 'progress', 'list'],
  rating: ['myrating', 'rating', 'starrating', 'stars', 'yourrating', 'score', 'userrating', 'myscore'],
  review: ['myreview', 'review', 'reviews', 'reviewtext', 'comment', 'comments'],
  notes: ['privatenotes', 'notes', 'note', 'mynotes', 'personalnotes'],
  dateAdded: ['dateadded', 'added', 'addeddate', 'createdat', 'datecreated', 'addedon', 'dateentered', 'entrydate'],
  dateStarted: ['datestarted', 'startdate', 'started', 'startedreading', 'startedon', 'startedat', 'datebegan'],
  dateFinished: ['dateread', 'datefinished', 'finished', 'finishdate', 'enddate', 'lastdateread', 'readdate', 'finishedon', 'finishedat', 'completed', 'datecompleted'],
  datesRead: ['datesread', 'readdates', 'readingdates', 'readhistory', 'readinghistory'],
  readCount: ['readcount', 'timesread', 'numberofreads', 'reads', 'rereads', 'readtimes'],
  shelves: ['bookshelves', 'shelves', 'collections', 'collection', 'lists', 'readinglists'],
  tags: ['tags', 'tag', 'labels', 'label', 'keywords'],
  owned: ['ownedcopies', 'owned', 'own', 'iown', 'owncopy', 'inlibrary', 'owned'],
  favorite: ['favorite', 'favourite', 'favorites', 'favourites', 'isfavorite'],
  moods: ['moods', 'mood', 'vibes', 'feel'],
  pace: ['pace', 'pacing', 'readingpace'],
  // Folio's full export has a row per read; these describe that one read.
  readState: ['readstate'],
  readRating: ['readrating'],
  readNotes: ['readnotes'],
}

const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/
const looks = {
  isbn: (v: string) => !!cleanIsbn(v),
  date: (v: string) => DATE_RE.test(v),
  smallNumber: (v: string) => /^\d+(\.\d+)?$/.test(v) && +v <= 10,
  duration: (v: string) => /\d+\s*h|\d+:\d{2}/i.test(v),
}

export interface ColumnGuess {
  index: number
  header: string
  samples: string[]
  field: FieldId
  confidence: 'high' | 'medium' | 'low'
}

export function guessColumns(headers: string[], rows: string[][]): ColumnGuess[] {
  const samplesOf = (i: number) => rows.map((r) => r[i] ?? '').filter((v) => v.trim()).slice(0, 200)
  const guesses: ColumnGuess[] = headers.map((header, index) => {
    const n = norm(header)
    const samples = samplesOf(index)
    let field: FieldId = 'ignore'
    let confidence: ColumnGuess['confidence'] = 'low'
    if (!NEVER.has(n)) {
      for (const [f, syn] of Object.entries(SYNONYMS) as [FieldId, string[]][]) {
        if (syn.includes(n)) { field = f; confidence = 'high'; break }
      }
      if (field === 'ignore') {
        for (const [f, syn] of Object.entries(SYNONYMS) as [FieldId, string[]][]) {
          if (syn.some((s) => s.length > 3 && n.includes(s))) { field = f; confidence = 'medium'; break }
        }
      }
      // "Length" could be pages or listening time: decide from the values.
      if (n === 'length' || n === 'size') {
        field = samples.some(looks.duration) ? 'duration' : 'pages'
        confidence = 'medium'
      }
    }
    // Header told us nothing: look at the values themselves.
    if (field === 'ignore' && !NEVER.has(n) && samples.length) {
      const share = (p: (v: string) => boolean) => samples.filter(p).length / samples.length
      if (share(looks.isbn) > 0.8) { field = 'isbn'; confidence = 'medium' }
    }
    return { index, header, samples: samples.slice(0, 3), field, confidence }
  })

  // A single-value field should come from one column: keep the strongest claim.
  const rank = { high: 3, medium: 2, low: 1 }
  const seen = new Map<FieldId, ColumnGuess>()
  for (const g of guesses) {
    if (g.field === 'ignore' || FIELDS.find((f) => f.id === g.field)?.multi) continue
    const prev = seen.get(g.field)
    if (!prev) seen.set(g.field, g)
    else if (rank[g.confidence] > rank[prev.confidence]) { prev.field = 'ignore'; seen.set(g.field, g) }
    else g.field = 'ignore'
  }
  // No obvious title column: use the first unclaimed column that holds ordinary text.
  if (!seen.has('title')) {
    const textCol = guesses.find((g) => g.field === 'ignore' && !NEVER.has(norm(g.header)) && g.samples.length &&
      g.samples.every((v) => /\p{L}/u.test(v) && !looks.date(v) && !looks.isbn(v)))
    if (textCol) { textCol.field = 'title'; textCol.confidence = 'low'; seen.set('title', textCol) }
  }
  // Goodreads ships both "Author" and "Author l-f"; one is enough.
  if (seen.has('authors') && seen.has('authorsLastFirst')) seen.get('authorsLastFirst')!.field = 'ignore'
  return guesses
}

export function detectSource(headers: string[]): string {
  const h = new Set(headers.map(norm))
  if (h.has('exclusiveshelf') && h.has('bookid')) return 'Goodreads'
  if (h.has('readstatus') && h.has('starrating')) return 'StoryGraph'
  if (h.has('primaryauthor') && h.has('collections')) return 'LibraryThing'
  return 'your spreadsheet'
}

// ── 3. Values ──────────────────────────────────────────────────────────────

/**
 * Statuses are matched on whole words, so a shelf called "antiquity" isn't taken for
 * "quit", nor "current-affairs" for "currently reading". `is` must be the whole value;
 * `has` may sit among other words ("to-read-2025", "dnf-pile").
 */
const STATUS_RULES: { is: string[]; has: string[]; status: Status }[] = [
  { status: 'dnf', is: ['stopped', 'quit'], has: ['did not finish', 'didnt finish', 'dnf', 'abandoned', 'abandon', 'gave up', 'unfinished', 'not finished', 'never finished'] },
  { status: 'paused', is: ['later', 'read later'], has: ['paused', 'pause', 'on hold', 'onhold', 'hiatus'] },
  { status: 'reading', is: ['reading', 'started', 'current', 'reading now', 'now reading', 'in progress'], has: ['currently reading', 'currently'] },
  { status: 'want', is: ['want', 'wish', 'unread', 'not started', 'plan', 'planned', 'queue', 'queued', 'up next', 'interested'],
    has: ['to read', 'toread', 'tbr', 'want to', 'wishlist', 'wish list', 'plan to read'] },
  { status: 'read', is: ['read', 'yes', 'done', 'complete', 'have read', 'already read'], has: ['finished', 'completed'] },
]
export const guessStatus = (v: string): Status | undefined => {
  const words = v.toLowerCase().replace(/[’']/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const all = ` ${words.join(' ')} `
  return STATUS_RULES.find((r) => r.is.includes(words.join(' ')) || r.has.some((p) => all.includes(` ${p} `)))?.status
}

/** One read's own state ("finished", "dnf"…), from Folio's full export or similar. */
const readStateOf = (v: string): ReadState | undefined => {
  const s = guessStatus(v)
  return s === 'read' ? 'finished' : s === 'want' ? undefined : s
}

const FORMAT_RULES: [RegExp, Format][] = [
  [/audio|audible|mp3|cd|listen/i, 'audiobook'],
  [/kindle|ebook|e-book|digital|nook|kobo|epub|pdf|electronic/i, 'ebook'],
  [/hard|cloth|library binding/i, 'hardcover'],
  [/paper|mass.?market|trade|soft/i, 'paperback'],
]
export const guessFormat = (v: string): Format | undefined => FORMAT_RULES.find(([re]) => re.test(v))?.[1]

export interface ValueMaps {
  status: Record<string, Status>
  format: Record<string, Format>
  /** Divide ratings by this to get stars out of 5. */
  ratingDivisor: number
  /** How to read ambiguous dates like 03/04/2021. */
  dateOrder: 'ymd' | 'mdy' | 'dmy'
}

export function guessValues(rows: string[][], cols: ColumnGuess[]): ValueMaps {
  const col = (f: FieldId) => cols.find((c) => c.field === f)
  const distinct = (c?: ColumnGuess) => [...new Set(c ? rows.map((r) => (r[c.index] ?? '').trim()).filter(Boolean) : [])]
  const status: Record<string, Status> = {}
  for (const v of distinct(col('status')).slice(0, 40)) status[v] = guessStatus(v) ?? 'want'
  const format: Record<string, Format> = {}
  for (const v of distinct(col('format')).slice(0, 40)) format[v] = guessFormat(v) ?? 'other'

  const ratings = distinct(col('rating')).map(parseFloat).filter((n) => Number.isFinite(n))
  const maxRating = Math.max(0, ...ratings)
  const ratingDivisor = maxRating > 10 ? 20 : maxRating > 5 ? 2 : 1

  // Date order: any first part > 12 means day-first; any second part > 12 means month-first.
  let dmy = 0, mdy = 0, ymd = 0
  for (const c of cols.filter((c) => ['dateAdded', 'dateStarted', 'dateFinished', 'datesRead', 'published'].includes(c.field))) {
    for (const v of distinct(c).slice(0, 400)) {
      for (const m of v.matchAll(/(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/g)) {
        if (m[1].length === 4) { ymd++; continue }
        if (+m[1] > 12) dmy++
        else if (+m[2] > 12) mdy++
      }
    }
  }
  const dateOrder = ymd >= dmy + mdy ? 'ymd' : dmy > mdy ? 'dmy' : 'mdy'
  return { status, format, ratingDivisor, dateOrder }
}

function parseDate(v: string, order: ValueMaps['dateOrder']): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  let m = t.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/)
  if (m) return [m[1], m[2].padStart(2, '0'), m[3]?.padStart(2, '0')].filter(Boolean).join('-')
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    const [a, b, y] = [m[1], m[2], m[3].length === 2 ? fullYear(+m[3]) : m[3]]
    const [mo, d] = order === 'dmy' ? [b, a] : [a, b]
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  m = t.match(/^(\d{4})$/)
  if (m) return m[1]
  // "March 4, 2021" parses as local midnight: read it back on the local calendar, not UTC's.
  const parsed = Date.parse(t)
  return Number.isFinite(parsed) ? localIso(new Date(parsed)) : undefined
}

/** Midday on that date where the reader is, so it's the same day on their calendar (even at UTC+14). */
const localNoon = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day, 12).toISOString() }

/** "12/31/99" is 1999, "03/04/21" is 2021: two-digit years up to next year are this century. */
function fullYear(yy: number): string {
  const now = new Date().getFullYear() % 100
  return String(yy > now + 1 ? 1900 + yy : 2000 + yy)
}

/** Fix casing only when the source clearly didn't care (all lower or all caps). */
const tidy = (s: string, f: (x: string) => string) =>
  s && (s === s.toLowerCase() || s === s.toUpperCase()) ? f(s) : s.trim()

const splitList = (v: string) => v.split(/\s*[;|]\s*|\s*,\s*/).map((s) => s.trim()).filter(Boolean)

/** "Smith, John" vs "John Smith, Jane Doe": split author lists sensibly. */
function splitAuthors(v: string): string[] {
  const parts = v.split(/\s*;\s*|\s*&\s*|\s+and\s+/).flatMap((p) => {
    const commas = p.split(/\s*,\s*/).filter(Boolean)
    // A lone surname followed by given names ("Tolkien, J.R.R.") is one person, last-first.
    if (commas.length === 2 && !/\s/.test(commas[0]) && commas[1].split(/\s+/).length <= 3) return [`${commas[1]} ${commas[0]}`]
    return commas
  })
  return parts.map((a) => tidy(a, nameCase)).filter(Boolean)
}

const truthy = (v: string) => /^(y|yes|true|1|x|owned|✓|✔)$/i.test(v.trim()) || parseInt(v, 10) > 0

// ── 4. Build ───────────────────────────────────────────────────────────────

export interface ImportPlan {
  data: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'shelves'>
  added: number
  matched: number
  skipped: number
  problems: string[]
}

export interface PreviewBook {
  title: string
  authors: string[]
  status: Status
  format: Format
  rating?: number
  finished?: string
  reads: number
}

// Edition notes Goodreads and others put in brackets after a title: not a series.
const NOT_SERIES = /\b(edition|ed\.|unabridged|abridged|illustrated|annotated|anniversary|reprint|revised|deluxe|paperback|hardcover|hardback|kindle|ebook|audiobook|audio|large print|boxed set|translated|translation|movie tie-in|classics?)\b/i

/**
 * Series often rides along in the title: "The Fellowship of the Ring (The Lord of the Rings, #1)",
 * "Catching Fire (The Hunger Games #2)", or without a number, "Dune Messiah (Dune Chronicles)".
 */
export function splitSeries(title: string): { title: string; series?: string; seriesIndex?: number } {
  const m = title.match(/\s*\(([^()]+?)(?:,?\s*#\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?)?\)\s*$/)
  if (!m || m.index == null || m.index === 0) return { title }
  const series = m[1].trim()
  if (!m[2] && (NOT_SERIES.test(series) || /"|:\/\//.test(series))) return { title }
  return { title: title.slice(0, m.index).trim(), series, seriesIndex: m[2] != null ? parseFloat(m[2]) : undefined }
}

export function buildImport(
  rows: string[][],
  cols: ColumnGuess[],
  values: ValueMaps,
  existing: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'shelves'>,
  opts: { limit?: number } = {},
): ImportPlan & { preview: PreviewBook[] } {
  const by = (f: FieldId) => cols.filter((c) => c.field === f)
  const one = (r: string[], f: FieldId) => { const c = by(f)[0]; return c ? (r[c.index] ?? '').trim() : '' }
  const many = (r: string[], f: FieldId) => by(f).map((c) => (r[c.index] ?? '').trim()).filter(Boolean)
  const date = (v: string) => parseDate(v, values.dateOrder)
  const stars = (v: string) => {
    const n = parseFloat(v)
    return n > 0 ? Math.min(5, Math.max(0.5, Math.round((n / values.ratingDivisor) * 2) / 2)) : undefined
  }

  // Index the catalogue so each row is compared with a handful of plausible
  // books (same ISBN, or a title starting the same way) rather than all of them.
  const bucket = (t: string) => coreTitle(t).replace(/\s/g, '').slice(0, 4)
  const byBucket = new Map<string, Work[]>()
  const editionsByWork = new Map<string, Edition[]>()
  const workByIsbn = new Map<string, Work>()
  const worksById = new Map(existing.works.map((w) => [w.id, w]))
  const addWork = (w: Work) => { const k = bucket(w.title); byBucket.set(k, [...(byBucket.get(k) ?? []), w]); worksById.set(w.id, w) }
  const addEdition = (e: Edition) => {
    editionsByWork.set(e.workId, [...(editionsByWork.get(e.workId) ?? []), e])
    const w = worksById.get(e.workId)
    if (w) for (const i of [e.isbn13, e.isbn10]) if (i) workByIsbn.set(i, w)
  }
  existing.works.forEach(addWork)
  existing.editions.forEach(addEdition)
  const haveEntry = new Set(existing.entries.map((e) => e.workId))
  const shelfByName = new Map(existing.shelves.map((s) => [s.name.toLowerCase(), s]))
  const out: ImportPlan['data'] = { works: [], editions: [], entries: [], reads: [], shelves: [] }
  const preview: PreviewBook[] = []
  const problems: string[] = []
  let added = 0, matched = 0, skipped = 0

  /** The edition a row describes (format, ISBN, pages…). */
  const editionOf = (r: string[]) => {
    const isbns = [one(r, 'isbn13'), one(r, 'isbn10'), one(r, 'isbn')].map((v) => cleanIsbn(v))
    const rawIsbn = isbns.find(Boolean)
    const isbn13 = rawIsbn?.length === 13 ? rawIsbn : rawIsbn ? isbn10to13(rawIsbn) : undefined
    const isbn10 = [isbns[1], isbns[2], isbns[0]].find((i) => i?.length === 10)
    // StoryGraph (and others) put Kindle ASINs in the ISBN column: keep them as ASINs.
    const asinInIsbn = [one(r, 'isbn'), one(r, 'isbn13'), one(r, 'isbn10')].map((v) => v.replace(/^="?|"$/g, '').trim().toUpperCase()).find((v) => /^B0[0-9A-Z]{8}$/.test(v))
    const asin = one(r, 'asin').toUpperCase() || asinInIsbn || undefined
    const fmtRaw = one(r, 'format')
    const format: Format = (fmtRaw && values.format[fmtRaw]) || (asin && !isbn13 ? 'ebook' : 'paperback')
    const durRaw = one(r, 'duration')
    const durationMin = durRaw ? (/^\d+(\.\d+)?$/.test(durRaw) && /hour/i.test(by('duration')[0]?.header ?? '') ? Math.round(+durRaw * 60) : parseDuration(durRaw)) : undefined
    const pages = parseInt(one(r, 'pages'), 10) || undefined
    return { isbn13, isbn10, asin, format, durationMin, pages }
  }
  const newEdition = (r: string[], workId: string, f: ReturnType<typeof editionOf>): Edition => {
    const narrators = many(r, 'narrators').flatMap(splitAuthors)
    const translators = many(r, 'translators').flatMap(splitAuthors)
    for (const c of many(r, 'contributors')) {
      for (const part of c.split(/\s*,\s*(?![^()]*\))/)) {
        const m = part.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
        const role = m?.[2].toLowerCase() ?? ''
        const name = tidy((m ? m[1] : part).trim(), nameCase)
        if (!name) continue
        if (role.includes('narrat') || role.includes('read')) narrators.push(name)
        else if (role.includes('translat')) translators.push(name)
      }
    }
    const e: Edition = {
      id: uid(), workId, format: f.format, publisher: one(r, 'publisher') ? tidy(one(r, 'publisher'), titleCase) : undefined,
      publishedDate: date(one(r, 'published')) ?? (one(r, 'published') || undefined),
      isbn13: f.isbn13, isbn10: f.isbn10, asin: f.asin, language: one(r, 'language') || undefined,
      pages: f.format === 'audiobook' ? undefined : f.pages, durationMin: f.format === 'audiobook' ? f.durationMin : undefined,
      narrators: [...new Set(narrators)], translators: [...new Set(translators)], createdAt: nowIso(),
      coverUrl: f.isbn13 ? `https://covers.openlibrary.org/b/isbn/${f.isbn13}-L.jpg?default=false` : undefined,
    }
    addEdition(e)
    out.editions.push(e)
    return e
  }

  const rangesOf = (r: string[]) => {
    const datesRead = many(r, 'datesRead').join(', ')
    return datesRead
      ? datesRead.split(/\s*,\s*/).map((seg) => {
        const ds = [...seg.matchAll(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g)].map((m) => date(m[0]))
        const open = /[-–]\s*$/.test(seg.trim())
        return ds.length >= 2 ? { start: ds[0], end: ds[1] } : open ? { start: ds[0], end: undefined } : { start: undefined, end: ds[0] }
      }).filter((x) => x.start || x.end)
      : []
  }
  const statusOf = (r: string[]): Status => {
    const raw = one(r, 'status')
    const fromRead = one(r, 'readState') ? readStateOf(one(r, 'readState')) : undefined
    return (raw && values.status[raw]) ||
      (fromRead ? (fromRead === 'finished' ? 'read' : fromRead) : undefined) ||
      (date(one(r, 'dateFinished')) || rangesOf(r).some((x) => x.end) ? 'read' : date(one(r, 'dateStarted')) ? 'reading' : 'want')
  }

  /** The reads one row describes. */
  const readsOf = (r: string[], status: Status, rating: number | undefined, entryId: string, editionId: string): Read[] => {
    const base = { entryId, editionId }
    const started = date(one(r, 'dateStarted'))
    const finished = date(one(r, 'dateFinished'))
    // A row that is one read (Folio's full export) says exactly what that read was.
    const state = one(r, 'readState') ? readStateOf(one(r, 'readState')) : undefined
    if (state) {
      return [{
        id: uid(), ...base, state, startedOn: started,
        finishedOn: state === 'finished' || state === 'dnf' ? finished : undefined,
        rating: by('readRating').length ? stars(one(r, 'readRating')) : state === 'finished' ? rating : undefined,
        notes: one(r, 'readNotes') || undefined,
      }]
    }
    const addedOn = date(one(r, 'dateAdded'))
    const ranges = rangesOf(r)
    // Set-aside (DNF) and paused books end in that state, never as a finished read.
    const halted = status === 'dnf' || status === 'paused' ? status : undefined
    const reads: Read[] = []
    // Explicit ranges first; otherwise one dated read plus undated rereads from the count.
    if (ranges.length) {
      ranges.forEach((x, i) => {
        const last = i === ranges.length - 1
        const st: ReadState = last && halted ? halted : x.end ? 'finished' : halted ?? 'reading'
        reads.push({
          id: uid(), ...base, state: st, startedOn: x.start,
          // A DNF read's end date is the day it was set aside; a paused one has none.
          finishedOn: st === 'paused' || st === 'reading' ? undefined : x.end,
          rating: last && st === 'finished' ? rating : undefined,
        })
      })
    } else if (halted) {
      reads.push({ id: uid(), ...base, state: halted, startedOn: started ?? (addedOn?.length === 10 ? addedOn : undefined), finishedOn: halted === 'dnf' ? finished : undefined })
    } else if (status === 'read' || finished) {
      const count = Math.max(1, parseInt(one(r, 'readCount'), 10) || 1)
      for (let i = 0; i < count - 1; i++) reads.push({ id: uid(), ...base, state: 'finished' })
      reads.push({ id: uid(), ...base, state: 'finished', startedOn: started, finishedOn: finished, rating })
    } else if (status === 'reading') {
      reads.push({ id: uid(), ...base, state: 'reading', startedOn: started ?? (addedOn?.length === 10 ? addedOn : undefined) })
    }
    return reads
  }

  // Rows for the same book (same ISBN, or same title and author) are one book read
  // several times: Folio's full export has a row per read. A row-per-book file is unaffected.
  const list = opts.limit ? rows.slice(0, opts.limit) : rows
  const groups: { at: number; rows: string[][] }[] = []
  const groupOf = new Map<string, (typeof groups)[number]>()
  list.forEach((r, at) => {
    const title = one(r, 'title')
    const isbn = title ? editionOf(r).isbn13 : undefined
    const author = [...many(r, 'authors'), ...many(r, 'authorsLastFirst')][0] ?? ''
    const keys = [isbn && `isbn:${isbn}`, title && `title:${fold(`${title} ${one(r, 'subtitle')}`)}|${fold(author)}`].filter((k): k is string => !!k)
    let g = keys.map((k) => groupOf.get(k)).find(Boolean)
    if (!g) groups.push((g = { at, rows: [] }))
    g.rows.push(r)
    for (const k of keys) if (!groupOf.has(k)) groupOf.set(k, g)
  })

  for (const { at: rowIdx, rows: group } of groups) {
    const r = group[0]
    let title = one(r, 'title')
    if (!title) { if (r.some((c) => c.trim())) problems.push(`Row ${rowIdx + 2}: no title, skipped`); continue }

    let series = one(r, 'series') || undefined
    let seriesIndex = parseFloat(one(r, 'seriesIndex')) || undefined
    // A bare "(Something)" only counts as the series when the file has no series column of its own.
    const sp = splitSeries(title)
    if (sp.series && (sp.seriesIndex != null || !by('series').length)) { series ??= sp.series; seriesIndex ??= sp.seriesIndex; title = sp.title }
    let subtitle = one(r, 'subtitle') || undefined
    if (!subtitle && title.includes(': ') && !by('subtitle').length) {
      const [main, ...rest] = title.split(': ')
      if (main.length > 1 && rest.join(': ').length > 2) { title = main; subtitle = rest.join(': ') }
    }
    title = tidy(title, titleCase)
    subtitle = subtitle && tidy(subtitle, titleCase)

    let authors = [
      ...many(r, 'authors').flatMap(splitAuthors),
      ...many(r, 'authorsLastFirst').map((a) => { const [l, f] = a.split(/\s*,\s*/); return tidy(f ? `${f} ${l}` : l, nameCase) }),
      ...many(r, 'additionalAuthors').flatMap(splitAuthors),
    ]
    for (const c of many(r, 'contributors')) {
      for (const part of c.split(/\s*,\s*(?![^()]*\))/)) {
        const m = part.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
        const name = tidy((m ? m[1] : part).trim(), nameCase)
        const role = m?.[2].toLowerCase() ?? ''
        if (name && (!role || role.includes('author'))) authors.push(name)
      }
    }
    authors = [...new Set(authors)]
    if (!authors.length) authors = ['Unknown']

    const ed = editionOf(r)
    const pool = new Set([...(byBucket.get(bucket(title)) ?? [])])
    const viaIsbn = (ed.isbn13 && workByIsbn.get(ed.isbn13)) || (ed.isbn10 && workByIsbn.get(ed.isbn10))
    if (viaIsbn) pool.add(viaIsbn)
    const poolWorks = [...pool]
    const cands = findCandidates({ title, subtitle, authors, isbn: ed.isbn13 ?? ed.isbn10, asin: ed.asin }, poolWorks, poolWorks.flatMap((w) => editionsByWork.get(w.id) ?? []), 1)
    const hit = cands[0] && (cands[0].sameEdition || cands[0].score >= 0.93) ? cands[0] : undefined
    let work: Work
    let edition: Edition | undefined = hit?.sameEdition
    if (hit) { work = hit.work; matched++ }
    else {
      const firstYear = parseInt(one(r, 'firstPublished'), 10) || parseInt(one(r, 'firstPublished').slice(-4), 10) || undefined
      work = {
        id: uid(), title, subtitle, authors, series: series && tidy(series, titleCase), seriesIndex,
        genres: many(r, 'genres').flatMap(splitList).map((g) => tidy(g, titleCase)).slice(0, 12),
        firstPublished: firstYear, createdAt: nowIso(),
      }
      addWork(work)
      out.works.push(work)
      added++
    }

    const statusRaw = one(r, 'status')
    let status = statusOf(r)

    if (haveEntry.has(work.id)) { skipped++; continue }

    if (!edition) edition = hit?.editions.find((e) => e.format === ed.format && (!ed.pages || e.pages === ed.pages))
    if (!edition) edition = newEdition(r, work.id, ed)

    // Shelves: every shelf/collection becomes a Folio shelf, except ones that are really statuses.
    const shelfIds: string[] = []
    for (const name of many(r, 'shelves').flatMap(splitList)) {
      const st = guessStatus(name)
      if (st || name === statusRaw) { if (!statusRaw && st) status = st; continue }
      const key = name.toLowerCase()
      let s = shelfByName.get(key)
      if (!s) {
        s = { id: uid(), name: titleCase(name.replace(/[-_]/g, ' ')), position: shelfByName.size } satisfies Shelf
        shelfByName.set(key, s)
        out.shelves.push(s)
      }
      shelfIds.push(s.id)
    }

    const rating = stars(one(r, 'rating'))
    const addedOn = date(one(r, 'dateAdded'))
    const review = [...many(r, 'review'), ...many(r, 'notes')].join('\n\n').replace(/<br\s*\/?>/gi, '\n').trim() || undefined
    const entry: Entry = {
      id: uid(), workId: work.id, editionId: edition.id, status, rating, review,
      favorite: many(r, 'favorite').some(truthy), owned: many(r, 'owned').some(truthy),
      tags: [...new Set(many(r, 'tags').flatMap(splitList).map((t) => tidy(t, titleCase)))].slice(0, 50), shelfIds,
      moods: [...new Set(many(r, 'moods').flatMap(splitList).map((m) => m.toLowerCase()).filter((m) => (MOODS as readonly string[]).includes(m)))],
      pace: (['slow', 'medium', 'fast'] as const).find((p) => one(r, 'pace').toLowerCase().startsWith(p)),
      addedAt: addedOn && addedOn.length === 10 ? localNoon(addedOn) : nowIso(), updatedAt: nowIso(),
    }
    out.entries.push(entry)
    haveEntry.add(work.id)

    const reads = readsOf(r, status, rating, entry.id, edition.id)
    // Further rows for this book are further reads, each on the edition its row names.
    for (const extra of group.slice(1)) {
      const xe = editionOf(extra)
      const same = (editionsByWork.get(work.id) ?? []).find((e) =>
        xe.isbn13 ? e.isbn13 === xe.isbn13 : !e.isbn13 && e.format === xe.format && (!xe.pages || e.pages === xe.pages))
      const xEdition = same ?? newEdition(extra, work.id, xe)
      reads.push(...readsOf(extra, statusOf(extra), stars(one(extra, 'rating')), entry.id, xEdition.id))
    }
    // Dates can't run backwards.
    for (const rd of reads) if (rd.startedOn && rd.finishedOn && rd.startedOn.length === 10 && rd.finishedOn.length === 10 && rd.finishedOn < rd.startedOn) rd.startedOn = undefined
    out.reads.push(...reads)

    if (preview.length < 5) preview.push({ title: work.title, authors: work.authors, status, format: edition.format, rating, finished: reads.find((x) => x.finishedOn)?.finishedOn, reads: reads.filter((x) => x.state === 'finished').length })
  }
  return { data: out, added, matched, skipped, problems, preview }
}

/** Titles and ISBNs in the file, for looking up the shared catalogue before building. */
export function collectKeys(rows: string[][], cols: ColumnGuess[]): { titles: string[]; isbns: string[] } {
  const idx = (f: FieldId) => cols.filter((c) => c.field === f).map((c) => c.index)
  const titleCols = idx('title')
  const isbnCols = [...idx('isbn'), ...idx('isbn13'), ...idx('isbn10')]
  const titles = new Set<string>()
  const isbns = new Set<string>()
  for (const r of rows) {
    for (const i of titleCols) {
      const t = splitSeries((r[i] ?? '').trim()).title
      if (t) titles.add(t)
    }
    for (const i of isbnCols) {
      const c = cleanIsbn(r[i] ?? '')
      if (c) { isbns.add(c); if (c.length === 10) isbns.add(isbn10to13(c)) }
    }
  }
  return { titles: [...titles], isbns: [...isbns] }
}
