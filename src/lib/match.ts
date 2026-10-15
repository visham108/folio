import type { Edition, Work } from './types'
import { cleanIsbn } from './util'

/**
 * Duplicate / edition detection.
 *
 * Runs instantly and offline: ISBN/ASIN equality first, then fuzzy title +
 * author similarity that is robust to subtitles, series suffixes, articles,
 * punctuation, diacritics, typos and initials ("J.R.R. Tolkien" vs "John
 * Ronald Reuel Tolkien"). The person always confirms the suggestion.
 */

const ARTICLES = /^(the|a|an|le|la|les|el|los|las|der|die|das)\s+/

export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC') // recompose kana voicing marks and the like after stripping Latin accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    // Any script's letters and digits count: ノルウェイの森 must not fold to ''.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const BRACKETS = /[([{][^)\]}]*[)\]}]/g
// "Title: Subtitle", "Title — Subtitle", "Title - Subtitle", "Title, or Alternative".
const SUBTITLE = /[:—–]|\s-\s|,\s+or\s+/i

/** "The Hobbit: or There and Back Again (Middle-earth #0)" → "hobbit" */
export function coreTitle(t: string): string {
  const main = t.replace(BRACKETS, ' ').split(SUBTITLE)[0]
  return fold(main).replace(ARTICLES, '').trim()
}

export function fullTitle(t: string): string {
  return fold(t.replace(BRACKETS, ' ')).replace(ARTICLES, '')
}

/** Everything after the first subtitle separator, folded ('' when there is none). */
const subtitleOf = (t: string): string => {
  const parts = t.replace(BRACKETS, ' ').split(SUBTITLE)
  return parts.length > 1 ? fold(parts.slice(1).join(' ')).replace(/^or\s+/, '') : ''
}

const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const ROMAN_TOKEN = /^(?=[ivx]+$)x{0,3}(ix|iv|v?i{0,3})$/
const roman = (r: string) => {
  const v: Record<string, number> = { i: 1, v: 5, x: 10 }
  let n = 0
  for (let i = 0; i < r.length; i++) n += v[r[i]] < (v[r[i + 1]] ?? 0) ? -v[r[i]] : v[r[i]]
  return n
}

/**
 * Volume numbers in a title: digits anywhere ("Saga, Vol. 01" → 1), Roman numerals
 * ("Book II"), and number words after vol/book/part ("Book Two"). Lone "i", "v" and
 * "x" only count after such a word, so "I, Robot" has none.
 */
export function titleNumbers(t: string): string {
  const words = fold(t.replace(BRACKETS, ' ')).split(' ')
  const out: number[] = []
  words.forEach((w, i) => {
    const marker = /^(vol|volume|book|part|tome|no|number|episode|chapter)$/.test(words[i - 1] ?? '')
    if (/^\d+$/.test(w)) out.push(+w)
    else if (ROMAN_TOKEN.test(w) && (w.length > 1 || marker)) out.push(roman(w))
    else if (marker && w in WORD_NUMS) out.push(WORD_NUMS[w])
  })
  return out.join(' ')
}
function jaroWinkler(a: string, b: string): number {
  if (!a.length || !b.length) return 0 // two blanks are not "the same title"
  if (a === b) return 1
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

/** Below the "strong" line (0.9) and the importer's auto-merge (0.93), whatever the author. */
const DIFFERENT_BOOK = 0.75

export function titleSimilarity(a: string, b: string): number {
  const ca = coreTitle(a)
  const cb = coreTitle(b)
  // Volume 1 and volume 2 of anything are different books, however alike the words.
  const na = titleNumbers(a)
  const nb = titleNumbers(b)
  const numbersDiffer = !!na && !!nb && na !== nb
  // "Dune: House Atreides" and "Dune: House Harkonnen" share a main title but not a book.
  // Only when both have one: "Sapiens" and "Sapiens: A Brief History…" are the same book.
  const sa = subtitleOf(a)
  const sb = subtitleOf(b)
  const subtitlesDiffer = !!sa && !!sb && sa !== sb && Math.max(jaroWinkler(sa, sb), tokenSet(sa, sb)) < 0.9
  const cap = numbersDiffer || subtitlesDiffer ? DIFFERENT_BOOK : 1
  if (ca && ca === cb) return cap
  const fa = fullTitle(a)
  const fb = fullTitle(b)
  const best = Math.min(cap, Math.max(jaroWinkler(ca, cb) * 0.95, tokenSet(fa, fb), jaroWinkler(fa, fb) * 0.9))
  // One title is the other plus whole extra words ("Dune" / "Dune Messiah"): usually a
  // sequel or companion rather than a spelling variant, so never more than a "possible" match.
  const ta = new Set(ca.split(' ').filter(Boolean))
  const tb = new Set(cb.split(' ').filter(Boolean))
  const within = (x: Set<string>, y: Set<string>) => [...x].every((w) => y.has(w))
  if (ta.size !== tb.size && (within(ta, tb) || within(tb, ta))) return Math.min(best, 0.8)
  return best
}

function nameParts(name: string) {
  const parts = fold(name.replace(/\./g, '. ')).split(' ').filter(Boolean)
  return { last: parts[parts.length - 1] ?? '', first: parts[0] ?? '', all: parts.join(' '), whole: parts.join(''), n: parts.length }
}

export function authorSimilarity(as: string[], bs: string[]): number {
  if (!as.length || !bs.length) return 0
  let best = 0
  for (const a of as) {
    for (const b of bs) {
      const A = nameParts(a)
      const B = nameParts(b)
      let s: number
      if (!A.whole || !B.whole) s = 0
      else if (A.whole === B.whole) s = 1 // also "村上春樹" vs "村上 春樹"
      // Last/first-name logic only makes sense for names written with spaces.
      else if (A.n > 1 && B.n > 1 && A.last === B.last) s = A.first[0] === B.first[0] ? 1 : 0.85
      else if ((A.n > 1) !== (B.n > 1) && (A.n > 1 ? A.last === B.whole : B.last === A.whole)) s = 0.85 // "Tolkien" vs "J.R.R. Tolkien"
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
  /** Compared too, so "Dune: House Atreides" isn't taken for "Dune: House Harkonnen". */
  subtitle?: string
  authors: string[]
  isbn?: string
  asin?: string
}

const withSub = (t: string, sub?: string) => (sub?.trim() ? `${t}: ${sub.trim()}` : t)

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
    const titles = [withSub(w.title, w.subtitle), ...eds.map((e) => e.title).filter((t): t is string => !!t)]
    const ts = Math.max(...titles.map((t) => titleSimilarity(withSub(q.title, q.subtitle), t)))
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
