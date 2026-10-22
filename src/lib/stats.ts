import type { Edition, Entry, LogPoint, Medium, Read, Settings, Work } from './types'
import { mediumOf } from './types'
import { addDays, daysBetween, plural, today, yearOf } from './util'

/** One finished (or abandoned) pass through a book, enriched for stats. */
export interface Completion {
  read: Read
  entry: Entry
  work: Work
  edition?: Edition
  medium: Medium
  /** Missing for books marked read without a date: counted in all-time totals, not in any year. */
  year?: number
  month?: number // 0-11
  pages: number // print/ebook pages
  minutes: number // audio minutes
  days?: number
  rating?: number
  isReread: boolean
}

export interface Lookup {
  works: Map<string, Work>
  editions: Map<string, Edition>
  entries: Map<string, Entry>
}

export function completions(
  reads: Read[],
  lk: Lookup,
  opts: { includeDnf?: boolean } = {},
): Completion[] {
  const out: Completion[] = []
  const byEntry = new Map<string, Read[]>()
  for (const r of reads) {
    if (r.state !== 'finished' && !(opts.includeDnf && r.state === 'dnf')) continue
    const arr = byEntry.get(r.entryId)
    if (arr) arr.push(r)
    else byEntry.set(r.entryId, [r])
  }
  for (const [entryId, rs] of byEntry) {
    const entry = lk.entries.get(entryId)
    if (!entry) continue
    const work = lk.works.get(entry.workId)
    if (!work) continue
    rs.sort((a, b) => (a.finishedOn ?? '').localeCompare(b.finishedOn ?? ''))
    rs.forEach((read, i) => {
      const year = yearOf(read.finishedOn)
      const edition = lk.editions.get(read.editionId ?? entry.editionId ?? '')
      const medium = mediumOf(edition?.format)
      const m = read.finishedOn && read.finishedOn.length >= 7 ? parseInt(read.finishedOn.slice(5, 7), 10) - 1 : undefined
      out.push({
        read, entry, work, edition, medium, year, month: m,
        pages: medium === 'audio' ? 0 : edition?.pages ?? 0,
        minutes: medium === 'audio' ? edition?.durationMin ?? 0 : 0,
        days: daysBetween(read.startedOn, read.finishedOn),
        rating: read.rating ?? entry.rating,
        isReread: i > 0,
      })
    })
  }
  return out
}

/**
 * Pages and listening time, placed on the days you read them. Each progress update counts on its
 * day; whatever a finished book still has left counts on the day you finished it. So a book read
 * half in 2025 and half in 2026 puts half its pages in each year, while the book itself counts as
 * finished in 2026. Amounts only ever add up to the furthest point you'd reached: going back
 * (a correction, or rereading a chapter) never takes pages away from a day already counted.
 */
export interface Slice {
  readId: string
  medium: Medium
  /** Missing when the finish had no date: counted in all-time totals only. */
  year?: number
  month?: number
  pages: number
  minutes: number
}

export function readingSlices(reads: Read[], logs: LogPoint[], lk: Lookup): Slice[] {
  const byRead = new Map<string, LogPoint[]>()
  for (const l of logs) {
    const arr = byRead.get(l.readId)
    if (arr) arr.push(l)
    else byRead.set(l.readId, [l])
  }
  const out: Slice[] = []
  const put = (readId: string, medium: Medium, date: string | undefined, amount: number) => {
    if (amount <= 0) return
    const year = yearOf(date)
    const month = date && date.length >= 7 ? parseInt(date.slice(5, 7), 10) - 1 : undefined
    out.push({ readId, medium, year, month, pages: medium === 'audio' ? 0 : amount, minutes: medium === 'audio' ? amount : 0 })
  }
  for (const r of reads) {
    const entry = lk.entries.get(r.entryId)
    if (!entry || !lk.works.has(entry.workId)) continue
    const edition = lk.editions.get(r.editionId ?? entry.editionId ?? '')
    const medium = mediumOf(edition?.format)
    const total = (medium === 'audio' ? edition?.durationMin : edition?.pages) ?? 0
    // Furthest point reached so far, per unit (a read can switch between print and audio).
    const pos: Record<Medium, number> = { print: 0, ebook: 0, audio: 0 }
    const high: Record<Medium, number> = { print: 0, ebook: 0, audio: 0 }
    for (const l of (byRead.get(r.id) ?? []).sort((a, b) => a.on.localeCompare(b.on))) {
      const m = l.medium
      pos[m] += l.amount
      const cap = m === medium && total ? total : Infinity
      const reached = Math.min(pos[m], cap)
      if (reached > high[m]) { put(r.id, m, l.on, reached - high[m]); high[m] = reached }
    }
    if (r.state === 'finished' && total) put(r.id, medium, r.finishedOn, total - high[medium])
  }
  return out
}

