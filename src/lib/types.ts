/**
 * Data model
 *
 *  Work      – the abstract book ("Dune"). Shared catalogue, one per book.
 *  Edition   – a concrete printing/recording of a work (2005 Ace paperback,
 *              2007 Macmillan audiobook narrated by …). Many per work.
 *  Entry     – a user's relationship with a work: pile, rating, review, tags.
 *  Read      – one pass through the book. Rereads are simply more Reads, each
 *              with its own dates, edition (you can reread on audio) and rating.
 *  LogPoint  – a progress update; powers streaks and the activity heatmap.
 */

export type Format = 'hardcover' | 'paperback' | 'ebook' | 'audiobook' | 'other'
export type Medium = 'print' | 'ebook' | 'audio'

export const FORMATS: { id: Format; label: string }[] = [
  { id: 'paperback', label: 'Paperback' },
  { id: 'hardcover', label: 'Hardcover' },
  { id: 'ebook', label: 'Ebook' },
  { id: 'audiobook', label: 'Audiobook' },
  { id: 'other', label: 'Other' },
]

export function mediumOf(f?: Format): Medium {
  if (f === 'audiobook') return 'audio'
  if (f === 'ebook') return 'ebook'
  return 'print'
}

export interface Work {
  id: string
  title: string
  subtitle?: string
  authors: string[]
  series?: string
  seriesIndex?: number
  description?: string
  genres: string[]
  firstPublished?: number
  originalLanguage?: string
  createdBy?: string
  createdAt: string
  updatedBy?: string
  updatedAt?: string
}

export interface Edition {
  id: string
  workId: string
  format: Format
  /** Edition-specific title when it differs (translations, retitled UK/US editions). */
  title?: string
  publisher?: string
  publishedDate?: string
  isbn13?: string
  isbn10?: string
  asin?: string
  language?: string
  pages?: number
  /** Audiobooks: total runtime in minutes. */
  durationMin?: number
  narrators: string[]
  translators: string[]
  coverUrl?: string
  note?: string
  createdBy?: string
  createdAt: string
  updatedBy?: string
  updatedAt?: string
}

export type Status = 'want' | 'reading' | 'read' | 'dnf' | 'paused'

export const STATUSES: { id: Status; label: string; short: string }[] = [
  { id: 'reading', label: 'Currently reading', short: 'Reading' },
  { id: 'want', label: 'Want to read', short: 'Want to read' },
  { id: 'read', label: 'Read', short: 'Read' },
  { id: 'paused', label: 'Paused', short: 'Paused' },
  { id: 'dnf', label: 'Did not finish', short: 'DNF' },
]

export interface Entry {
  id: string
  workId: string
  /** The edition shown on your shelf (cover, page count). */
  editionId?: string
  status: Status
  /** 0.5 – 5 in half-star steps. Latest read's rating wins unless set here. */
  rating?: number
  review?: string
  favorite: boolean
  owned: boolean
  tags: string[]
  shelfIds: string[]
  /** How the book felt to you (see MOODS). */
  moods?: string[]
  pace?: Pace
  addedAt: string
  updatedAt: string
}

export type Pace = 'slow' | 'medium' | 'fast'
export const PACES: { id: Pace; label: string }[] = [
  { id: 'slow', label: 'Slow' },
  { id: 'medium', label: 'Medium' },
  { id: 'fast', label: 'Fast' },
]

/** A fixed vocabulary keeps mood stats meaningful (StoryGraph uses a similar set). */
export const MOODS = [
  'adventurous', 'challenging', 'dark', 'emotional', 'funny', 'hopeful',
  'informative', 'inspiring', 'lighthearted', 'mysterious', 'reflective', 'relaxing', 'sad', 'tense',
] as const

export type ReadState = 'reading' | 'finished' | 'dnf' | 'paused'

export interface Read {
  id: string
  entryId: string
  editionId?: string
  state: ReadState
  /** ISO date (yyyy-mm-dd). Optional – people often only remember the year. */
  startedOn?: string
  finishedOn?: string
  /** Pages for print, minutes for audio, percent for ebooks without page counts. */
  progress?: number
  rating?: number
  notes?: string
}

export interface LogPoint {
  id: string
  readId: string
  on: string // yyyy-mm-dd
  /** Pages (print/ebook) or minutes (audio) moved forward on that day. */
  amount: number
  medium: Medium
}

export interface Shelf {
  id: string
  name: string
  emoji?: string
  position: number
}

export interface Settings {
  displayName?: string
  yearlyGoal: number
  /** How many pages an hour of listening counts as when combining stats. */
  audioPagesPerHour: number
  theme: 'system' | 'light' | 'dark'
}

export const DEFAULT_SETTINGS: Settings = { yearlyGoal: 24, audioPagesPerHour: 30, theme: 'system' }

export interface Snapshot {
  works: Work[]
  editions: Edition[]
  entries: Entry[]
  reads: Read[]
  logs: LogPoint[]
  shelves: Shelf[]
  settings: Settings
}

export const emptySnapshot = (): Snapshot => ({
  works: [], editions: [], entries: [], reads: [], logs: [], shelves: [], settings: { ...DEFAULT_SETTINGS },
})
