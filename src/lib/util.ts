export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

export const nowIso = () => new Date().toISOString()

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function yearOf(date?: string): number | undefined {
  if (!date) return undefined
  const y = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(y) ? y : undefined
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (i: number) => MONTHS[i]

export function fmtDate(date?: string, opts: { year?: boolean } = {}): string {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  if (!m) return String(y)
  if (!d) return `${MONTHS[m - 1]} ${y}`
  return `${MONTHS[m - 1]} ${d}${opts.year === false ? '' : `, ${y}`}`
}

export function daysBetween(a?: string, b?: string): number | undefined {
  if (!a || !b || a.length < 10 || b.length < 10) return undefined
  const ms = Date.parse(b) - Date.parse(a)
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

export function fmtDuration(min?: number): string {
  if (min == null || !Number.isFinite(min)) return ''
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Parses "11h 23m", "11:23", "683" (minutes) or "11.4h". */
export function parseDuration(s: string): number | undefined {
  const t = s.trim().toLowerCase()
  if (!t) return undefined
  const hm = t.match(/^(\d+)\s*:\s*(\d{1,2})$/)
  if (hm) return +hm[1] * 60 + +hm[2]
  const parts = t.match(/(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?/)
  if (parts && (parts[1] || parts[2])) return Math.round((parseFloat(parts[1] || '0') * 60) + parseInt(parts[2] || '0', 10))
  const n = parseFloat(t)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'K'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Deterministic, tasteful cover palette for books without artwork. */
const COVER_PALETTES: [string, string, string][] = [
  ['#2e3b33', '#e9dfc9', '#c49a52'],
  ['#5b2a26', '#f1e3d3', '#d9a46b'],
  ['#1f3047', '#e8e4da', '#b9c4cf'],
  ['#3a2f4a', '#efe7f2', '#c7a6d4'],
  ['#5d4a1f', '#f6eedb', '#e3bb57'],
  ['#20403f', '#e5efe9', '#86b8a6'],
  ['#7a3b22', '#fbeee2', '#f2a36b'],
  ['#2c2c2c', '#f2efe8', '#c4572e'],
  ['#41536b', '#f4f1ea', '#e7b46a'],
  ['#6b2f45', '#f7e8ec', '#e59ab2'],
]
export const coverPalette = (seed: string) => COVER_PALETTES[hashString(seed) % COVER_PALETTES.length]

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

export function groupBy<T, K extends string | number>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const it of items) {
    const k = key(it)
    const arr = m.get(k)
    if (arr) arr.push(it)
    else m.set(k, [it])
  }
  return m
}

export function cleanIsbn(s?: string): string | undefined {
  if (!s) return undefined
  const c = s.replace(/[^0-9Xx]/g, '').toUpperCase()
  return c.length === 10 || c.length === 13 ? c : undefined
}

export function isbn10to13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 ? 3 : 1)
  return core + ((10 - (sum % 10)) % 10)
}

export const splitList = (s: string) => s.split(/[,;]|\s+&\s+|\s+and\s+/).map((x) => x.trim()).filter(Boolean)