/** A round axis maximum at or above `v`. */
export function niceMax(v: number): number {
  // Below 10, an even maximum keeps the half-way gridline on a whole number (3 → 4, not 1.5).
  if (v <= 10) return Math.max(2, Math.ceil(v / 2) * 2)
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  // Steps chosen so the half-way gridline is also a round number.
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10
  return step * p
}

export const pageEquivalent = (c: { pages: number; minutes: number }, s: Settings) =>
  c.pages + (c.minutes / 60) * s.audioPagesPerHour

export interface YearSummary {
  year: number
  books: number
  rereads: number
  pages: number
  minutes: number
  byMedium: Record<Medium, number>
  monthly: { books: Record<Medium, number>; pages: number; minutes: number }[]
  avgRating?: number
  ratingHist: number[] // index 0 → 0.5★ … 9 → 5★
  longest?: Completion
  shortest?: Completion
  fastest?: Completion
  avgDays?: number
  topAuthors: { name: string; count: number }[]
  topGenres: { name: string; count: number }[]
  items: Completion[]
}

const zeroMedium = (): Record<Medium, number> => ({ print: 0, ebook: 0, audio: 0 })

/** One year's summary. With `slices`, pages and listening time follow the days you read, not the finish date. */
export function summarize(items: Completion[], year: number, slices?: Slice[]): YearSummary {
  const ys = items.filter((c) => c.year === year)
  const monthly = Array.from({ length: 12 }, () => ({ books: zeroMedium(), pages: 0, minutes: 0 }))
  const byMedium = zeroMedium()
  const hist = new Array(10).fill(0)
  const authors = new Map<string, number>()
  const genres = new Map<string, number>()
  let pages = 0, minutes = 0, rsum = 0, rn = 0, dsum = 0, dn = 0
  for (const c of ys) {
    byMedium[c.medium]++
    if (!slices) {
      pages += c.pages
      minutes += c.minutes
    }
    if (c.month != null) {
      monthly[c.month].books[c.medium]++
      if (!slices) {
        monthly[c.month].pages += c.pages
        monthly[c.month].minutes += c.minutes
      }
    }
    if (c.rating) {
      rsum += c.rating
      rn++
      hist[Math.round(c.rating * 2) - 1]++
    }
    if (c.days) { dsum += c.days; dn++ }
    for (const a of c.work.authors) authors.set(a, (authors.get(a) ?? 0) + 1)
    for (const g of c.work.genres) genres.set(g, (genres.get(g) ?? 0) + 1)
  }
  for (const sl of slices ?? []) {
    if (sl.year !== year) continue
    pages += sl.pages
    minutes += sl.minutes
    if (sl.month != null) {
      monthly[sl.month].pages += sl.pages
      monthly[sl.month].minutes += sl.minutes
    }
  }
  const withLen = ys.filter((c) => c.pages > 0)
  const top = (m: Map<string, number>) =>
    [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6)
  return {
    year,
    books: ys.length,
    rereads: ys.filter((c) => c.isReread).length,
    pages,
    minutes,
    byMedium,
    monthly,
    avgRating: rn ? rsum / rn : undefined,
    ratingHist: hist,
    longest: withLen.reduce<Completion | undefined>((a, c) => (!a || c.pages > a.pages ? c : a), undefined),
    shortest: withLen.reduce<Completion | undefined>((a, c) => (!a || c.pages < a.pages ? c : a), undefined),
    fastest: ys.filter((c) => c.days).reduce<Completion | undefined>((a, c) => (!a || c.days! < a.days! ? c : a), undefined),
    avgDays: dn ? dsum / dn : undefined,
    topAuthors: top(authors),
    topGenres: top(genres),
    items: ys.sort((a, b) => (a.read.finishedOn ?? '').localeCompare(b.read.finishedOn ?? '')),
  }
}

export function yearsWithData(items: Completion[]): number[] {
  return [...new Set(items.map((c) => c.year).filter((y): y is number => y != null))].sort((a, b) => a - b)
}

/** Finished reads with no finish date (often imported from Goodreads without "Date Read"). */
export const undated = (items: Completion[]) => items.filter((c) => c.year == null)

