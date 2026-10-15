import type { Edition, Entry, Read, Snapshot, Work } from './types'
import { FORMATS, STATUSES } from './types'

/** CSV downloads: one Goodreads-compatible (also accepted by StoryGraph), one complete. */

const cell = (v: unknown): string => {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'

const slash = (d?: string) => (d && d.length === 10 ? d.replace(/-/g, '/') : '')
const lastFirst = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return parts.length < 2 ? name : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`
}
const BINDING: Record<string, string> = { paperback: 'Paperback', hardcover: 'Hardcover', ebook: 'Kindle Edition', audiobook: 'Audible Audio', other: '' }
const SHELF: Record<string, string> = { want: 'to-read', reading: 'currently-reading', read: 'read', dnf: 'did-not-finish', paused: 'on-hold' }

interface Row { work: Work; entry: Entry; edition?: Edition; reads: Read[] }

function rowsOf(s: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads'>): Row[] {
  const works = new Map(s.works.map((w) => [w.id, w]))
  const eds = new Map(s.editions.map((e) => [e.id, e]))
  const byWork = new Map<string, Edition>()
  for (const e of s.editions) if (!byWork.has(e.workId)) byWork.set(e.workId, e)
  return s.entries
    .filter((e) => works.has(e.workId))
    .map((entry) => ({
      work: works.get(entry.workId)!,
      entry,
      edition: eds.get(entry.editionId ?? '') ?? byWork.get(entry.workId),
      reads: s.reads.filter((r) => r.entryId === entry.id).sort((a, b) => (a.finishedOn ?? a.startedOn ?? '').localeCompare(b.finishedOn ?? b.startedOn ?? '')),
    }))
    .sort((a, b) => a.work.title.localeCompare(b.work.title))
}

export function goodreadsCsv(s: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'shelves'>): string {
  const shelfName = new Map(s.shelves.map((sh) => [sh.id, sh.name.toLowerCase().replace(/\s+/g, '-')]))
  const head = ['Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13', 'My Rating', 'Average Rating',
    'Publisher', 'Binding', 'Number of Pages', 'Year Published', 'Original Publication Year', 'Date Read', 'Date Added',
    'Bookshelves', 'Bookshelves with positions', 'Exclusive Shelf', 'My Review', 'Spoiler', 'Private Notes', 'Read Count', 'Owned Copies']
  const rows = rowsOf(s).map(({ work, entry, edition, reads }, i) => {
    const finished = reads.filter((r) => r.state === 'finished')
    const lastDate = finished.map((r) => r.finishedOn).filter(Boolean).sort().pop()
    const exclusive = SHELF[entry.status]
    const shelves = [exclusive, ...entry.shelfIds.map((id) => shelfName.get(id)).filter(Boolean), ...entry.tags.map((t) => t.toLowerCase().replace(/\s+/g, '-'))]
    const title = work.series ? `${work.title} (${work.series}, #${work.seriesIndex ?? ''})`.replace(', #)', ')') : work.title
    return [
      i + 1, title, work.authors[0] ?? '', lastFirst(work.authors[0] ?? ''), work.authors.slice(1).join(', '),
      edition?.isbn10 ? `="${edition.isbn10}"` : '=""""', edition?.isbn13 ? `="${edition.isbn13}"` : '=""""',
      entry.rating ? Math.round(entry.rating) : 0, '', edition?.publisher ?? '', BINDING[edition?.format ?? 'other'],
      edition?.pages ?? '', edition?.publishedDate?.slice(0, 4) ?? '', work.firstPublished ?? '',
      slash(lastDate), slash(entry.addedAt.slice(0, 10)), shelves.join(', '), shelves.join(', '), exclusive,
      entry.review ?? '', '', '', finished.length, entry.owned ? 1 : 0,
    ]
  })
  return toCsv([head, ...rows])
}

/** Everything, one row per read (books never started get one row with blank dates). */
export function fullCsv(s: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'shelves'>): string {
  const eds = new Map(s.editions.map((e) => [e.id, e]))
  const shelfName = new Map(s.shelves.map((sh) => [sh.id, sh.name]))
  const fmt = (f?: string) => FORMATS.find((x) => x.id === f)?.label ?? ''
  const head = ['Title', 'Subtitle', 'Authors', 'Series', 'Series #', 'Genres', 'First published', 'Status', 'Your rating', 'Favourite', 'Owned',
    'Shelves', 'Tags', 'Moods', 'Pace', 'Date added', 'Read #', 'Read state', 'Started', 'Finished', 'Read rating', 'Format', 'Pages',
    'Audio length (min)', 'Narrators', 'Translators', 'Publisher', 'Edition published', 'ISBN-13', 'ISBN-10', 'ASIN', 'Language', 'Review', 'Read notes']
  const out: unknown[][] = [head]
  for (const { work, entry, edition, reads } of rowsOf(s)) {
    const base = [work.title, work.subtitle ?? '', work.authors.join('; '), work.series ?? '', work.seriesIndex ?? '', work.genres.join('; '),
      work.firstPublished ?? '', STATUSES.find((x) => x.id === entry.status)?.label ?? entry.status, entry.rating ?? '', entry.favorite ? 'yes' : '',
      entry.owned ? 'yes' : '', entry.shelfIds.map((id) => shelfName.get(id)).filter(Boolean).join('; '), entry.tags.join('; '),
      (entry.moods ?? []).join('; '), entry.pace ?? '', entry.addedAt.slice(0, 10)]
    const list: (Read | undefined)[] = reads.length ? reads : [undefined]
    list.forEach((r, i) => {
      const ed = (r?.editionId && eds.get(r.editionId)) || edition
      out.push([...base, r ? i + 1 : '', r?.state ?? '', r?.startedOn ?? '', r?.finishedOn ?? '', r?.rating ?? '', fmt(ed?.format), ed?.pages ?? '',
        ed?.durationMin ?? '', (ed?.narrators ?? []).join('; '), (ed?.translators ?? []).join('; '), ed?.publisher ?? '', ed?.publishedDate ?? '',
        ed?.isbn13 ?? '', ed?.isbn10 ?? '', ed?.asin ?? '', ed?.language ?? '', entry.review ?? '', r?.notes ?? ''])
    })
  }
  return toCsv(out)
}

export function downloadText(text: string, filename: string, type = 'text/csv') {
  // A byte-order mark makes Excel open UTF-8 (accents, curly quotes) correctly.
  const blob = new Blob(['﻿', text], { type: `${type};charset=utf-8` })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
