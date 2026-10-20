import { ArrowDown, ArrowUp, Columns3, Lock } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { nameCase, titleCase } from '../lib/titleCase'
import {
  FORMATS, MOODS, PACES, STATUSES, type Edition, type Entry, type Format, type Pace, type Read, type Status, type Work,
} from '../lib/types'
import { cleanIsbn, fmtDate, fmtDuration, isAllowedCoverUrl, localIso, parseDuration, plural, today } from '../lib/util'
import { useStore, type BookPatch } from '../state/store'
import { useToast } from '../state/toast'

/**
 * Every attribute of every book in one table: sort by any column, hide the ones you don't need,
 * tick rows to bulk edit them, or click a cell to change just that value.
 */

export interface Row { entry: Entry; work: Work; edition?: Edition; reads: Read[]; latest?: Read; finished: number }
type Kind = 'text' | 'longtext' | 'number' | 'list' | 'enum' | 'bool' | 'rating' | 'date' | 'duration' | 'cover' | 'unique' | 'none'
export type Group = 'Book' | 'Edition' | 'Your copy' | 'Reading'

export interface Col {
  key: string
  label: string
  group: Group
  kind: Kind
  width: number
  /** The value as text: shown in the cell, used for sorting and as the starting value when editing. */
  text: (r: Row) => string
  /** A number to sort by, when text sorting would be wrong (pages, dates as numbers…). */
  sort?: (r: Row) => number | string
  options?: { id: string; label: string }[]
  /** Book/edition fields live in the shared catalogue. */
  catalogue?: 'work' | 'edition'
  tidy?: (s: string) => string
}

const list = (xs?: string[]) => (xs ?? []).join(', ')
const yesNo = (b: boolean) => (b ? 'Yes' : 'No')
const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s
const formatLabel = (f?: Format) => FORMATS.find((x) => x.id === f)?.label ?? ''

