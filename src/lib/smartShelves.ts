import type { Series } from './series'
import type { Edition, Entry, Read, Work } from './types'

/**
 * Shelves Folio fills in by itself. No rules to set up: each one is a question
 * readers commonly ask of their library. Empty ones are hidden.
 */
export interface SmartContext {
  work: Work
  entry: Entry
  edition?: Edition
  reads: Read[]
  /** Works that are the next unread book in a series you've started. */
  nextInSeries: Set<string>
  now: number
}

export interface SmartShelf {
  id: string
  name: string
  description: string
  match: (c: SmartContext) => boolean
}

const DAY = 86400000
const hours = (e?: Edition) => (e?.durationMin ?? 0) / 60
const finished = (c: SmartContext) => c.reads.filter((r) => r.state === 'finished')
const unstarted = (c: SmartContext) => c.entry.status === 'want'

export const SMART_SHELVES: SmartShelf[] = [
  {
    id: 'quick-reads', name: 'Quick reads', description: 'On your want-to-read list and under 250 pages or 6 hours of listening.',
    match: (c) => unstarted(c) && ((c.edition?.format === 'audiobook' && hours(c.edition) > 0 && hours(c.edition) < 6) || (!!c.edition?.pages && c.edition.pages < 250)),
  },
  {
    id: 'long-haul', name: 'Long haul', description: 'Want-to-read books over 500 pages or 15 hours, for when you’re ready to settle in.',
    match: (c) => unstarted(c) && ((c.edition?.pages ?? 0) >= 500 || hours(c.edition) >= 15),
  },
  {
    id: 'next-in-series', name: 'Next in a series', description: 'The next unread book in a series you’ve started.',
    match: (c) => c.nextInSeries.has(c.work.id),
  },
  {
    id: 'listen-next', name: 'Ready to listen', description: 'Want-to-read books where your edition is an audiobook.',
    match: (c) => unstarted(c) && c.edition?.format === 'audiobook',
  },
  {
    id: 'owned-unread', name: 'Owned, not yet read', description: 'Books you have a copy of and haven’t started.',
    match: (c) => c.entry.owned && !finished(c).length && c.entry.status === 'want',
  },
  {
    id: 'waiting-longest', name: 'Waiting over a year', description: 'Want-to-read books added more than a year ago.',
    match: (c) => unstarted(c) && !c.reads.length && c.now - Date.parse(c.entry.addedAt) > 365 * DAY,
  },
  {
    id: 'unfinished', name: 'Unfinished business', description: 'Books you paused or set aside.',
    match: (c) => c.entry.status === 'paused' || c.entry.status === 'dnf',
  },
  {
    id: 'top-rated', name: 'Your best', description: 'Books you rated 4.5 stars or higher.',
    match: (c) => (c.entry.rating ?? 0) >= 4.5,
  },
  {
    id: 'reread', name: 'Read more than once', description: 'Books you’ve finished at least twice.',
    match: (c) => finished(c).length >= 2,
  },
  {
    id: 'this-year', name: `Read in ${new Date().getFullYear()}`, description: 'Everything you’ve finished this calendar year.',
    match: (c) => finished(c).some((r) => r.finishedOn?.startsWith(String(new Date().getFullYear()))),
  },
]

export const smartId = (id: string) => `smart-${id}`
export const findSmart = (pile: string) => SMART_SHELVES.find((s) => smartId(s.id) === pile)

export function nextInSeriesIds(series: Series[]): Set<string> {
  return new Set(series.map((s) => s.next?.work.id).filter((x): x is string => !!x))
}
