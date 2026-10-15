import { ChevronDown, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { nameCase, titleCase } from '../lib/titleCase'
import {
  FORMATS, MOODS, PACES, STATUSES, type Edition, type Entry, type Format, type Pace, type Read, type Status, type Work,
} from '../lib/types'
import { cleanIsbn, isAllowedCoverUrl, parseDuration, plural, today } from '../lib/util'
import { useStore, type BookPatch } from '../state/store'
import { useToast } from '../state/toast'
import { Chips, ConfirmSheet, Stars, Sheet } from './ui'

/**
 * Bulk edit: every field you can set on one book, applied to many. Each field has its own
 * "what to do" (leave, set, clear, add, remove, find & replace); anything left alone isn't touched.
 */

type Mode = 'keep' | 'set' | 'clear' | 'add' | 'remove' | 'replace'
type Kind = 'text' | 'longtext' | 'number' | 'list' | 'enum' | 'bool' | 'rating' | 'date' | 'duration' | 'cover' | 'unique'
type Group = 'book' | 'edition' | 'copy' | 'read'

interface FieldDef {
  key: string
  label: string
  group: Group
  kind: Kind
  /** Modes offered besides "Leave as is". */
  modes: Mode[]
  options?: { id: string; label: string }[]
  /** For lists: how typed items are tidied. */
  normalize?: (s: string) => string
  /** For text: how typed text is tidied. */
  tidy?: (s: string) => string
  hint?: string
  placeholder?: string
}

const TEXT: Mode[] = ['set', 'replace', 'clear']
const LIST: Mode[] = ['add', 'remove', 'set', 'clear']

const FIELDS: FieldDef[] = [
  // The book (shared catalogue)
  { key: 'title', label: 'Title', group: 'book', kind: 'text', modes: ['set', 'replace'], tidy: titleCase },
  { key: 'subtitle', label: 'Subtitle', group: 'book', kind: 'text', modes: TEXT, tidy: titleCase },
  { key: 'authors', label: 'Authors', group: 'book', kind: 'list', modes: ['add', 'remove', 'set'], normalize: nameCase, hint: 'A book always keeps at least one author.' },
  { key: 'series', label: 'Series', group: 'book', kind: 'text', modes: TEXT, tidy: titleCase },
  { key: 'seriesIndex', label: 'Number in series', group: 'book', kind: 'number', modes: ['set', 'clear'], placeholder: 'e.g. 2 or 2.5' },
  { key: 'genres', label: 'Genres', group: 'book', kind: 'list', modes: LIST, normalize: titleCase },
  { key: 'firstPublished', label: 'First published (year)', group: 'book', kind: 'number', modes: ['set', 'clear'], placeholder: 'e.g. 1972' },
  { key: 'originalLanguage', label: 'Original language', group: 'book', kind: 'text', modes: TEXT },
  { key: 'description', label: 'Description', group: 'book', kind: 'longtext', modes: TEXT },
  // Your edition
  { key: 'format', label: 'Format', group: 'edition', kind: 'enum', modes: ['set'], options: FORMATS.map((f) => ({ id: f.id, label: f.label })) },
  { key: 'pages', label: 'Pages', group: 'edition', kind: 'number', modes: ['set', 'clear'], placeholder: 'e.g. 320' },
  { key: 'durationMin', label: 'Listening length', group: 'edition', kind: 'duration', modes: ['set', 'clear'], placeholder: 'e.g. 11h 23m' },
  { key: 'publisher', label: 'Publisher', group: 'edition', kind: 'text', modes: TEXT, tidy: titleCase },
  { key: 'publishedDate', label: 'Edition published', group: 'edition', kind: 'text', modes: ['set', 'clear'], placeholder: 'e.g. 2019 or 2019-06-04' },
  { key: 'language', label: 'Language', group: 'edition', kind: 'text', modes: ['set', 'clear'], placeholder: 'e.g. en' },
  { key: 'isbn', label: 'ISBN', group: 'edition', kind: 'unique', modes: ['set', 'clear'], hint: 'An ISBN belongs to one edition, so it can only be set for a single book.' },
  { key: 'asin', label: 'ASIN', group: 'edition', kind: 'unique', modes: ['set', 'clear'], hint: 'An ASIN belongs to one edition, so it can only be set for a single book.' },
  { key: 'narrators', label: 'Narrators', group: 'edition', kind: 'list', modes: LIST, normalize: nameCase },
  { key: 'translators', label: 'Translators', group: 'edition', kind: 'list', modes: LIST, normalize: nameCase },
  { key: 'note', label: 'Edition note', group: 'edition', kind: 'text', modes: TEXT, placeholder: 'e.g. Illustrated, signed…' },
  { key: 'coverUrl', label: 'Cover image link', group: 'edition', kind: 'cover', modes: ['set', 'clear'], hint: 'A link from Google Books or Open Library.' },
  // Your copy
  { key: 'status', label: 'Pile', group: 'copy', kind: 'enum', modes: ['set'], options: STATUSES.map((s) => ({ id: s.id, label: s.label })), hint: 'Books moved to Read without a read get one with no date, so they don’t all land on today.' },
  { key: 'rating', label: 'Rating', group: 'copy', kind: 'rating', modes: ['set', 'clear'] },
  { key: 'tags', label: 'Tags', group: 'copy', kind: 'list', modes: LIST, normalize: titleCase },
  { key: 'shelfIds', label: 'Shelves', group: 'copy', kind: 'list', modes: LIST },
  { key: 'moods', label: 'Moods', group: 'copy', kind: 'list', modes: LIST },
  { key: 'pace', label: 'Pace', group: 'copy', kind: 'enum', modes: ['set', 'clear'], options: PACES.map((p) => ({ id: p.id, label: p.label })) },
  { key: 'owned', label: 'I own a copy', group: 'copy', kind: 'bool', modes: ['set'] },
  { key: 'favorite', label: 'Favourite', group: 'copy', kind: 'bool', modes: ['set'] },
  { key: 'review', label: 'Your notes', group: 'copy', kind: 'longtext', modes: TEXT },
  // Latest read
  { key: 'startedOn', label: 'Started', group: 'read', kind: 'date', modes: ['set', 'clear'] },
  { key: 'finishedOn', label: 'Finished', group: 'read', kind: 'date', modes: ['set', 'clear'] },
  { key: 'readNotes', label: 'Notes on the read', group: 'read', kind: 'longtext', modes: TEXT },
]

const GROUPS: { id: Group; title: string; sub: string }[] = [
  { id: 'book', title: 'The book', sub: 'Shared catalogue details: title, authors, series…' },
  { id: 'edition', title: 'Your edition', sub: 'Format, length, publisher, identifiers…' },
  { id: 'copy', title: 'Your copy', sub: 'Pile, rating, tags, shelves, moods…' },
  { id: 'read', title: 'Your latest read', sub: 'The read in progress, or else your most recent one.' },
]

const MODE_LABEL: Record<Mode, string> = {
  keep: 'Leave as is', set: 'Set to', clear: 'Clear', add: 'Add', remove: 'Remove', replace: 'Find and replace',
}

interface FieldState { mode: Mode; text: string; list: string[]; find: string; replace: string }
const blank = (): FieldState => ({ mode: 'keep', text: '', list: [], find: '', replace: '' })

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Case-insensitive, and whole words when the search starts and ends with a letter or digit,
// so replacing "the" leaves "Mother" alone but "Krsna" still matches "Krsna's".
const replaceAll = (cur: string | undefined, find: string, repl: string) => {
  if (!cur || !find) return cur
  const edge = /^[\p{L}\p{N}]/u.test(find) && /[\p{L}\p{N}]$/u.test(find)
  const re = new RegExp(edge ? `(?<![\\p{L}\\p{N}])${escapeRe(find)}(?![\\p{L}\\p{N}])` : escapeRe(find), 'giu')
  return cur.replace(re, repl)
}
const sameItem = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function BulkEditSheet({ ids, open, onClose, onDone }: { ids: string[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const store = useStore()
  const toast = useToast()
  const [state, setState] = useState<Record<string, FieldState>>({})
  const [openGroups, setOpenGroups] = useState<Set<Group>>(new Set(['book', 'edition', 'copy']))
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { if (open) setState({}) }, [open])

  const entries = ids.map((id) => store.entries.get(id)).filter((e): e is Entry => !!e)
  const single = entries.length === 1
  const get = (k: string) => state[k] ?? blank()
  const set = (k: string, p: Partial<FieldState>) => setState((s) => ({ ...s, [k]: { ...(s[k] ?? blank()), ...p } }))

  const shelves = useMemo(() => [...store.data.shelves].sort((a, b) => a.position - b.position), [store.data.shelves])
  const listOptions = (key: string) =>
    key === 'shelfIds' ? shelves.map((s) => ({ id: s.id, label: `${s.emoji ? s.emoji + ' ' : ''}${s.name}` }))
      : key === 'moods' ? MOODS.map((m) => ({ id: m, label: m[0].toUpperCase() + m.slice(1) }))
        : undefined
  // What the selected books already use, offered when removing.
  const inUse = (key: string): string[] => {
    const vals = new Set<string>()
    for (const e of entries) {
      const w = store.works.get(e.workId)
      const ed = store.editionOf(e)
      const v = key === 'authors' || key === 'genres' ? w?.[key] : key === 'narrators' || key === 'translators' ? ed?.[key] : key === 'tags' ? e.tags : []
      for (const x of v ?? []) vals.add(x)
    }
    return [...vals].sort()
  }

  /** Is this field's input complete enough to apply? */
  const ready = (f: FieldDef, s: FieldState): boolean => {
    if (s.mode === 'keep') return false
    if (s.mode === 'clear') return true
    if (s.mode === 'replace') return !!s.find
    if (f.kind === 'list') return s.list.length > 0
    if (f.kind === 'unique') return single && !!s.text.trim()
    if (f.kind === 'number') return s.text.trim() !== '' && Number.isFinite(Number(s.text.replace(',', '.')))
    if (f.kind === 'duration') return parseDuration(s.text) != null
    if (f.kind === 'cover') return isAllowedCoverUrl(s.text.trim())
    if (f.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(s.text) && s.text <= today()
    return s.text.trim() !== ''
  }
  const active = FIELDS.filter((f) => ready(f, get(f.key)))

  const textValue = (f: FieldDef, s: FieldState, cur?: string) =>
    s.mode === 'clear' ? undefined : s.mode === 'replace' ? replaceAll(cur, s.find, s.replace)?.trim() || undefined : f.tidy ? f.tidy(s.text.trim()) : s.text.trim()
  const listValue = (f: FieldDef, s: FieldState, cur: string[] = []) => {
    const items = s.list.map((x) => (f.normalize ? f.normalize(x) : x))
    if (s.mode === 'clear') return []
    if (s.mode === 'set') return items
    if (s.mode === 'add') return [...cur, ...items.filter((x) => !cur.some((c) => sameItem(c, x)))]
    return cur.filter((c) => !items.some((x) => sameItem(c, x)))
  }
  const numberValue = (s: FieldState) => (s.mode === 'clear' ? undefined : Number(s.text.replace(',', '.')))

  const apply = () => {
    const by = (g: Group) => active.filter((f) => f.group === g)
    const patch: BookPatch = {}
    for (const f of active) {
      const s = get(f.key)
      if (f.key === 'status') patch.status = s.text as Status
      if (f.key === 'format') patch.format = s.text as Format
      if (f.key === 'rating') patch.rating = s.mode === 'clear' ? null : Number(s.text)
    }
    if (by('book').length) {
      patch.work = (w: Work) => {
        const out: Partial<Work> = {}
        for (const f of by('book')) {
          const s = get(f.key)
          if (f.kind === 'list') {
            const v = listValue(f, s, w[f.key as 'authors' | 'genres'])
            if (f.key === 'authors' && !v.length) continue // never leave a book without an author
            ;(out as Record<string, unknown>)[f.key] = v
          } else if (f.kind === 'number') {
            const v = numberValue(s)
            ;(out as Record<string, unknown>)[f.key] = f.key === 'firstPublished' && v != null ? Math.round(v) : v
          } else {
            const v = textValue(f, s, w[f.key as keyof Work] as string | undefined)
            if (f.key === 'title' && !v) continue // a book always has a title
            ;(out as Record<string, unknown>)[f.key] = v
          }
        }
        return out
      }
    }
    const edFields = by('edition').filter((f) => f.key !== 'format')
    if (edFields.length) {
      patch.edition = (e: Edition) => {
        const out: Partial<Edition> = {}
        for (const f of edFields) {
          const s = get(f.key)
          if (f.key === 'isbn') {
            const v = s.mode === 'clear' ? undefined : cleanIsbn(s.text)
            out.isbn13 = v?.length === 13 ? v : undefined
            out.isbn10 = v?.length === 10 ? v : undefined
          } else if (f.key === 'asin') out.asin = s.mode === 'clear' ? undefined : s.text.trim().toUpperCase()
          else if (f.kind === 'list') (out as Record<string, unknown>)[f.key] = listValue(f, s, e[f.key as 'narrators' | 'translators'])
          else if (f.kind === 'number') (out as Record<string, unknown>)[f.key] = numberValue(s) != null ? Math.round(numberValue(s)!) : undefined
          else if (f.kind === 'duration') out.durationMin = s.mode === 'clear' ? undefined : parseDuration(s.text)
          else if (f.kind === 'cover') out.coverUrl = s.mode === 'clear' ? undefined : s.text.trim()
          else (out as Record<string, unknown>)[f.key] = textValue(f, s, e[f.key as keyof Edition] as string | undefined)
        }
        return out
      }
    }
    const copyFields = by('copy').filter((f) => !['status', 'rating'].includes(f.key))
    if (copyFields.length) {
      patch.entry = (e: Entry) => {
        const out: Partial<Entry> = {}
        for (const f of copyFields) {
          const s = get(f.key)
          if (f.kind === 'list') (out as Record<string, unknown>)[f.key] = listValue(f, s, (e[f.key as 'tags' | 'shelfIds' | 'moods'] as string[] | undefined) ?? [])
          else if (f.kind === 'bool') (out as Record<string, unknown>)[f.key] = s.text === 'yes'
          else if (f.key === 'pace') out.pace = s.mode === 'clear' ? undefined : (s.text as Pace)
          else out.review = textValue(f, s, e.review)
        }
        return out
      }
    }
    if (by('read').length) {
      patch.read = (r: Read) => {
        const out: Partial<Read> = {}
        for (const f of by('read')) {
          const s = get(f.key)
          if (f.key === 'readNotes') out.notes = textValue(f, s, r.notes)
          else (out as Record<string, unknown>)[f.key] = s.mode === 'clear' ? undefined : s.text
        }
        return out
      }
    }
    let locked = 0, noRead = 0, badDates = 0
    for (const e of entries) {
      const res = store.patchBook(e.id, patch)
      if (res.locked) locked++
      if (res.noRead) noRead++
      if (res.badDates) badDates++
    }
    const notes = [
      locked && `${plural(locked, 'book')} added by other readers kept ${locked === 1 ? 'its' : 'their'} book details`,
      noRead && `${plural(noRead, 'book')} had no read to change`,
      badDates && `${plural(badDates, 'book')} kept ${badDates === 1 ? 'its' : 'their'} dates (the finish would be before the start, or in the future)`,
    ].filter(Boolean)
    toast(`Updated ${plural(entries.length, 'book')}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`, notes.length ? { tone: 'error' } : undefined)
    onDone()
  }

  const remove = () => {
    const undos = entries.map((e) => store.removeEntry(e.id))
    setConfirmRemove(false)
    toast(`Removed ${plural(undos.length, 'book')}`, { action: { label: 'Undo', run: () => undos.forEach((u) => u()) } })
    onDone()
  }

  const toggleGroup = (g: Group) => setOpenGroups((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n })

  return (
    <>
      <Sheet open={open} onClose={onClose} title={`Edit ${plural(entries.length, 'book')}`} wide footer={
        <>
          <button className="btn btn-ghost danger" aria-label={`Remove ${plural(entries.length, 'book')} from your library`} onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Remove</button>
          <button className="btn btn-primary" disabled={!active.length} onClick={apply}>
            {active.length ? `Apply ${plural(active.length, 'change')} to ${plural(entries.length, 'book')}` : 'Choose what to change'}
          </button>
        </>
      }>
        <p className="muted small">Pick what to do with each field. Anything left as is stays exactly as it is on every book.</p>
        {GROUPS.map((g) => {
          const fields = FIELDS.filter((f) => f.group === g.id)
          const changed = fields.filter((f) => active.includes(f)).length
          const isOpen = openGroups.has(g.id)
          return (
            <section key={g.id} className="bulk-group">
              <button type="button" className="bulk-group-head" aria-expanded={isOpen} onClick={() => toggleGroup(g.id)}>
                <span><b>{g.title}</b>{changed > 0 && <span className="pill tiny">{changed} to change</span>}<span className="muted small"> {g.sub}</span></span>
                <ChevronDown size={16} className={isOpen ? 'flip' : ''} />
              </button>
              {isOpen && (
                <div className="bulk-rows">
                  {fields.map((f) => (
                    <FieldRow key={f.key} f={f} s={get(f.key)} set={(p) => set(f.key, p)} single={single}
                      options={f.options ?? listOptions(f.key)} inUse={inUse(f.key)} ready={ready(f, get(f.key))} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </Sheet>
      <ConfirmSheet open={confirmRemove} title={`Remove ${plural(entries.length, 'book')}?`} confirmLabel="Remove" danger
        onClose={() => setConfirmRemove(false)} onConfirm={remove}>
        <p>They and their reading history leave your shelves. The books stay in the shared catalogue, and you can undo straight after.</p>
      </ConfirmSheet>
    </>
  )
}

function FieldRow({ f, s, set, single, options, inUse, ready }: {
  f: FieldDef; s: FieldState; set: (p: Partial<FieldState>) => void; single: boolean
  options?: { id: string; label: string }[]; inUse: string[]; ready: boolean
}) {
  const id = `bulk-${f.key}`
  const modes = f.modes.filter((m) => !(f.kind === 'unique' && m === 'set' && !single))
  let input: ReactNode = null
  if (s.mode === 'replace') {
    input = (
      <div className="bulk-replace">
        <input className="input" aria-label={`${f.label}: find`} placeholder="Find (whole words)" value={s.find} onChange={(e) => set({ find: e.target.value })} />
        <input className="input" aria-label={`${f.label}: replace with`} placeholder="Replace with (blank removes it)" value={s.replace} onChange={(e) => set({ replace: e.target.value })} />
      </div>
    )
  } else if (s.mode === 'set' || s.mode === 'add' || s.mode === 'remove') {
    if (f.kind === 'list') {
      input = options ? (
        <div className="bulk-pills" role="group" aria-label={f.label}>
          {options.map((o) => {
            const on = s.list.includes(o.id)
            return <button key={o.id} type="button" className={`pill toggle ${on ? 'on' : ''}`} aria-pressed={on}
              onClick={() => set({ list: on ? s.list.filter((x) => x !== o.id) : [...s.list, o.id] })}>{o.label}</button>
          })}
          {!options.length && <span className="muted small">You have no shelves yet.</span>}
        </div>
      ) : (
        <div>
          <Chips value={s.list} onChange={(list) => set({ list })} normalize={f.normalize} suggestions={s.mode === 'remove' ? inUse : undefined}
            placeholder={s.mode === 'remove' ? 'Which to remove (Enter after each)' : 'Type, then Enter'} />
          {s.mode === 'remove' && inUse.length > 0 && (
            <div className="bulk-pills small-pills">
              {inUse.slice(0, 24).map((v) => (
                <button key={v} type="button" className={`pill toggle ${s.list.includes(v) ? 'on' : ''}`}
                  onClick={() => set({ list: s.list.includes(v) ? s.list.filter((x) => x !== v) : [...s.list, v] })}>{v}</button>
              ))}
            </div>
          )}
        </div>
      )
    } else if (f.kind === 'enum') {
      input = (
        <select id={id} className="select" value={s.text} onChange={(e) => set({ text: e.target.value })}>
          <option value="" disabled>Choose…</option>
          {(options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )
    } else if (f.kind === 'bool') {
      input = (
        <select id={id} className="select" value={s.text} onChange={(e) => set({ text: e.target.value })}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )
    } else if (f.kind === 'rating') {
      input = <Stars value={s.text ? Number(s.text) : undefined} onChange={(v) => set({ text: v ? String(v) : '' })} size={26} label={f.label} />
    } else if (f.kind === 'date') {
      input = <input id={id} className="input" type="date" max={today()} value={s.text} onChange={(e) => set({ text: e.target.value })} />
    } else if (f.kind === 'longtext') {
      input = <textarea id={id} className="input" rows={3} value={s.text} onChange={(e) => set({ text: e.target.value })} />
    } else {
      input = <input id={id} className="input" value={s.text} placeholder={f.placeholder}
        inputMode={f.kind === 'number' ? 'decimal' : undefined} onChange={(e) => set({ text: e.target.value })} />
    }
  }
  const changeMode = (mode: Mode) => {
    // Sensible starting values so "Set to" is ready to apply straight away where there's an obvious one.
    const first = f.kind === 'bool' ? 'yes' : ''
    set({ mode, text: mode === 'set' && !s.text ? first : s.text })
  }
  return (
    <div className={`bulk-row ${s.mode !== 'keep' ? 'is-active' : ''}`}>
      <label className="bulk-label" htmlFor={`${id}-mode`}>{f.label}</label>
      <select id={`${id}-mode`} className="select bulk-mode" value={s.mode} onChange={(e) => changeMode(e.target.value as Mode)}>
        <option value="keep">{MODE_LABEL.keep}</option>
        {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
      </select>
      <div className="bulk-input">
        {input}
        {s.mode !== 'keep' && !ready && s.mode !== 'clear' && (
          <span className="field-hint">{f.kind === 'cover' && s.text ? 'Use a link from Google Books or Open Library.' : f.kind === 'date' && s.text > today() ? 'Dates can’t be in the future.' : ' '}</span>
        )}
        {s.mode !== 'keep' && f.hint && <span className="field-hint">{f.hint}</span>}
        {f.kind === 'unique' && !single && s.mode === 'keep' && <span className="field-hint">Clearing works for any number of books; setting needs a single book.</span>}
      </div>
    </div>
  )
}