export function makeColumns(shelfName: (id: string) => string): Col[] {
  return [
    { key: 'title', label: 'Title', group: 'Book', kind: 'text', width: 260, text: (r) => r.work.title, catalogue: 'work', tidy: titleCase },
    { key: 'subtitle', label: 'Subtitle', group: 'Book', kind: 'text', width: 220, text: (r) => r.work.subtitle ?? '', catalogue: 'work', tidy: titleCase },
    { key: 'authors', label: 'Authors', group: 'Book', kind: 'list', width: 200, text: (r) => list(r.work.authors), catalogue: 'work', tidy: nameCase },
    { key: 'series', label: 'Series', group: 'Book', kind: 'text', width: 180, text: (r) => r.work.series ?? '', catalogue: 'work', tidy: titleCase },
    { key: 'seriesIndex', label: '#', group: 'Book', kind: 'number', width: 56, text: (r) => r.work.seriesIndex?.toString() ?? '', sort: (r) => r.work.seriesIndex ?? -1, catalogue: 'work' },
    { key: 'genres', label: 'Genres', group: 'Book', kind: 'list', width: 200, text: (r) => list(r.work.genres), catalogue: 'work', tidy: titleCase },
    { key: 'firstPublished', label: 'First published', group: 'Book', kind: 'number', width: 110, text: (r) => r.work.firstPublished?.toString() ?? '', sort: (r) => r.work.firstPublished ?? -99999, catalogue: 'work' },
    { key: 'originalLanguage', label: 'Original language', group: 'Book', kind: 'text', width: 130, text: (r) => r.work.originalLanguage ?? '', catalogue: 'work' },
    { key: 'description', label: 'Description', group: 'Book', kind: 'longtext', width: 260, text: (r) => (r.work.description ?? '').replace(/<[^>]+>/g, ''), catalogue: 'work' },

    { key: 'format', label: 'Format', group: 'Edition', kind: 'enum', width: 110, text: (r) => formatLabel(r.edition?.format), options: FORMATS.map((f) => ({ id: f.id, label: f.label })) },
    { key: 'pages', label: 'Pages', group: 'Edition', kind: 'number', width: 76, text: (r) => r.edition?.pages?.toString() ?? '', sort: (r) => r.edition?.pages ?? -1, catalogue: 'edition' },
    { key: 'durationMin', label: 'Length', group: 'Edition', kind: 'duration', width: 90, text: (r) => (r.edition?.durationMin ? fmtDuration(r.edition.durationMin) : ''), sort: (r) => r.edition?.durationMin ?? -1, catalogue: 'edition' },
    { key: 'publisher', label: 'Publisher', group: 'Edition', kind: 'text', width: 160, text: (r) => r.edition?.publisher ?? '', catalogue: 'edition', tidy: titleCase },
    { key: 'publishedDate', label: 'Edition published', group: 'Edition', kind: 'text', width: 120, text: (r) => r.edition?.publishedDate ?? '', catalogue: 'edition' },
    { key: 'language', label: 'Language', group: 'Edition', kind: 'text', width: 90, text: (r) => r.edition?.language ?? '', catalogue: 'edition' },
    { key: 'isbn', label: 'ISBN', group: 'Edition', kind: 'unique', width: 140, text: (r) => r.edition?.isbn13 ?? r.edition?.isbn10 ?? '', catalogue: 'edition' },
    { key: 'asin', label: 'ASIN', group: 'Edition', kind: 'unique', width: 120, text: (r) => r.edition?.asin ?? '', catalogue: 'edition' },
    { key: 'narrators', label: 'Narrators', group: 'Edition', kind: 'list', width: 170, text: (r) => list(r.edition?.narrators), catalogue: 'edition', tidy: nameCase },
    { key: 'translators', label: 'Translators', group: 'Edition', kind: 'list', width: 170, text: (r) => list(r.edition?.translators), catalogue: 'edition', tidy: nameCase },
    { key: 'note', label: 'Edition note', group: 'Edition', kind: 'text', width: 170, text: (r) => r.edition?.note ?? '', catalogue: 'edition' },
    { key: 'coverUrl', label: 'Cover link', group: 'Edition', kind: 'cover', width: 120, text: (r) => (r.edition?.coverUrl?.startsWith('http') ? r.edition.coverUrl : r.edition?.coverUrl ? '(photo)' : ''), catalogue: 'edition' },

    { key: 'status', label: 'Pile', group: 'Your copy', kind: 'enum', width: 130, text: (r) => statusLabel(r.entry.status), options: STATUSES.map((s) => ({ id: s.id, label: s.label })) },
    { key: 'rating', label: 'Rating', group: 'Your copy', kind: 'rating', width: 80, text: (r) => (r.entry.rating ? `${r.entry.rating}★` : ''), sort: (r) => r.entry.rating ?? 0 },
    { key: 'tags', label: 'Tags', group: 'Your copy', kind: 'list', width: 170, text: (r) => list(r.entry.tags), tidy: titleCase },
    { key: 'shelfIds', label: 'Shelves', group: 'Your copy', kind: 'none', width: 170, text: (r) => r.entry.shelfIds.map(shelfName).filter(Boolean).join(', ') },
    { key: 'moods', label: 'Moods', group: 'Your copy', kind: 'list', width: 170, text: (r) => (r.entry.moods ?? []).map((m) => m[0].toUpperCase() + m.slice(1)).join(', ') },
    { key: 'pace', label: 'Pace', group: 'Your copy', kind: 'enum', width: 90, text: (r) => PACES.find((p) => p.id === r.entry.pace)?.label ?? '', options: [{ id: '', label: '—' }, ...PACES.map((p) => ({ id: p.id, label: p.label }))] },
    { key: 'owned', label: 'Owned', group: 'Your copy', kind: 'bool', width: 76, text: (r) => yesNo(r.entry.owned) },
    { key: 'favorite', label: 'Favourite', group: 'Your copy', kind: 'bool', width: 84, text: (r) => yesNo(r.entry.favorite) },
    { key: 'review', label: 'Your notes', group: 'Your copy', kind: 'longtext', width: 220, text: (r) => r.entry.review ?? '' },
    { key: 'addedAt', label: 'Added', group: 'Your copy', kind: 'none', width: 110, text: (r) => fmtDate(localIso(new Date(r.entry.addedAt))), sort: (r) => r.entry.addedAt },

    { key: 'timesRead', label: 'Times read', group: 'Reading', kind: 'none', width: 86, text: (r) => (r.finished ? String(r.finished) : ''), sort: (r) => r.finished },
    { key: 'startedOn', label: 'Started', group: 'Reading', kind: 'date', width: 120, text: (r) => (r.latest?.startedOn ? fmtDate(r.latest.startedOn) : ''), sort: (r) => r.latest?.startedOn ?? '' },
    { key: 'finishedOn', label: 'Finished', group: 'Reading', kind: 'date', width: 120, text: (r) => (r.latest?.finishedOn ? fmtDate(r.latest.finishedOn) : ''), sort: (r) => r.latest?.finishedOn ?? '' },
    { key: 'readNotes', label: 'Notes on the read', group: 'Reading', kind: 'longtext', width: 220, text: (r) => r.latest?.notes ?? '' },
  ]
}

const HIDDEN_KEY = 'folio.tableHidden'
const PAGE = 200

