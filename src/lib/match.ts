import type { Edition, Work } from './types'
import { cleanIsbn } from './util'

/**
 * Duplicate / edition detection.
 *
 * Stage 1 (here, instant, offline): ISBN equality, then fuzzy title + author
 * similarity that is robust to subtitles, series suffixes, articles,
 * punctuation, diacritics and initials ("J.R.R. Tolkien" vs "John Ronald
 * Reuel Tolkien").
 *
 * Stage 2 (optional, server): ambiguous candidates are sent to the
 * `match-book` edge function, where Claude decides whether it's the same work
 * (e.g. translated titles, "Philosopher's" vs "Sorcerer's Stone").
 */

const ARTICLES = /^(the|a|an|le|la|les|el|los|las|der|die|das)\s+/

export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "The Hobbit: or There and Back Again (Middle-earth #0)" → "hobbit" */
export function coreTitle(t: string): string {
  const noBrackets = t.replace(/[([{][^)\]}]*[)\]}]/g, ' ')
  const main = noBrackets.split(/[:—–]|\s-\s/)[0]
  return fold(main).replace(ARTICLES, '').trim()
}

export function fullTitle(t: string): string {
  return fold(t.replace(/[([{][^)\]}]*[)\]}]/g, ' ')).replace(ARTICLES, '')
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const am = new Array(a.length).fill(false)
  const bm = new Array(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue
      am[i] = bm[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue
    while (!bm[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3
  let p = 0
  while (p < 4 && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

function tokenSet(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean))
  const B = new Set(b.split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  // Containment rather than Jaccard: "Dune" vs "Dune Messiah" should not be 1,
  // but "Sapiens" vs "Sapiens a brief history of humankind" should be high.
  const small = Math.min(A.size, B.size)
  const big = Math.max(A.size, B.size)
  return (inter / small) * 0.75 + (inter / big) * 0.25
}

export function titleSimilarity(a: string, b: string): number {
  const ca = coreTitle(a)
  const cb = coreTitle(b)
  if (ca && ca === cb) return 1
  const fa = fullTitle(a)
  const fb = fullTitle(b)
  return Math.max(jaroWinkler(ca, cb) * 0.95, tokenSet(fa, fb), jaroWinkler(fa, fb) * 0.9)
}

function nameParts(name: string) {
  const parts = fold(name.replace(/\./g, '. ')).split(' ').filter(Boolean)
  return { last: parts[parts.length - 1] ?? '', first: parts[0] ?? '', all: parts.join(' ') }
}

export function authorSimilarity(as: string[], bs: string[]): number {
  if (!as.length || !bs.length) return 0
  let best = 0
  for (const a of as) {
    for (const b of bs) {
      const A = nameParts(a)
      const B = nameParts(b)
      let s: number
      if (A.last && A.last === B.last) s = A.first[0] === B.first[0] ? 1 : 0.85
      else s = jaroWinkler(A.all, B.all) * 0.9
      best = Math.max(best, s)
    }
  }
  return best
}

export interface MatchCandidate {
  work: Work
  editions: Edition[]
  score: number
  /** The exact edition already exists (same ISBN/ASIN). */
  sameEdition?: Edition
  reason: string
}

export interface MatchQuery {
  title: string
  authors: string[]
  isbn?: string
  asin?: string
}

export function findCandidates(q: MatchQuery, works: Work[], editions: Edition[], limit = 5): MatchCandidate[] {
  const byWork = new Map<string, Edition[]>()
  for (const e of editions) {
    const arr = byWork.get(e.workId)
    if (arr) arr.push(e)
    else byWork.set(e.workId, [e])
  }
  const isbn = cleanIsbn(q.isbn)
  const out: MatchCandidate[] = []
  for (const w of works) {
    const eds = byWork.get(w.id) ?? []
    const same = eds.find(
      (e) => (isbn && (e.isbn13 === isbn || e.isbn10 === isbn)) || (q.asin && e.asin && e.asin === q.asin.trim().toUpperCase()),
    )
    if (same) {
      out.push({ work: w, editions: eds, score: 1, sameEdition: same, reason: 'Same ISBN — this exact edition is already here' })
      continue
    }
    if (!q.title.trim()) continue
    const titles = [w.title, ...eds.map((e) => e.title).filter((t): t is string => !!t)]
    const ts = Math.max(...titles.map((t) => titleSimilarity(q.title, t)))
    if (ts < 0.6) continue
    const hasAuthors = q.authors.some((a) => a.trim())
    const as = hasAuthors ? authorSimilarity(q.authors, w.authors) : 0
    const score = hasAuthors ? ts * 0.65 + as * 0.35 : ts * 0.85
    if (score < 0.62) continue
    const reason =
      ts > 0.97 && as > 0.95
        ? 'Same title and author'
        : ts > 0.97
          ? hasAuthors ? 'Same title, author spelled differently' : 'Same title'
          : as > 0.95
            ? 'Similar title by the same author'
            : 'Similar title and author'
    out.push({ work: w, editions: eds, score, reason })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

export type Confidence = 'exact' | 'strong' | 'possible'
export const confidenceOf = (c: MatchCandidate): Confidence =>
  c.sameEdition ? 'exact' : c.score >= 0.9 ? 'strong' : 'possible'
