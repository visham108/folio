import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckSquare, Grid2x2, LibraryBig, List, Pencil, Plus, Search, Shuffle, Sparkles, Table2, Trash2, X } from 'lucide-react'
import { titleCase } from '../lib/titleCase'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookTile } from '../components/BookTile'
import { BulkEditSheet } from '../components/BulkEdit'
import { BOOK_DRAG, isBookDrag } from '../components/dragBook'
import { LibraryTable } from '../components/LibraryTable'
import { SpineShelf, spineHue } from '../components/SpineShelf'
import { Cover } from '../components/Cover'
import { ConfirmSheet, Empty, Segmented, Sheet, Stars } from '../components/ui'
import { fold } from '../lib/match'
import { compareKeys, sortDef, SORTS, surnameKey, titleKey, type SortId, type SortKey } from '../lib/librarySort'
import { progressInfo } from '../lib/progress'
import { seriesSlug } from '../lib/series'
import { FORMATS, STATUSES, mediumOf, type Entry, type Shelf } from '../lib/types'
import { fmtDate, fmtDuration, plural, uid } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { findSmart, nextInSeriesIds, SMART_SHELVES, smartId } from '../lib/smartShelves'
import { useSeries } from './hooks'

const SORT_KEY = 'folio.librarySort'
const FORMAT_ORDER: string[] = ['hardcover', 'paperback', 'ebook', 'audiobook', 'other']
const PILE_ORDER: string[] = ['reading', 'paused', 'want', 'read', 'dnf']
// Renamed when spines became the default, so everyone starts there once; after that your choice is kept.
const VIEW_KEY = 'folio.libraryView.v2'

