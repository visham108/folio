import { fold } from './match'

/**
 * Folio's genres: a short, fixed set, so filtering by genre means something. Whatever comes
 * in (a lookup's subjects, an import's categories, a tag typed by hand) is folded into these.
 */
export const GENRES = [
  'Scripture & Commentary',
  'Philosophy & Teachings',
  'Biography & Memoir',
  'Devotional Practice',
  'Epics & Stories',
  'Holy Places & Pilgrimage',
  'Self-Help & Psychology',
  'Science & Cosmology',
  'Poetry & Song',
  'History & Politics',
  'Business & Finance',
  'Technology',
  'Fiction & Fantasy',
  'Classics',
] as const
export type Genre = (typeof GENRES)[number]

const CLASSICS: Genre = 'Classics'

// Checked in order: the first rule a tag matches decides its genre ("Science Fiction" is fiction, not science).
const RULES: [RegExp, Genre][] = [
  [/\b(fiction|fantasy|novels?|thrillers?|myster(y|ies)|romance|horror|crime|dystopi|sci fi|literary)\b/, 'Fiction & Fantasy'],
  [/\b(scriptures?|sacred (books|texts|writings)|bhagavad|gita|bhagavat(am)?|puranas?|upanis(h)?ads?|vedas|commentar(y|ies)|sutras?|bible|quran|koran|torah)\b/, 'Scripture & Commentary'],
  [/\b(biograph(y|ies)|autobiograph(y|ies)|memoirs?|hagiograph(y|ies)|diar(y|ies)|saints?|personal narratives?)\b/, 'Biography & Memoir'],
  [/\b(pilgrimages?|travel|holy places|temples?|dhamas?|parikrama|tirthas?|guidebooks?|photograph(y|s)?)\b/, 'Holy Places & Pilgrimage'],
  [/\b(epics?|mytholog(y|ies)|myths?|ramayana?|mahabharata?|retellings?|folk(lore)?|fables?|legends?|stories|tales|antholog(y|ies))\b/, 'Epics & Stories'],
  [/\b(devotional|prayers?|worship|meditation|mantras?|japa|rituals?|samskaras?|sadhana|etiquettes?|brahmacar(ya|i)|celibacy|parenting|family|families|lifestyle|vegetarian|cook(ing|ery))\b/, 'Devotional Practice'],
  [/\b(self help|personal (growth|development)|motivation(al)?|success|happiness|psycholog(y|ical)|neuro\w*|mind|relationships?|wellness|mental health|habits?|emotions?)\b/, 'Self-Help & Psychology'],
  [/\b(poe(ms?|try|tic)|songs?|music|hymns?|bhajans?|kirtans?|verse)\b/, 'Poetry & Song'],
  [/\b(scien(ce|ces|tific)|cosmo(logy|graphy|s)|astronom(y|ical)|physics|ufos?|paranormal|evolution|biology|mathematics)\b/, 'Science & Cosmology'],
  [/\b(histor(y|ies|ical)|politics?|political|government|current affairs|wars?|civili[sz]ations?|sociology|social)\b/, 'History & Politics'],
  [/\b(business|financ(e|ial)|invest(ing|ment|ments)?|econom(y|ics|ic)|management|leadership|strateg(y|ic)|marketing|entrepreneur\w*|money|careers?)\b/, 'Business & Finance'],
  [/\b(computers?|computing|technolog(y|ies)|software|programming|security|cloud|certifications?|internet|engineering|electronics?)\b/, 'Technology'],
  [/\bclassics?\b/, CLASSICS],
  [/\b(philosoph(y|ies|ical)|theolog(y|ical)|teachings?|krishna|krsna|vais?h?navi?(sm)?|hare krishna|iskcon|bhakti|yoga|reincarnation|vedanta|consciousness|metaphysics?|ethics|wisdom|spiritual life)\b/, 'Philosophy & Teachings'],
]
// Broad religious tags say a book is spiritual, not which kind: used only when nothing more specific matches.
const BROAD = /\b(hindu(ism)?|religions?|religious|spiritual(ity)?|god|faith|interfaith|church|christian(ity)?|buddhis[mt]|islam|sikh(ism)?|jain(ism)?|sanatana dharma)\b/
// Titles that are themselves scripture, whatever the tags say.
const SCRIPTURE_TITLE = /\b(bhagavad|gita|bhagavatam|bhagavat|bhagavatamrta|upadesamrta|nectar of instruction|caritamrta|puranas?|upanis(h)?ads?)\b/

/** One tag in Folio's genres, or `undefined` when it says nothing about the kind of book. */
export function genreOf(tag: string): Genre | undefined {
  const t = fold(tag.replace(/[-_]/g, ' '))
  if (!t) return undefined
  const exact = GENRES.find((g) => fold(g) === t)
  if (exact) return exact
  return RULES.find(([re]) => re.test(t))?.[1]
}

/**
 * A book's tags in Folio's genres: at most three, plus Classics, in the order they came. A book
 * tagged only "Hinduism" or "Spirituality" counts as Philosophy & Teachings.
 */
export function canonicalGenres(tags: string[], hint: { title?: string; subtitle?: string } = {}): Genre[] {
  const out: Genre[] = []
  const add = (g?: Genre) => { if (g && !out.includes(g)) out.push(g) }
  if (SCRIPTURE_TITLE.test(fold(`${hint.title ?? ''} ${hint.subtitle ?? ''}`))) add('Scripture & Commentary')
  for (const t of tags) for (const part of t.split(/\s*(?:\/|>|;|--)\s*/)) add(genreOf(part))
  if (!out.length && tags.some((t) => BROAD.test(fold(t)))) add('Philosophy & Teachings')
  const main = out.filter((g) => g !== CLASSICS).slice(0, 3)
  return out.includes(CLASSICS) ? [...main, CLASSICS] : main
}

/** For a genre typed by hand: Folio's genre it belongs to, or '' when it doesn't fit one. */
export const typedGenre = (tag: string): string => genreOf(tag) ?? (BROAD.test(fold(tag)) ? 'Philosophy & Teachings' : '')

export const GENRE_HINT = 'Folio’s genres only: type one, or a word like “memoir” or “travel”, and it becomes the matching genre.'