/** Daily activity (page-equivalents) for a heatmap. */
export function dailyActivity(logs: LogPoint[], items: Completion[], year: number, s: Settings): Map<string, number> {
  const m = new Map<string, number>()
  const add = (d: string, v: number) => m.set(d, (m.get(d) ?? 0) + v)
  for (const l of logs) {
    if (!l.on.startsWith(String(year)) || l.amount <= 0) continue
    add(l.on, l.medium === 'audio' ? (l.amount / 60) * s.audioPagesPerHour : l.amount)
  }
  // Books finished without progress logs still deserve a mark on the day.
  const logged = new Set(logs.map((l) => l.readId))
  for (const c of items) {
    if (c.year !== year || logged.has(c.read.id) || !c.read.finishedOn || c.read.finishedOn.length < 10) continue
    add(c.read.finishedOn, Math.max(1, pageEquivalent(c, s) * 0.08))
  }
  return m
}

export function streak(logs: LogPoint[]): { current: number; best: number } {
  const days = [...new Set(logs.filter((l) => l.amount >= 0).map((l) => l.on))].sort()
  let best = 0, run = 0, prev = ''
  for (const d of days) {
    run = prev && Date.parse(d) - Date.parse(prev) === 86400000 ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  const last = days[days.length - 1]
  // Logs are stamped with the reader's local date, so compare with the local today.
  const t = today()
  return { current: last === t || last === addDays(t, -1) ? run : 0, best }
}

// ── Deeper patterns ───────────────────────────────────────────────────────────

const DAY = 86400000
const isoDay = (s?: string) => (s && s.length === 10 ? Date.parse(s + 'T12:00:00Z') : NaN)
const yearOfDate = (s?: string) => (s ? parseInt(s.slice(0, 4), 10) : NaN)

const daysIn = (year: number) => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY
/** Start of the reader's local today, as a UTC timestamp on the same calendar date. */
const todayStart = (now = new Date()) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
/** 0-based day of the year for the reader's local today. */
const localDayOfYear = (now = new Date()) => (todayStart(now) - Date.UTC(now.getFullYear(), 0, 1)) / DAY

/**
 * Where you stand against a yearly goal, counting today as a reading day.
 * Shared by Today and Stats so both say the same thing: `ahead` is a whole
 * number of books (negative when behind) and `text` is ready to show.
 */
export function goalPace(done: number, goal: number, year: number, now = new Date(), unit = 'book') {
  const days = daysIn(year)
  const cur = now.getFullYear()
  const elapsed = cur === year ? localDayOfYear(now) + 1 : cur > year ? days : 0
  const expected = goal > 0 ? (goal * elapsed) / days : 0
  const ahead = Math.round(done - expected)
  const text = goal > 0 && done >= goal ? 'Goal reached ✦'
    : ahead > 0 ? `${plural(ahead, unit)} ahead of pace`
      : ahead < 0 ? `${plural(-ahead, unit)} behind pace`
        : 'Right on pace'
  return { expected, ahead, text }
}

/** Cumulative books finished through the year, against the steady pace a goal needs. */
export function goalRace(items: Completion[], year: number, goal: number, now = new Date()) {
  const start = Date.UTC(year, 0, 1)
  const days = daysIn(year)
  const cur = now.getFullYear()
  const lastDay = cur === year ? localDayOfYear(now) : cur > year ? days - 1 : -1
  const perDay = new Array(days).fill(0)
  for (const c of items) {
    if (c.year !== year) continue
    const t = isoDay(c.read.finishedOn)
    const d = Number.isFinite(t) ? Math.floor((t - start) / DAY) : c.month != null ? Math.floor(((Date.UTC(year, c.month + 1, 1) - start) / DAY) - 1) : days - 1
    // Month-only dates land on the month's last day; never past today, so the line reaches the total.
    perDay[Math.min(lastDay >= 0 ? lastDay : days - 1, days - 1, Math.max(0, d))]++
  }
  const you: { x: number; y: number }[] = []
  let sum = 0
  for (let d = 0; d <= lastDay; d++) { sum += perDay[d]; you.push({ x: d, y: sum }) }
  const pace = [{ x: 0, y: 0 }, { x: days - 1, y: goal }]
  const p = goalPace(sum, goal, year, now)
  // Month starts as days into the year (leap years included), for ticks and the table.
  const monthStarts = Array.from({ length: 12 }, (_, m) => (Date.UTC(year, m, 1) - start) / DAY)
  return { days, you, pace, done: sum, expectedNow: p.expected, ahead: p.ahead, paceText: p.text, lastDay, monthStarts }
}

export interface SpeedPoint { key: string; label: string; pagesPerDay: number; hoursPerWeek: number }

/**
 * Reading speed per period. Daily progress logs are the truth where they exist;
 * periods without logs fall back to the books finished in them.
 */
export function readingSpeed(items: Completion[], logs: LogPoint[], periods: { key: string; label: string; from: number; to: number }[]): SpeedPoint[] {
  return periods.map((p) => {
    const inP = (t: number) => t >= p.from && t < p.to
    const pl = logs.filter((l) => inP(isoDay(l.on)))
    let pages = 0, minutes = 0
    if (pl.length) {
      for (const l of pl) { if (l.amount <= 0) continue; if (l.medium === 'audio') minutes += l.amount; else pages += l.amount }
    } else {
      for (const c of items) {
        const t = isoDay(c.read.finishedOn) || (c.month != null && c.year != null ? Date.UTC(c.year, c.month, 15) : NaN)
        if (inP(t)) { pages += c.pages; minutes += c.minutes }
      }
    }
    // Whole days: the full period once it's over, otherwise the days so far including today.
    const days = Math.max(1, Math.round((Math.min(p.to, todayStart() + DAY) - p.from) / DAY))
    return { key: p.key, label: p.label, pagesPerDay: pages / days, hoursPerWeek: (minutes / 60) / (days / 7) }
  })
}

export const monthPeriods = (year: number) =>
  Array.from({ length: 12 }, (_, m) => ({ key: String(m), label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m], from: Date.UTC(year, m, 1), to: Date.UTC(year, m + 1, 1) }))
    .filter((p) => p.from <= todayStart())