/** What a single-cell edit changes, as a bulk-edit patch for one book. */
function cellPatch(c: Col, raw: string): BookPatch | string {
  const v = raw.trim()
  const items = v ? v.split(/\s*,\s*/).filter(Boolean).map((x) => (c.tidy ? c.tidy(x) : x)) : []
  const num = v === '' ? undefined : Number(v.replace(',', '.'))
  if (c.kind === 'number' && num !== undefined && !Number.isFinite(num)) return 'That isn’t a number.'
  switch (c.key) {
    case 'title': return v ? { work: () => ({ title: titleCase(v) }) } : 'A book needs a title.'
    case 'authors': return items.length ? { work: () => ({ authors: items }) } : 'A book needs at least one author.'
    case 'subtitle': case 'series': case 'originalLanguage': case 'description':
      return { work: () => ({ [c.key]: v ? (c.tidy ? c.tidy(v) : v) : undefined }) }
    case 'seriesIndex': return { work: () => ({ seriesIndex: num }) }
    case 'firstPublished': return { work: () => ({ firstPublished: num == null ? undefined : Math.round(num) }) }
    case 'genres': return { work: () => ({ genres: items }) }
    case 'format': return { format: v as Format }
    case 'pages': return { edition: () => ({ pages: num == null ? undefined : Math.round(num) }) }
    case 'durationMin': {
      const d = v ? parseDuration(v) : undefined
      if (v && d == null) return 'Use a length like 11h 23m.'
      return { edition: () => ({ durationMin: d }) }
    }
    case 'publisher': case 'publishedDate': case 'language': case 'note':
      return { edition: () => ({ [c.key]: v ? (c.tidy ? c.tidy(v) : v) : undefined }) }
    case 'isbn': {
      const i = v ? cleanIsbn(v) : undefined
      if (v && !i) return 'That isn’t a valid ISBN.'
      return { edition: () => ({ isbn13: i?.length === 13 ? i : undefined, isbn10: i?.length === 10 ? i : undefined }) }
    }
    case 'asin': return { edition: () => ({ asin: v ? v.toUpperCase() : undefined }) }
    case 'narrators': case 'translators': return { edition: () => ({ [c.key]: items }) }
    case 'coverUrl':
      if (v && !isAllowedCoverUrl(v)) return 'Use a link from Google Books or Open Library.'
      return { edition: () => ({ coverUrl: v || undefined }) }
    case 'status': return { status: v as Status }
    case 'rating': return { rating: v ? Number(v) : null }
    case 'tags': return { entry: () => ({ tags: items }) }
    case 'moods': {
      const ms = items.map((x) => x.toLowerCase()).filter((x) => (MOODS as readonly string[]).includes(x))
      return { entry: () => ({ moods: ms }) }
    }
    case 'pace': return { entry: () => ({ pace: (v || undefined) as Pace | undefined }) }
    case 'owned': case 'favorite': return { entry: () => ({ [c.key]: v === 'yes' }) }
    case 'review': return { entry: () => ({ review: v || undefined }) }
    case 'startedOn': case 'finishedOn':
      if (v && v > today()) return 'Dates can’t be in the future.'
      return { read: () => ({ [c.key]: v || undefined }) }
    case 'readNotes': return { read: () => ({ notes: v || undefined }) }
  }
  return 'This column can’t be edited here.'
}

type Store = ReturnType<typeof useStore>

/** One book as a table row: its entry, work, your edition and reads. */
export function rowOf(store: Store, entry: Entry): Row {
  const work = store.works.get(entry.workId)!
  const reads = store.readsByEntry.get(entry.id) ?? []
  const latest = reads.find((r) => r.state === 'reading' || r.state === 'paused')
    ?? [...reads].sort((a, b) => (a.finishedOn ?? a.startedOn ?? '').localeCompare(b.finishedOn ?? b.startedOn ?? '')).pop()
  return { entry, work, edition: store.editionOf(entry), reads, latest, finished: reads.filter((r) => r.state === 'finished').length }
}

