import type { Edition, Entry, Read, Work } from './types'

export type SeriesBookState = 'read' | 'reading' | 'want' | 'dnf' | 'paused' | 'none'

export interface SeriesBook {
  work: Work
  index?: number
  state: SeriesBookState
  entry?: Entry
}

export interface Series {
  name: string
  books: SeriesBook[]
  read: number
  /** The first book in order you haven't read or started yet, once you've read an earlier one. */
  next?: SeriesBook
}

const key = (s: string) => s.trim().toLowerCase()

/** Groups works into series (by name, case-insensitive) and works out your progress through each. */
export function buildSeries(
  works: Work[],
  entryByWork: Map<string, Entry>,
  readsByEntry: Map<string, Read[]>,
): Series[] {
  const groups = new Map<string, { name: string; works: Map<string, Work> }>()
  for (const w of works) {
    if (!w.series?.trim()) continue
    const k = key(w.series)
    const g = groups.get(k) ?? { name: w.series.trim(), works: new Map() }
    g.works.set(w.id, w)
    groups.set(k, g)
  }
  const out: Series[] = []
  for (const g of groups.values()) {
    const books: SeriesBook[] = [...g.works.values()].map((w) => {
      const entry = entryByWork.get(w.id)
      const finished = entry && (readsByEntry.get(entry.id) ?? []).some((r) => r.state === 'finished')
      const state: SeriesBookState = !entry ? 'none' : finished ? 'read' : entry.status === 'read' ? 'read' : entry.status
      return { work: w, index: w.seriesIndex, state, entry }
    })
    // Same number twice (two catalogue records for one volume): keep the one on your shelves.
    const byIndex = new Map<string, SeriesBook>()
    for (const b of books) {
      const k = b.index != null ? String(b.index) : `x-${b.work.id}`
      const prev = byIndex.get(k)
      if (!prev || (prev.state === 'none' && b.state !== 'none')) byIndex.set(k, b)
    }
    const ordered = [...byIndex.values()].sort((a, b) => (a.index ?? 999) - (b.index ?? 999) || a.work.title.localeCompare(b.work.title))
    const read = ordered.filter((b) => b.state === 'read').length
    const lastRead = Math.max(-1, ...ordered.map((b, i) => (b.state === 'read' ? i : -1)))
    const next = lastRead >= 0 ? ordered.slice(lastRead + 1).find((b) => b.state === 'none' || b.state === 'want') : undefined
    out.push({ name: g.name, books: ordered, read, next })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const seriesSlug = (name: string) => encodeURIComponent(name.trim())

export type SeriesCatalogue = { works: Work[]; editions: Edition[] }