export const yearPeriods = (years: number[]) =>
  years.map((y) => ({ key: String(y), label: String(y), from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) }))

/** Share of books in each format, per year (percentages). */
export function formatMixByYear(items: Completion[], years: number[]) {
  return years.map((y) => {
    const ys = items.filter((c) => c.year === y)
    const n = ys.length || 1
    const parts: Record<Medium, number> = { print: 0, ebook: 0, audio: 0 }
    for (const c of ys) parts[c.medium]++
    return { key: String(y), label: String(y), total: ys.length, parts: { print: (parts.print / n) * 100, audio: (parts.audio / n) * 100, ebook: (parts.ebook / n) * 100 } }
  })
}

export const PAGE_BUCKETS: [number, number, string][] = [[0, 200, 'Under 200'], [200, 300, '200–299'], [300, 400, '300–399'], [400, 500, '400–499'], [500, 700, '500–699'], [700, Infinity, '700+']]
export const HOUR_BUCKETS: [number, number, string][] = [[0, 5, 'Under 5h'], [5, 10, '5–10h'], [10, 15, '10–15h'], [15, 20, '15–20h'], [20, Infinity, '20h+']]

/** How many short, medium and long books: pages for print and ebook, hours for audio. */
export function lengthSpread(items: Completion[]) {
  const pages = PAGE_BUCKETS.map(([lo, hi, label]) => ({ key: label, label, value: items.filter((c) => c.medium !== 'audio' && c.pages > 0 && c.pages >= lo && c.pages < hi).length }))
  const hours = HOUR_BUCKETS.map(([lo, hi, label]) => ({ key: label, label, value: items.filter((c) => c.medium === 'audio' && c.minutes > 0 && c.minutes / 60 >= lo && c.minutes / 60 < hi).length }))
  return { pages, hours, unknown: items.filter((c) => !c.pages && !c.minutes).length }
}

/** Books by the decade they were first published. */
export function publicationDecades(items: Completion[]) {
  const m = new Map<number, number>()
  for (const c of items) {
    const y = c.work.firstPublished
    if (!y) continue
    const d = y < 1900 ? 1800 : Math.floor(y / 10) * 10
    m.set(d, (m.get(d) ?? 0) + 1)
  }
  const keys = [...m.keys()].sort((a, b) => a - b)
  if (!keys.length) return []
  const out = []
  const first = keys[0] === 1800 ? 1800 : keys[0]
  for (let d = first; d <= keys[keys.length - 1]; d += d === 1800 ? 100 : 10) {
    out.push({ key: String(d), label: d === 1800 ? 'Pre-1900' : `${d}s`, value: m.get(d) ?? 0 })
  }
  return out
}