export function useColumns(): Col[] {
  const store = useStore()
  const shelfName = (id: string) => store.data.shelves.find((s) => s.id === id)?.name ?? ''
  return useMemo(() => makeColumns(shelfName), [store.data.shelves]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Click-to-change for a single value, shared by the table and the book page's details. */
export function useCellEditor() {
  const store = useStore()
  const toast = useToast()
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null)
  const [draft, setDraft] = useState('')
  const locked = (c: Col, r: Row) =>
    (c.catalogue === 'work' && !store.canEdit(r.work)) || (c.catalogue === 'edition' && !!r.edition && !store.canEdit(r.edition))
  const startEdit = (c: Col, r: Row) => {
    if (c.kind === 'none' || locked(c, r)) return
    if (c.key === 'isbn' || c.key === 'asin' || c.catalogue === 'edition') { if (!r.edition) return }
    const start =
      c.kind === 'enum' ? (c.key === 'status' ? r.entry.status : c.key === 'format' ? r.edition?.format ?? '' : r.entry.pace ?? '')
        : c.kind === 'bool' ? (r.entry[c.key as 'owned' | 'favorite'] ? 'yes' : 'no')
          : c.kind === 'rating' ? String(r.entry.rating ?? '')
            : c.kind === 'date' ? (r.latest?.[c.key as 'startedOn' | 'finishedOn'] ?? '')
              : c.key === 'coverUrl' ? (r.edition?.coverUrl?.startsWith('http') ? r.edition.coverUrl : '')
                : c.key === 'moods' ? (r.entry.moods ?? []).join(', ')
                  : c.text(r)
    setDraft(start)
    setEditing({ id: r.entry.id, key: c.key })
  }
  const commit = (c: Col, r: Row, value = draft) => {
    setEditing(null)
    const before = c.kind === 'enum' || c.kind === 'bool' || c.kind === 'rating' || c.kind === 'date' ? null : c.text(r)
    if (before !== null && value.trim() === before.trim()) return
    const patch = cellPatch(c, value)
    if (typeof patch === 'string') { toast(patch, { tone: 'error' }); return }
    if ((c.kind === 'date' || c.key === 'readNotes') && !r.latest) { toast('This book has no reads yet. Log one from its page first.', { tone: 'error' }); return }
    const res = store.patchBook(r.entry.id, patch)
    if (res.locked) toast('Another reader added this book, so only the admin can change its details.', { tone: 'error' })
    else if (res.badDates) toast('That would put the finish before the start.', { tone: 'error' })
  }

  const editor = (c: Col, r: Row): ReactNode => {
    const keys = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
      if (e.key === 'Enter' && !(c.kind === 'longtext' && e.shiftKey)) { e.preventDefault(); commit(c, r) }
    }
    const common = { autoFocus: true, className: 'cell-input', 'aria-label': c.label, onKeyDown: keys }
    if (c.kind === 'enum' || c.kind === 'bool' || c.kind === 'rating') {
      const opts = c.kind === 'bool' ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
        : c.kind === 'rating' ? [{ id: '', label: 'No rating' }, ...[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((n) => ({ id: String(n), label: `${n}★` }))]
          : c.options ?? []
      return (
        <select {...common} value={draft} onChange={(e) => commit(c, r, e.target.value)} onBlur={() => setEditing(null)}>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )
    }
    if (c.kind === 'date') return <input {...common} type="date" max={today()} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(c, r)} />
    if (c.kind === 'longtext') return <textarea {...common} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(c, r)} />
    return <input {...common} value={draft} inputMode={c.kind === 'number' ? 'decimal' : undefined}
      placeholder={c.kind === 'list' ? 'Separate with commas' : c.kind === 'duration' ? '11h 23m' : undefined}
      onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(c, r)} />
  }

  const editable = (c: Col, r: Row) => c.kind !== 'none' && !locked(c, r) && (c.catalogue !== 'edition' || !!r.edition)
  const isEditing = (c: Col, r: Row) => editing?.id === r.entry.id && editing.key === c.key
  return { locked, editable, startEdit, editor, isEditing }
}

