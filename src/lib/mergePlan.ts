import type { Edition, Work } from './types'

/**
 * What merging a duplicate book into the one you keep will do. Mirrors merge_works() in the
 * database, so the preview shows exactly what happens:
 *  - book details the kept book leaves blank come from the duplicate (always);
 *  - "combine" folds each of the duplicate's editions into the kept book's copy of the same
 *    format (yours, if it's that format), filling its blanks, and removes it; a format the kept
 *    book doesn't have moves across as its own edition. "Keep both" lists them all alongside.
 */

export type MergeMode = 'combine' | 'both'

/** Volumes often share a title ("Sri Brhad-bhagavatamrta"), so include the subtitle to tell them apart. */
export const fullTitle = (w: Work) => (w.subtitle ? `${w.title}: ${w.subtitle}` : w.title)

type EdField = 'title' | 'publisher' | 'publishedDate' | 'isbn13' | 'isbn10' | 'asin' | 'language' | 'pages' | 'durationMin' | 'narrators' | 'translators' | 'coverUrl' | 'note'
type WorkField = 'subtitle' | 'series' | 'seriesIndex' | 'description' | 'genres' | 'firstPublished' | 'originalLanguage'

export const EDITION_FIELDS: EdField[] = ['pages', 'durationMin', 'publisher', 'publishedDate', 'isbn13', 'isbn10', 'asin', 'language', 'narrators', 'translators', 'title', 'coverUrl', 'note']
export const WORK_FIELDS: WorkField[] = ['subtitle', 'series', 'seriesIndex', 'description', 'genres', 'firstPublished', 'originalLanguage']

const blank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

/** One copy of the kept book and the duplicate's copies of the same format folded into it. */
export interface MergeGroup {
  into: Edition
  from: Edition[]
  result: Edition
  filled: EdField[]
  /** Values the duplicate's copies had that the kept copy already had its own of. */
  discarded: { field: EdField; value: unknown; kept: unknown }[]
}

export interface MergePlan {
  /** The kept book with its blanks filled from the duplicate. */
  work: Work
  workFilled: WorkField[]
  /** The duplicate's editions, your copy first. */
  dupEditions: Edition[]
  /** Combining: each of the duplicate's editions folds into the kept book's copy of the same format… */
  groups: MergeGroup[]
  /** …or, if the kept book has no copy in that format, moves across as its own edition. */
  moved: Edition[]
  /** Where each of the duplicate's editions ends up when combining (id → id). */
  target: Map<string, string>
}

const byAge = (a: Edition, b: Edition) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)

export function planMerge(args: {
  dup: Work; keep: Work; dupEditions: Edition[]; keepEditions: Edition[]
  /** Your edition of each book, if it's on your shelves. */
  myKeepEditionId?: string; myDupEditionId?: string
}): MergePlan {
  const { dup, keep } = args
  // Book details.
  const work = { ...keep }
  const workFilled: WorkField[] = []
  for (const f of WORK_FIELDS) {
    if (f === 'seriesIndex') continue
    if (blank(keep[f]) && !blank(dup[f])) { (work as unknown as Record<string, unknown>)[f] = dup[f]; workFilled.push(f) }
  }
  // The series number belongs with its series.
  if (blank(keep.series)) { work.seriesIndex = dup.seriesIndex; if (dup.seriesIndex != null) workFilled.push('seriesIndex') }

  const dupEditions = [...args.dupEditions].sort((a, b) =>
    Number(b.id === args.myDupEditionId) - Number(a.id === args.myDupEditionId) || byAge(a, b))
  // The kept book's copy in a given format: yours if it's that format, otherwise its oldest.
  // (A copy that moved across counts too, so two of the duplicate's audiobooks become one.)
  const pool = [...args.keepEditions]
  const keepFor = (format: Edition['format']) => pool.filter((e) => e.format === format)
    .sort((a, b) => Number(b.id === args.myKeepEditionId) - Number(a.id === args.myKeepEditionId) || byAge(a, b))[0]

  const groups = new Map<string, MergeGroup>()
  const moved: Edition[] = []
  const target = new Map<string, string>()
  for (const d of dupEditions) {
    const into = keepFor(d.format)
    if (!into) { moved.push(d); pool.push(d); target.set(d.id, d.id); continue }
    const g = groups.get(into.id) ?? { into, from: [], result: { ...into }, filled: [], discarded: [] }
    groups.set(into.id, g)
    g.from.push(d)
    target.set(d.id, into.id)
    for (const f of EDITION_FIELDS) {
      if (blank(d[f])) continue
      if (blank(g.result[f])) { (g.result as unknown as Record<string, unknown>)[f] = d[f]; g.filled.push(f) }
      else if (JSON.stringify(g.result[f]) !== JSON.stringify(d[f])) g.discarded.push({ field: f, value: d[f], kept: g.result[f] })
    }
  }
  // Your copy's group first.
  const ordered = [...groups.values()].sort((a, b) => Number(b.into.id === args.myKeepEditionId) - Number(a.into.id === args.myKeepEditionId))
  return { work, workFilled, dupEditions, groups: ordered, moved, target }
}

export const FIELD_NAMES: Record<EdField | WorkField, string> = {
  pages: 'Pages', durationMin: 'Length', publisher: 'Publisher', publishedDate: 'Published', isbn13: 'ISBN', isbn10: 'ISBN-10',
  asin: 'ASIN', language: 'Language', narrators: 'Narrators', translators: 'Translators', title: 'Edition title', coverUrl: 'Cover',
  note: 'Edition note', subtitle: 'Subtitle', series: 'Series', seriesIndex: 'Number in series', description: 'Description',
  genres: 'Genres', firstPublished: 'First published', originalLanguage: 'Original language',
}