/** Top genres as rows, years as columns, cells are books finished. */
export function genresByYear(items: Completion[], years: number[], top = 6) {
  const total = new Map<string, number>()
  for (const c of items) for (const g of c.work.genres) total.set(g, (total.get(g) ?? 0) + 1)
  const genres = [...total].sort((a, b) => b[1] - a[1]).slice(0, top).map(([g]) => g)
  const cells = genres.map((g) => years.map((y) => items.filter((c) => c.year === y && c.work.genres.includes(g)).length))
  return { genres, years, cells, max: Math.max(1, ...cells.flat()) }
}

/** Finished vs abandoned, per year. */
export function finishRate(reads: Read[], years: number[]) {
  return years.map((y) => {
    const finished = reads.filter((r) => r.state === 'finished' && yearOfDate(r.finishedOn) === y).length
    const dnf = reads.filter((r) => r.state === 'dnf' && yearOfDate(r.finishedOn ?? r.startedOn) === y).length
    return { key: String(y), label: String(y), finished, dnf, rate: finished + dnf ? finished / (finished + dnf) : undefined }
  })
}

/** Average days from start to finish, per genre (genres with at least two timed reads). */
export function daysByGenre(items: Completion[], top = 8) {
  const m = new Map<string, number[]>()
  for (const c of items) if (c.days) for (const g of c.work.genres) m.set(g, [...(m.get(g) ?? []), c.days])
  return [...m].filter(([, d]) => d.length >= 2).map(([name, d]) => ({ name, avg: d.reduce((a, b) => a + b, 0) / d.length, n: d.length }))
    .sort((a, b) => b.avg - a.avg).slice(0, top)
}

export const WAIT_BUCKETS: [number, number, string][] = [[0, 7, 'Within a week'], [7, 31, 'Within a month'], [31, 183, '1–6 months'], [183, 366, '6–12 months'], [366, Infinity, 'Over a year']]

/** How long books sat on the want-to-read list before you started them, and who's still waiting. */
export function tbrWait(entries: Entry[], readsByEntry: Map<string, Read[]>, works: Map<string, Work>) {
  const waits: number[] = []
  for (const e of entries) {
    const rs = readsByEntry.get(e.id) ?? []
    const first = rs.map((r) => r.startedOn ?? r.finishedOn).filter((d): d is string => !!d && d.length === 10).sort()[0]
    if (!first) continue
    const w = (isoDay(first) - Date.parse(e.addedAt)) / DAY
    if (Number.isFinite(w) && w >= 0) waits.push(w)
  }
  const buckets = WAIT_BUCKETS.map(([lo, hi, label]) => ({ key: label, label, value: waits.filter((w) => w >= lo && w < hi).length }))
  const waiting = entries
    .filter((e) => e.status === 'want' && !(readsByEntry.get(e.id) ?? []).length)
    .map((e) => ({ entry: e, work: works.get(e.workId), days: Math.floor((Date.now() - Date.parse(e.addedAt)) / DAY) }))
    .filter((x) => x.work && Number.isFinite(x.days))
    .sort((a, b) => b.days - a.days)
  const median = waits.length ? [...waits].sort((a, b) => a - b)[Math.floor(waits.length / 2)] : undefined
  return { buckets, waiting: waiting.slice(0, 5), waitingCount: waiting.length, median }
}

/** One dot per rated book: length (page-equivalents) against your rating. */
export function ratingVsLength(items: Completion[], s: Settings) {
  return items
    .filter((c) => c.rating && (c.pages || c.minutes))
    .map((c) => ({ id: c.read.id, workId: c.work.id, title: c.work.title, medium: c.medium, x: Math.round(pageEquivalent(c, s)), y: c.rating!, pages: c.pages, minutes: c.minutes }))
}

/** Average books finished in each calendar month, across the years you have data for. */
export function seasonalRhythm(items: Completion[]) {
  const years = new Set(items.filter((c) => c.month != null).map((c) => c.year))
  const n = Math.max(1, years.size)
  return Array.from({ length: 12 }, (_, m) => ({
    key: String(m),
    label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m],
    value: items.filter((c) => c.month === m).length / n,
  }))
}

/** Moods and pace across the books finished in the period. */
export function moodProfile(items: Completion[]) {
  const moods = new Map<string, number>()
  const pace = { slow: 0, medium: 0, fast: 0 }
  const seen = new Set<string>()
  for (const c of items) {
    if (seen.has(c.entry.id)) continue
    seen.add(c.entry.id)
    for (const m of c.entry.moods ?? []) moods.set(m, (moods.get(m) ?? 0) + 1)
    if (c.entry.pace) pace[c.entry.pace]++
  }
  return {
    moods: [...moods].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    pace,
    tagged: [...seen].length,
  }
}
