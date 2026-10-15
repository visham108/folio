import { findCandidates } from './match'
import type { Edition, Entry, Shelf, Snapshot, Status, Work } from './types'

// When two shelf records for the same book are combined, the further-along pile wins.
const STATUS_RANK: Record<Status, number> = { want: 0, dnf: 1, paused: 2, read: 3, reading: 4 }

/** Combines a duplicate shelf record into the one being kept, losing nothing either recorded. */
export function mergeEntryFields(keep: Entry, dup: Entry): Partial<Entry> {
  const union = <T,>(a: T[] = [], b: T[] = []) => [...new Set([...a, ...b])]
  return {
    status: STATUS_RANK[dup.status] > STATUS_RANK[keep.status] ? dup.status : keep.status,
    rating: keep.rating ?? dup.rating,
    review: [keep.review, dup.review].filter((x) => x?.trim()).join('\n\n') || undefined,
    editionId: keep.editionId ?? dup.editionId,
    favorite: keep.favorite || dup.favorite,
    owned: keep.owned || dup.owned,
    tags: union(keep.tags, dup.tags),
    shelfIds: union(keep.shelfIds, dup.shelfIds),
    moods: union(keep.moods, dup.moods),
    pace: keep.pace ?? dup.pace,
    addedAt: keep.addedAt < dup.addedAt ? keep.addedAt : dup.addedAt,
  }
}

/**
 * Folds a whole library (books saved on this device, or a Folio export) into
 * an existing one without duplicating anything:
 *  - books already in the catalogue are reused (same ISBN, or a confident
 *    title + author match), so their editions and readers stay together;
 *  - a book you already have on your shelves keeps its entry, and the incoming
 *    reads are added to its history;
 *  - shelves with the same name are combined.
 */
export interface MergeResult {
  data: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'logs' | 'shelves'>
  books: number
  matched: number
}

export function mergeLibrary(
  src: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'logs' | 'shelves'>,
  into: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'shelves'>,
): MergeResult {
  const workMap = new Map<string, string>()
  const edMap = new Map<string, string>()
  const outWorks: Work[] = []
  const outEditions: Edition[] = []
  const knownWorks = new Map(into.works.map((w) => [w.id, w]))
  const knownEds = new Map(into.editions.map((e) => [e.id, e]))
  let matched = 0

  const srcEdsByWork = new Map<string, Edition[]>()
  for (const e of src.editions) srcEdsByWork.set(e.workId, [...(srcEdsByWork.get(e.workId) ?? []), e])

  for (const w of src.works) {
    if (knownWorks.has(w.id)) { workMap.set(w.id, w.id); continue }
    const eds = srcEdsByWork.get(w.id) ?? []
    const isbn = eds.map((e) => e.isbn13 ?? e.isbn10).find(Boolean)
    const hit = findCandidates({ title: w.title, authors: w.authors, isbn }, into.works, into.editions, 1)[0]
    if (hit && (hit.sameEdition || hit.score >= 0.93)) {
      workMap.set(w.id, hit.work.id)
      matched++
    } else {
      workMap.set(w.id, w.id)
      outWorks.push(w)
    }
  }

  for (const e of src.editions) {
    if (knownEds.has(e.id)) { edMap.set(e.id, e.id); continue }
    const workId = workMap.get(e.workId) ?? e.workId
    const same = into.editions.find((x) =>
      (e.isbn13 && x.isbn13 === e.isbn13) || (e.isbn10 && x.isbn10 === e.isbn10) ||
      (x.workId === workId && x.format === e.format && !!e.pages && x.pages === e.pages))
    if (same) edMap.set(e.id, same.id)
    else {
      edMap.set(e.id, e.id)
      outEditions.push({ ...e, workId })
    }
  }

  const shelfMap = new Map<string, string>()
  const outShelves: Shelf[] = []
  const byName = new Map(into.shelves.map((s) => [s.name.toLowerCase(), s]))
  for (const s of src.shelves) {
    const have = byName.get(s.name.toLowerCase())
    if (have) shelfMap.set(s.id, have.id)
    else {
      shelfMap.set(s.id, s.id)
      outShelves.push({ ...s, position: into.shelves.length + outShelves.length })
    }
  }

  const haveEntry = new Map(into.entries.map((e) => [e.workId, e]))
  const entryMap = new Map<string, string>()
  const outEntries: Entry[] = []
  for (const en of src.entries) {
    const workId = workMap.get(en.workId) ?? en.workId
    const existing = haveEntry.get(workId)
    const mapped: Entry = {
      ...en, workId,
      editionId: en.editionId ? edMap.get(en.editionId) ?? en.editionId : undefined,
      shelfIds: [...new Set(en.shelfIds.map((id) => shelfMap.get(id) ?? id))],
    }
    if (existing) {
      // Already on your shelves: keep that record, adding anything only the incoming one had.
      entryMap.set(en.id, existing.id)
      const merged: Entry = { ...existing, ...mergeEntryFields(existing, mapped) }
      if (JSON.stringify(merged) !== JSON.stringify(existing)) {
        const i = outEntries.findIndex((x) => x.id === existing.id)
        if (i >= 0) outEntries[i] = merged
        else outEntries.push(merged)
        haveEntry.set(workId, merged)
      }
      continue
    }
    entryMap.set(en.id, en.id)
    haveEntry.set(workId, mapped)
    outEntries.push(mapped)
  }

  const reads = src.reads.map((r) => ({
    ...r,
    entryId: entryMap.get(r.entryId) ?? r.entryId,
    editionId: r.editionId ? edMap.get(r.editionId) ?? r.editionId : undefined,
  }))

  return {
    data: { works: outWorks, editions: outEditions, entries: outEntries, reads, logs: src.logs, shelves: outShelves },
    books: src.entries.length,
    matched,
  }
}
