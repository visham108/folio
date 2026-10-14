import type { Edition, Entry, LogPoint, Medium, Read, Settings, Work } from './types'
import { mediumOf } from './types'
import { daysBetween, yearOf } from './util'

/** One finished (or abandoned) pass through a book, enriched for stats. */
export interface Completion {
  read: Read
  entry: Entry
  work: Work
  edition?: Edition
  medium: Medium
  year: number
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
      if (!year) return
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

export function summarize(items: Completion[], year: number): YearSummary {
  const ys = items.filter((c) => c.year === year)
  const monthly = Array.from({ length: 12 }, () => ({ books: zeroMedium(), pages: 0, minutes: 0 }))
  const byMedium = zeroMedium()
  const hist = new Array(10).fill(0)
  const authors = new Map<string, number>()
  const genres = new Map<string, number>()
  let pages = 0, minutes = 0, rsum = 0, rn = 0, dsum = 0, dn = 0
  for (const c of ys) {
    byMedium[c.medium]++
    pages += c.pages
    minutes += c.minutes
    if (c.month != null) {
      monthly[c.month].books[c.medium]++
      monthly[c.month].pages += c.pages
      monthly[c.month].minutes += c.minutes
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
  return [...new Set(items.map((c) => c.year))].sort((a, b) => a - b)
}

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
  const days = [...new Set(logs.filter((l) => l.amount > 0).map((l) => l.on))].sort()
  let best = 0, run = 0, prev = ''
  for (const d of days) {
    run = prev && Date.parse(d) - Date.parse(prev) === 86400000 ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  const last = days[days.length - 1]
  const t = new Date()
  const todayIso = t.toISOString().slice(0, 10)
  const yest = new Date(t.getTime() - 86400000).toISOString().slice(0, 10)
  return { current: last === todayIso || last === yest ? run : 0, best }
}
