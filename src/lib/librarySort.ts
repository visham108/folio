import { fold } from './match'

/** Ways to order the Library. `dir` is the natural direction (1 = A→Z / lowest first). */
export type SortId = 'added' | 'activity' | 'finished' | 'started' | 'title' | 'author' | 'series' | 'genre' | 'format' | 'pile' | 'rating' | 'length' | 'published' | 'progress' | 'timesRead' | 'publisher' | 'colour'

export interface SortDef {
  id: SortId
  label: string
  dir: 1 | -1
  /** What each direction reads as: [ascending, descending]. */
  orders: [string, string]
  /** Show a heading for each run of books (one per series, one per author). */
  grouped?: boolean
}

export const SORTS: SortDef[] = [
  { id: 'added', label: 'Date added', dir: -1, orders: ['Oldest first', 'Newest first'] },
  { id: 'activity', label: 'Last activity', dir: -1, orders: ['Longest ago first', 'Most recent first'] },
  { id: 'finished', label: 'Date finished', dir: -1, orders: ['Oldest first', 'Newest first'] },
  { id: 'started', label: 'Date started', dir: -1, orders: ['Oldest first', 'Newest first'] },
  { id: 'title', label: 'Title', dir: 1, orders: ['A → Z', 'Z → A'] },
  { id: 'author', label: 'Author', dir: 1, orders: ['A → Z', 'Z → A'], grouped: true },
  { id: 'series', label: 'Series', dir: 1, orders: ['A → Z', 'Z → A'], grouped: true },
  { id: 'genre', label: 'Genre', dir: 1, orders: ['A → Z', 'Z → A'], grouped: true },
  { id: 'format', label: 'Format', dir: 1, orders: ['Print first', 'Audio first'], grouped: true },
  { id: 'pile', label: 'Pile', dir: 1, orders: ['Reading first', 'Did not finish first'], grouped: true },
  { id: 'rating', label: 'Rating', dir: -1, orders: ['Lowest first', 'Highest first'] },
  { id: 'length', label: 'Length', dir: -1, orders: ['Shortest first', 'Longest first'] },
  { id: 'published', label: 'Year first published', dir: 1, orders: ['Oldest first', 'Newest first'] },
  { id: 'progress', label: 'Progress', dir: -1, orders: ['Least read first', 'Most read first'] },
  { id: 'timesRead', label: 'Times read', dir: -1, orders: ['Fewest first', 'Most first'] },
  { id: 'publisher', label: 'Publisher', dir: 1, orders: ['A → Z', 'Z → A'] },
  // Spines only: the generated cover colours, which the grid and lists don't show.
  { id: 'colour', label: 'Colour', dir: 1, orders: ['Rainbow', 'Reverse rainbow'] },
]

export const sortDef = (id: SortId) => SORTS.find((s) => s.id === id) ?? SORTS[0]

/** A sort key: compared part by part; `undefined` means "no value", which always goes last. */
export type SortKey = (string | number)[] | undefined

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function compareKeys(a: SortKey, b: SortKey, dir: 1 | -1): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i]
    if (x === y) continue
    if (x === undefined) return -1 * dir
    if (y === undefined) return 1 * dir
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
    if (c) return c * dir
  }
  return 0
}

/** "The Silmarillion" files under S; accents are ignored ("Śrī" sorts with "Sri"). */
export function titleKey(title = ''): string {
  return fold(title.replace(/^\s*(the|a|an)\s+/i, ''))
}

// Sort by surname, keeping particles ("Le Guin", "van der Berg") and skipping suffixes ("Jr.", "III").
const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i
const PARTICLE = /^(le|la|de|del|della|di|da|du|des|van|von|der|den|ten|ter|bin|al|el|st\.?)$/i
// Names given in a spiritual tradition aren't "first name, surname": "Bhakti Vikasa Swami",
// "Gopiparanadhana Dasa" and "A.C. Bhaktivedanta Swami Srila Prabhupada" sort as written.
const TITLED = /\b(swami|svami|dasa?|dasi|devi|gosvami|goswami|thakura?|maharaja?|prabhupada|srila|sri|bhakti)\b/i

export function surnameKey(name = ''): string {
  if (TITLED.test(fold(name))) return fold(name)
  const parts = name.replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop()
  let i = parts.length - 1
  while (i > 1 && PARTICLE.test(parts[i - 1])) i--
  return fold(parts.slice(i).join(' ') + ' ' + parts.slice(0, i).join(' '))
}