export function Library() {
  const { pile = 'all' } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const { data, works, readsByEntry } = store
  const [q, setQ] = useState('')
  // Your sort is remembered: { id, dir }.
  const [sortPref, setSortPref] = useState<{ id: SortId; dir: 1 | -1 }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null')
      if (v && SORTS.some((s) => s.id === v.id) && (v.dir === 1 || v.dir === -1)) return v
    } catch { /* storage blocked */ }
    return { id: 'added', dir: -1 }
  })
  const saveSort = (v: { id: SortId; dir: 1 | -1 }) => { setSortPref(v); try { localStorage.setItem(SORT_KEY, JSON.stringify(v)) } catch { /* private mode */ } }
  const setSort = (id: SortId) => saveSort({ id, dir: sortDef(id).dir })
  const [format, setFormat] = useState<'all' | 'print' | 'ebook' | 'audio'>('all')
  type View = 'grid' | 'list' | 'table' | 'shelf'
  const [view, setViewState] = useState<View>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as View) || 'shelf' } catch { return 'shelf' }
  })
  const setView = (v: View) => {
    setViewState(v)
    if (v !== 'shelf' && sortPref.id === 'colour') setSort('added')
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
  }
  // Colour only means something on the spines.
  const sort: SortId = sortPref.id === 'colour' && view !== 'shelf' ? 'added' : sortPref.id
  const dir = sort === sortPref.id ? sortPref.dir : sortDef(sort).dir
  const def = sortDef(sort)

  // The shelf being created ('new') or renamed.
  const [shelfEdit, setShelfEdit] = useState<Shelf | 'new' | null>(null)
  const [shelfName, setShelfName] = useState('')
  const [confirmDeleteShelf, setConfirmDeleteShelf] = useState(false)
  const openShelfEditor = (s: Shelf | 'new') => { setShelfEdit(s); setShelfName(s === 'new' ? '' : s.name) }

  // Bulk edit: pick books, then change them together.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }

  // Drag a book (or, while selecting, every selected book) onto a pile, favourites or one of your shelves.
  const toast = useToast()
  const [dragOver, setDragOver] = useState<string>()
  const droppable = (id: string) => STATUSES.some((s) => s.id === id) || id === 'favorites' || data.shelves.some((s) => s.id === id)
  const dropOn = (target: string, e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(undefined)
    document.body.classList.remove('dragging-book')
    const id = e.dataTransfer.getData(BOOK_DRAG)
    if (!id) return
    const ids = selecting && selected.has(id) ? visibleSelected.map((x) => x.id) : [id]
    const books = ids.map((i) => data.entries.find((x) => x.id === i)).filter((x): x is Entry => !!x)
    const status = STATUSES.find((s) => s.id === target)
    const shelfTo = data.shelves.find((s) => s.id === target)
    const name = status?.label ?? shelfTo?.name ?? 'Favourites'
    if (status) {
      const moving = books.filter((b) => b.status !== status.id)
      for (const b of moving) store.setStatus(b.id, status.id)
      toast(moving.length ? `Moved ${plural(moving.length, 'book')} to ${name}` : `Already in ${name}`)
      return
    }
    const adding = books.filter((b) => (shelfTo ? !b.shelfIds.includes(shelfTo.id) : !b.favorite))
    for (const b of adding) store.updateEntry(b.id, shelfTo ? { shelfIds: [...b.shelfIds, shelfTo.id] } : { favorite: true })
    toast(adding.length ? `Added ${plural(adding.length, 'book')} to ${name}` : `Already in ${name}`, adding.length ? {
      action: { label: 'Undo', run: () => { for (const b of adding) store.updateEntry(b.id, shelfTo ? { shelfIds: b.shelfIds } : { favorite: false }) } },
    } : undefined)
  }
  const dropProps = (id: string) => (droppable(id) ? {
    onDragOver: (e: React.DragEvent) => {
      if (!isBookDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dragOver !== id) setDragOver(id)
    },
    onDragLeave: () => setDragOver((d) => (d === id ? undefined : d)),
    onDrop: (e: React.DragEvent) => dropOn(id, e),
  } : {})

  const shelf = data.shelves.find((s) => s.id === pile)
  const smart = findSmart(pile)
  const { series } = useSeries()

  // Which books sit on each smart shelf (recomputed as your library changes).
  const smartMembers = useMemo(() => {
    const next = nextInSeriesIds(series)
    const now = Date.now()
    const out = new Map<string, Set<string>>()
    for (const sh of SMART_SHELVES) out.set(smartId(sh.id), new Set())
    for (const entry of data.entries) {
      const work = works.get(entry.workId)
      if (!work) continue
      const ctx = { work, entry, edition: store.editionOf(entry), reads: readsByEntry.get(entry.id) ?? [], nextInSeries: next, now }
      for (const sh of SMART_SHELVES) if (sh.match(ctx)) out.get(smartId(sh.id))!.add(entry.id)
    }
    return out
  }, [data.entries, works, readsByEntry, series]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    // Counted the same way as the list below (books whose details are loaded), so they agree.
    const shown = data.entries.filter((e) => works.has(e.workId))
    const c: Record<string, number> = { all: shown.length }
    for (const e of shown) {
      c[e.status] = (c[e.status] ?? 0) + 1
      if (e.favorite) c.favorites = (c.favorites ?? 0) + 1
      for (const s of e.shelfIds) c[s] = (c[s] ?? 0) + 1
    }
    for (const [id, set] of smartMembers) c[id] = set.size
    return c
  }, [data.entries, works, smartMembers])

  const lastFinished = (e: Entry) =>
    (readsByEntry.get(e.id) ?? []).filter((r) => r.finishedOn).map((r) => r.finishedOn!).sort().pop() ?? ''

  const list = useMemo(() => {
    const needle = fold(q)
    let xs = data.entries.filter((e) => {
      if (pile === 'all') return true
      if (shelf) return e.shelfIds.includes(shelf.id)
      if (smart) return smartMembers.get(pile)?.has(e.id)
      if (pile === 'favorites') return e.favorite
      return e.status === pile
    })
    // A format matches your edition, or any edition you've read it in (a print book you listened to counts as audio).
    if (format !== 'all') {
      xs = xs.filter((e) => mediumOf(store.editionOf(e)?.format) === format ||
        (readsByEntry.get(e.id) ?? []).some((r) => r.editionId && mediumOf(store.editions.get(r.editionId)?.format) === format))
    }
    if (needle) {
      xs = xs.filter((e) => {
        const w = works.get(e.workId)
        return w && fold([w.title, w.subtitle, w.series, ...w.authors, ...w.genres, ...e.tags].filter(Boolean).join(' ')).includes(needle)
      })
    }
    const w = (e: Entry) => works.get(e.workId)!
    // Audiobooks are compared in page-equivalents, using your listening setting.
    const len = (e: Entry) => {
      const ed = store.editionOf(e)
      return ed?.pages ?? (ed?.durationMin ? (ed.durationMin / 60) * data.settings.audioPagesPerHour : 0)
    }
    const reads = (e: Entry) => readsByEntry.get(e.id) ?? []
    const logDays = new Map<string, string[]>()
    if (sort === 'activity') for (const l of data.logs) logDays.set(l.readId, [...(logDays.get(l.readId) ?? []), l.on])
    const latest = (xs: (string | undefined)[]) => xs.filter(Boolean).sort().pop()
    const keyOf: Record<SortId, (e: Entry) => SortKey> = {
      added: (e) => [e.addedAt],
      activity: (e) => {
        const rs = reads(e)
        const d = latest([...rs.flatMap((r) => [r.startedOn, r.finishedOn]), ...rs.flatMap((r) => logDays.get(r.id) ?? [])])
        return d ? [d] : undefined
      },
      genre: (e) => (w(e).genres[0] ? [fold(w(e).genres[0]), titleKey(w(e).title)] : undefined),
      format: (e) => { const f = store.editionOf(e)?.format; return f ? [FORMAT_ORDER.indexOf(f), titleKey(w(e).title)] : undefined },
      pile: (e) => [PILE_ORDER.indexOf(e.status), titleKey(w(e).title)],
      finished: (e) => { const d = lastFinished(e); return d ? [d] : undefined },
      started: (e) => { const d = latest(reads(e).map((r) => r.startedOn)); return d ? [d] : undefined },
      title: (e) => [titleKey(w(e).title), fold(w(e).subtitle ?? '')],
      author: (e) => (w(e).authors[0] ? [surnameKey(w(e).authors[0]), titleKey(w(e).title)] : undefined),
      series: (e) => (w(e).series ? [fold(w(e).series!), w(e).seriesIndex ?? Number.MAX_SAFE_INTEGER, titleKey(w(e).title)] : undefined),
      rating: (e) => (e.rating ? [e.rating] : undefined),
      length: (e) => (len(e) ? [len(e)] : undefined),
      published: (e) => (w(e).firstPublished != null ? [w(e).firstPublished!] : undefined),
      progress: (e) => {
        const r = reads(e).find((x) => x.state === 'reading' || x.state === 'paused')
        if (!r) return undefined
        return [progressInfo(r, store.editions.get(r.editionId ?? '') ?? store.editionOf(e)).pct]
      },
      timesRead: (e) => { const n = reads(e).filter((r) => r.state === 'finished').length; return n ? [n] : undefined },
      publisher: (e) => { const p = store.editionOf(e)?.publisher; return p ? [fold(p), titleKey(w(e).title)] : undefined },
      colour: (e) => [spineHue(w(e).title, w(e).authors[0]), -len(e)],
    }
    const keys = new Map(xs.map((e) => [e.id, works.has(e.workId) ? keyOf[sort](e) : undefined]))
    // Ties (and books with no value, which always go last) fall back to the title.
    const cmp = (a: Entry, b: Entry) => compareKeys(keys.get(a.id), keys.get(b.id), dir) || compareKeys([titleKey(w(a).title)], [titleKey(w(b).title)], 1)
    return xs.filter((e) => works.has(e.workId)).sort(cmp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.entries, data.logs, pile, shelf, smart, smartMembers, q, sort, dir, format, works, readsByEntry, data.settings.audioPagesPerHour])

  // Sorting by series or author: a heading over each run of books.
  const groups = useMemo(() => {
    if (!def.grouped) return null
    const label = (e: Entry) => {
      const w = works.get(e.workId)!
      switch (sort) {
        case 'series': return w.series ?? ''
        case 'genre': return w.genres[0] ?? ''
        case 'format': return FORMATS.find((f) => f.id === store.editionOf(e)?.format)?.label ?? ''
        case 'pile': return STATUSES.find((s) => s.id === e.status)?.label ?? ''
        default: return w.authors[0] ?? ''
      }
    }
    const out: { label: string; items: Entry[] }[] = []
    for (const e of list) {
      const l = label(e)
      if (out.length && out[out.length - 1].label === l) out[out.length - 1].items.push(e)
      else out.push({ label: l, items: [e] })
    }
    return out
  }, [list, def.grouped, sort, works])
  const groupTitle = (label: string) =>
    !label ? ({ series: 'Not in a series', genre: 'No genre', format: 'No edition', author: 'No author' } as Record<string, string>)[sort] ?? '—'
      : sort === 'series' ? <Link to={`/series/${seriesSlug(label)}`} className="group-link">{label}</Link> : label

  // Selected books that are still in view (a search or pile change narrows what "all" means).
  const visibleSelected = list.filter((e) => selected.has(e.id))
  const allSelected = list.length > 0 && visibleSelected.length === list.length

  const status = STATUSES.find((s) => s.id === pile)
  const known = pile === 'all' || pile === 'favorites' || !!shelf || !!smart || !!status
  const title = shelf ? shelf.name : smart ? smart.name : pile === 'favorites' ? 'Favourites' : status?.label ?? (known ? 'Library' : 'Shelf not found')
  // Keep the chosen pile in view (smart shelves sit at the far end of the row).
  const pilesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = pilesRef.current
    const on = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!row || !on) return
    const left = on.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + on.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - 24
  }, [pile])
  useEffect(() => {
    const row = pilesRef.current
    if (!row) return
    const check = () => row.classList.toggle('more', row.scrollLeft + row.clientWidth < row.scrollWidth - 4)
    check()
    row.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(row)
    return () => { row.removeEventListener('scroll', check); ro.disconnect() }
  }, [])

  const piles: { id: string; label: string }[] = [
    { id: 'all', label: 'All' },
    ...STATUSES.map((s) => ({ id: s.id, label: s.short })),
    { id: 'favorites', label: '♥ Favourites' },
    ...[...data.shelves].sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, label: `${s.emoji ? s.emoji + ' ' : ''}${s.name}` })),
  ]
  // Smart shelves appear only when they hold something (or you're looking at one).
  const smartPiles = SMART_SHELVES.map((s) => ({ id: smartId(s.id), label: s.name }))
    .filter((p) => (counts[p.id] ?? 0) > 0 || p.id === pile)

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <p className="eyebrow">{shelf ? 'Shelf · ' : ''}{list.length} {list.length === 1 ? 'book' : 'books'}</p>
          <h1 className="display">{title}</h1>
        </div>
        <div className="head-actions">
          {shelf && <button className="btn btn-ghost sm" onClick={() => openShelfEditor(shelf)}><Pencil size={14} /> Edit shelf</button>}
          {pile === 'want' && list.length > 1 && <Link to="/next" className="btn btn-ghost sm"><Shuffle size={14} /> Help me choose</Link>}
          <Link to="/add" className="btn btn-primary hide-mobile"><Plus size={18} /> Add a book</Link>
        </div>
      </header>

      <nav className="piles" aria-label="Piles and shelves" ref={pilesRef}>
        {piles.map((p) => (
          <button
            key={p.id}
            aria-current={pile === p.id ? 'page' : undefined}
            className={`pile ${pile === p.id ? 'on' : ''} ${droppable(p.id) ? 'droppable' : ''} ${dragOver === p.id ? 'drop-over' : ''}`}
            onClick={() => nav(p.id === 'all' ? '/library' : `/library/${p.id}`)}
            {...dropProps(p.id)}
          >
            {pile === p.id && <motion.span layoutId="pile-pill" className="pile-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span className="pile-label">{p.label}{counts[p.id] ? <i>{counts[p.id]}</i> : null}</span>
          </button>
        ))}
        <button className="pile add" onClick={() => openShelfEditor('new')}><Plus size={14} /> New shelf</button>
        {smartPiles.length > 0 && <span className="pile-divider" aria-hidden>Smart</span>}
        {smartPiles.map((p) => (
          <button
            key={p.id}
            aria-current={pile === p.id ? 'page' : undefined}
            className={`pile smart ${pile === p.id ? 'on' : ''}`}
            onClick={() => nav(`/library/${p.id}`)}
          >
            {pile === p.id && <motion.span layoutId="pile-pill" className="pile-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span className="pile-label"><Sparkles size={12} /> {p.label}{counts[p.id] ? <i>{counts[p.id]}</i> : null}</span>
          </button>
        ))}
      </nav>
      {smart && <p className="muted smart-desc"><Sparkles size={13} /> {smart.description} Folio keeps this shelf up to date for you.</p>}

      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, genre, tag…" aria-label="Search your library" />
          {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <select className="select" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} aria-label="Format">
          <option value="all">All formats</option>
          <option value="print">Print</option>
          <option value="ebook">Ebook</option>
          <option value="audio">Audio</option>
        </select>
        <div className="sort-ctl">
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Sort">
            {SORTS.filter((s) => s.id !== 'colour' || view === 'shelf').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="btn btn-ghost sm sort-dir" onClick={() => saveSort({ id: sort, dir: dir === 1 ? -1 : 1 })}
            aria-label={`Order: ${def.orders[dir === 1 ? 0 : 1]}. Reverse`} title="Reverse the order">
            {dir === 1 ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />} <span>{def.orders[dir === 1 ? 0 : 1]}</span>
          </button>
        </div>
        {view !== 'table' && <button className={`btn btn-ghost sm ${selecting ? 'on' : ''}`} aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
          <CheckSquare size={15} /> {selecting ? 'Done' : 'Select'}
        </button>}
        <Segmented
          size="sm"
          label="View"
          value={view}
          onChange={setView}
          options={[
            { id: 'shelf', label: <LibraryBig size={15} aria-label="Spines on a shelf" /> },
            { id: 'grid', label: <Grid2x2 size={15} aria-label="Grid" /> },
            { id: 'list', label: <List size={15} aria-label="List" /> },
            { id: 'table', label: <Table2 size={15} aria-label="Table of every detail" /> },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <Empty title={!known ? 'Shelf not found' : q || format !== 'all' ? 'No matches' : 'Nothing here yet'}>
          {!known ? <p>It may have been deleted. <Link className="link" to="/library">Back to your library</Link></p>
            : q || format !== 'all' ? <p>Try a different search or format.</p>
              : <p>{emptyCopy(pile, !!shelf, !!smart)}</p>}
        </Empty>
      ) : view === 'table' ? (
        <LibraryTable entries={list} selected={selected} onToggle={toggle} onSetSelected={setSelected} />
      ) : view === 'shelf' ? (
        <SpineShelf entries={list} grouped={pile === 'all'} selecting={selecting} selected={selected} onToggle={toggle} />
      ) : view === 'grid' ? (
        groups ? (
          <div className="lib-groups">
            {groups.map((g) => (
              <section key={g.label || '—'} className="lib-group" aria-label={g.label || undefined}>
                <h3 className="lib-group-head">{groupTitle(g.label)} <span className="count">{g.items.length}</span></h3>
                <div className="grid">
                  {g.items.map((e) => <BookTile key={e.id} entry={e} index={list.indexOf(e)} selecting={selecting} selected={selected.has(e.id)} onToggle={() => toggle(e.id)} />)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid">
            <AnimatePresence initial={false}>
              {list.map((e, i) => <BookTile key={e.id} entry={e} index={i} selecting={selecting} selected={selected.has(e.id)} onToggle={() => toggle(e.id)} />)}
            </AnimatePresence>
          </div>
        )
      ) : (
        <div className="table card">
          <div className="trow thead" aria-hidden>
            <span />
            <span className="trow-main">Book</span>
            <span className="trow-cell hide-mobile">Length</span>
            <span className="trow-cell hide-mobile">Pile</span>
            <span className="trow-cell hide-mobile">Last finished</span>
            <span className="trow-cell">Rating</span>
          </div>
          {list.map((e) => {
            const w = works.get(e.workId)!
            const ed = store.editionOf(e)
            const g = groups?.find((x) => x.items[0] === e)
            const reads = (readsByEntry.get(e.id) ?? []).filter((r) => r.state === 'finished').length
            return (
              <Fragment key={e.id}>
              {g && <div className="tgroup" role="heading" aria-level={3}>{groupTitle(g.label)} <span className="count">{g.items.length}</span></div>}
              <Link to={`/book/${w.id}`} className={`trow ${selecting && selected.has(e.id) ? 'selected' : ''}`}
                role={selecting ? 'checkbox' : undefined} aria-checked={selecting ? selected.has(e.id) : undefined}
                onClick={selecting ? (ev) => { ev.preventDefault(); toggle(e.id) } : undefined}>
                {selecting ? <span className={`row-check ${selected.has(e.id) ? 'on' : ''}`} aria-hidden /> : <Cover work={w} edition={ed} size="xs" />}
                <div className="trow-main">
                  <b>{w.title}</b>
                  <span className="muted">{w.authors.join(', ')}</span>
                </div>
                <span className="trow-cell hide-mobile">{ed?.format === 'audiobook' ? fmtDuration(ed.durationMin) : ed?.pages ? `${ed.pages} p` : ''}</span>
                <span className="trow-cell hide-mobile">{STATUSES.find((s) => s.id === e.status)?.short}{reads > 1 ? ` ×${reads}` : ''}</span>
                <span className="trow-cell hide-mobile muted">{fmtDate(lastFinished(e))}</span>
                <span className="trow-cell">{e.rating ? <Stars value={e.rating} size={12} /> : null}</span>
              </Link>
              </Fragment>
            )
          })}
        </div>
      )}

      {(selecting || (view === 'table' && selected.size > 0)) && (
        <div className="select-bar" role="region" aria-label="Selected books">
          <span><b>{visibleSelected.length}</b> selected</span>
          <button className="link" onClick={() => setSelected(allSelected ? new Set() : new Set(list.map((e) => e.id)))}>
            {allSelected ? 'Select none' : `Select all ${list.length}`}
          </button>
          <span className="grow" />
          <button className="btn btn-ghost sm" onClick={stopSelecting}>Cancel</button>
          <button className="btn btn-primary sm" disabled={!visibleSelected.length} onClick={() => setBulkOpen(true)}><Pencil size={14} /> Edit</button>
        </div>
      )}
      <BulkEditSheet ids={visibleSelected.map((e) => e.id)} open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); stopSelecting() }} />

      <Sheet
        open={!!shelfEdit}
        onClose={() => setShelfEdit(null)}
        title={shelfEdit === 'new' ? 'New shelf' : 'Edit shelf'}
        footer={
          <>
            {shelfEdit && shelfEdit !== 'new' && (
              <button className="btn btn-ghost danger" onClick={() => setConfirmDeleteShelf(true)}><Trash2 size={14} /> Delete shelf</button>
            )}
            <button
              className="btn btn-primary"
              disabled={!shelfName.trim()}
              onClick={() => {
                if (shelfEdit === 'new') {
                  const s = { id: uid(), name: titleCase(shelfName), position: data.shelves.length }
                  store.saveShelf(s)
                  nav(`/library/${s.id}`)
                } else if (shelfEdit) store.saveShelf({ ...shelfEdit, name: titleCase(shelfName) })
                setShelfEdit(null)
              }}
            >
              {shelfEdit === 'new' ? 'Create shelf' : 'Save'}
            </button>
          </>
        }
      >
        {shelfEdit === 'new' && <p className="muted">Shelves are your own piles: “Summer 2026”, “Book club”, “Comfort reads”. A book can sit on as many as you like.</p>}
        <label className="field spaced">
          <span className="field-label">Shelf name</span>
          <input className="input" value={shelfName} maxLength={80} onChange={(e) => setShelfName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shelfName.trim()) (e.currentTarget.closest('.sheet')?.querySelector('.sheet-foot .btn-primary') as HTMLButtonElement | null)?.click() }} />
        </label>
      </Sheet>
      <ConfirmSheet
        open={confirmDeleteShelf}
        title="Delete this shelf?"
        confirmLabel="Delete shelf"
        danger
        onClose={() => setConfirmDeleteShelf(false)}
        onConfirm={() => {
          if (shelfEdit && shelfEdit !== 'new') store.deleteShelf(shelfEdit.id)
          setConfirmDeleteShelf(false)
          setShelfEdit(null)
          nav('/library')
        }}
      >
        <p>The shelf goes, but its books stay in your library.</p>
      </ConfirmSheet>
    </div>
  )
}

function emptyCopy(pile: string, isShelf: boolean, isSmart: boolean): string {
  if (isShelf) return 'Add books to this shelf from their pages, under “Shelves & tags”.'
  if (isSmart) return 'Nothing fits this shelf right now. It fills itself as your library changes.'
  switch (pile) {
    case 'paused': return 'Books you pause show up here. Pause one from its page when you put it down for a while.'
    case 'dnf': return 'Books you set aside show up here.'
    case 'favorites': return 'Tap the heart on a book’s page to add it here.'
    case 'reading': return 'Start a book from its page, or add one you’re reading now.'
    default: return 'Books you add will show up here.'
  }
}
