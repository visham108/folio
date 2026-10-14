/**
 * Title-cases text people type in, so "the left hand of darkness" becomes
 * "The Left Hand of Darkness" and "j.r.r. tolkien" becomes "J.R.R. Tolkien".
 *
 * Deliberate casing is kept: mixed-case words ("McCarthy", "iPhone") and
 * acronyms typed in capitals inside otherwise lower-case text ("a history of
 * NASA") are left alone. Text typed entirely in capitals is treated as
 * lower case first.
 */

// Minor words stay lower case mid-title (Chicago style).
const SMALL = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'vs', 'from', 'into', 'onto', 'with', 'over',
])
// Surname particles stay lower case when not the first word of a name.
const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'du', 'da', 'di', 'del', 'della', 'dos', 'das', 'bin', 'ibn'])
const ROMAN = new Set(['ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'])

const LETTER = /\p{L}/u
const upperFirst = (s: string) => {
  const i = s.search(LETTER)
  return i < 0 ? s : s.slice(0, i) + s[i].toLocaleUpperCase() + s.slice(i + 1)
}
const isLower = (s: string) => s === s.toLocaleLowerCase()
const isUpper = (s: string) => s === s.toLocaleUpperCase() && s !== s.toLocaleLowerCase()
/** "McCarthy", "iPhone", "DeLillo": casing someone chose on purpose. */
const isDeliberate = (w: string) => !isLower(w) && !isUpper(w) && w.slice(1) !== w.slice(1).toLocaleLowerCase()

type Kind = 'title' | 'name'

function caseWord(word: string, kind: Kind, first: boolean, last: boolean, afterBreak: boolean, allCaps: boolean): string {
  if (!LETTER.test(word)) return word
  if (!allCaps && (isDeliberate(word) || (isUpper(word) && word.replace(/[^\p{L}]/gu, '').length > 1))) return word
  const lower = word.toLocaleLowerCase()
  const bare = lower.replace(/[^\p{L}\p{N}']/gu, '')

  if (ROMAN.has(bare)) return lower.toLocaleUpperCase()
  if (kind === 'title' && !first && !last && !afterBreak && SMALL.has(bare)) return lower
  if (kind === 'name' && !first && PARTICLES.has(bare)) return lower

  // Capitalise each hyphen-separated part and every letter after a full stop (initials).
  let out = lower.split('-').map(upperFirst).join('-')
  out = out.replace(/\.(\p{L})/gu, (_, c: string) => '.' + c.toLocaleUpperCase())
  if (kind === 'name') {
    out = out.replace(/^([OD]')(\p{L})/u, (_, p: string, c: string) => p + c.toLocaleUpperCase()) // O'Brien, D'Angelo
    out = out.replace(/^Mc(\p{L})(?=\p{L})/u, (_, c: string) => 'Mc' + c.toLocaleUpperCase()) // McCarthy
  }
  return out
}

function convert(text: string, kind: Kind): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const allCaps = isUpper(trimmed)
  const words = trimmed.split(' ')
  return words
    .map((w, i) => {
      const prev = words[i - 1] ?? ''
      // A new clause after ":", "—", "?" or "!" starts with a capital.
      const afterBreak = /[:—–?!.]$/.test(prev) || prev === '-'
      return caseWord(w, kind, i === 0, i === words.length - 1, afterBreak, allCaps)
    })
    .join(' ')
}

/** Book titles, subtitles, series, genres, publishers, shelves, tags. */
export const titleCase = (text: string) => convert(text, 'title')
/** People: authors, narrators, translators, your name. */
export const nameCase = (text: string) => convert(text, 'name')