export function LibraryTable({ entries, selected, onToggle, onSetSelected }: {
  entries: Entry[]
  selected: Set<string>
  onToggle: (id: string) => void
  onSetSelected: (ids: Set<string>) => void
}) {
  const store = useStore()
  const columns = useColumns()
  const { locked, editable: canChange, startEdit, editor, isEditing: cellEditing } = useCellEditor()
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')) } catch { return new Set() }
  })
  const saveHidden = (h: Set<string>) => { setHidden(h); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...h])) } catch { /* private mode */ } }
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [showCols, setShowCols] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const rows = useMemo<Row[]>(() => entries.map((entry) => rowOf(store, entry)),
    [entries, store.works, store.readsByEntry, store.editions]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = columns.filter((c) => !hidden.has(c.key) || c.key === 'title')
  const sorted = useMemo(() => {
    if (!sort) return rows
    const c = columns.find((x) => x.key === sort.key)
    if (!c) return rows
    const val = c.sort ?? c.text
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b)
      // Empty cells go last whichever way you sort.
      if (x === '' && y !== '') return 1
      if (y === '' && x !== '') return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir
    })
  }, [rows, sort, columns])
  const shown = sorted.slice(0, limit)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.entry.id))

  // Band headers: one per group, spanning its visible columns.
  const groups = visible.reduce<{ group: Group; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1]
    if (last && last.group === c.group) last.span++
    else acc.push({ group: c.group, span: 1 })
    return acc
  }, [])

  return (
    <div className="ltable-wrap">
      <div className="ltable-tools">
        <span className="muted small">{plural(rows.length, 'book')} · click a cell to change it, or tick rows to edit several</span>
        <button className="btn btn-ghost sm" aria-expanded={showCols} onClick={() => setShowCols((x) => !x)}><Columns3 size={14} /> Columns{hidden.size ? ` (${columns.length - hidden.size} of ${columns.length})` : ''}</button>
      </div>
      {showCols && (
        <div className="ltable-cols card">
          {(['Book', 'Edition', 'Your copy', 'Reading'] as Group[]).map((g) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              {columns.filter((c) => c.group === g).map((c) => (
                <label key={c.key} className="check">
                  <input type="checkbox" checked={!hidden.has(c.key)} disabled={c.key === 'title'}
                    onChange={() => { const h = new Set(hidden); if (h.has(c.key)) h.delete(c.key); else h.add(c.key); saveHidden(h) }} />
                  {c.label}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="btn-row">
            <button className="btn btn-ghost sm" onClick={() => saveHidden(new Set())}>Show all</button>
            <button className="btn btn-ghost sm" onClick={() => saveHidden(new Set(columns.filter((c) => !['title', 'authors', 'format', 'pages', 'status', 'rating', 'finishedOn'].includes(c.key)).map((c) => c.key)))}>Just the essentials</button>
          </div>
        </div>
      )}
      <div className="ltable-scroll" role="region" aria-label="All your books" tabIndex={0}>
        <table className="ltable">
          <thead>
            <tr className="ltable-bands">
              <th className="sticky-col check-col" />
              {groups.map((g, i) => <th key={i} colSpan={g.span} className={`band band-${g.group.replace(' ', '-').toLowerCase()}`}>{g.group}</th>)}
            </tr>
            <tr>
              <th className="sticky-col check-col">
                <input type="checkbox" aria-label={allSelected ? 'Select none' : 'Select all'} checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && rows.some((r) => selected.has(r.entry.id)) }}
                  onChange={() => onSetSelected(allSelected ? new Set() : new Set(rows.map((r) => r.entry.id)))} />
              </th>
              {visible.map((c) => (
                <th key={c.key} style={{ minWidth: c.width }} className={c.key === 'title' ? 'sticky-col title-col' : ''}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button className="th-btn" onClick={() => setSort(sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}>
                    {c.label}
                    {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const on = selected.has(r.entry.id)
              return (
                <tr key={r.entry.id} className={on ? 'selected' : ''}>
                  <td className="sticky-col check-col">
                    <input type="checkbox" checked={on} aria-label={`Select ${r.work.title}`} onChange={() => onToggle(r.entry.id)} />
                  </td>
                  {visible.map((c) => {
                    const isEditing = cellEditing(c, r)
                    const lock = locked(c, r)
                    const editable = canChange(c, r)
                    if (c.key === 'title' && !isEditing) {
                      return (
                        <td key={c.key} className="sticky-col title-col">
                          <div className="title-cell">
                            <Link to={`/book/${r.work.id}`} className="title-link">{r.work.title}</Link>
                            {editable && <button className="cell-edit" aria-label={`Edit title of ${r.work.title}`} onClick={() => startEdit(c, r)}>Edit</button>}
                          </div>
                        </td>
                      )
                    }
                    const text = c.text(r)
                    return (
                      <td key={c.key} className={`${isEditing ? 'editing' : ''} ${editable ? 'editable' : ''} ${c.kind === 'longtext' ? 'long' : ''} ${c.key === 'title' ? 'sticky-col title-col' : ''}`}
                        title={lock ? 'Added by another reader: only the admin can change this' : text.length > 40 ? text : undefined}>
                        {isEditing ? editor(c, r) : editable ? (
                          <button className="cell-btn" onClick={() => startEdit(c, r)} aria-label={`${c.label}: ${text || 'empty'}. Change`}>
                            {text || <span className="cell-empty">—</span>}
                          </button>
                        ) : (
                          <span className="cell-ro">{lock && <Lock size={10} />} {text || <span className="cell-empty">—</span>}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <div className="center pad"><button className="btn btn-ghost sm" onClick={() => setLimit((l) => l + PAGE * 5)}>Show {Math.min(PAGE * 5, sorted.length - limit)} more of {sorted.length - limit}</button></div>
      )}
    </div>
  )
}
