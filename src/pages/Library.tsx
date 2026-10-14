import { AnimatePresence, motion } from 'framer-motion'
import { Grid2x2, List, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookTile } from '../components/BookTile'
import { Cover } from '../components/Cover'
import { Empty, Segmented, Sheet, Stars } from '../components/ui'
import { fold } from '../lib/match'
import { STATUSES, mediumOf, type Entry } from '../lib/types'
import { fmtDate, fmtDuration, uid } from '../lib/util'
import { useStore } from '../state/store'

type Sort = 'added' | 'title' | 'author' | 'rating' | 'finished' | 'length'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'added', label: 'Recently added' },
  { id: 'finished', label: 'Date read' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'rating', label: 'Rating' },
  { id: 'length', label: 'Length' },
]

const VIEW_KEY = 'folio.libraryView'

export function Library() {
  const { pile = 'all' } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const { data, works, readsByEntry } = store
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('added')
  const [format, setFormat] = useState<'all' | 'print' | 'ebook' | 'audio'>('all')
  const [view, setViewState] = useState<'grid' | 'list'>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as 'grid' | 'list') || 'grid' } catch { return 'grid' }
  })
  const setView = (v: 'grid' | 'list') => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } }
  const [newShelf, setNewShelf] = useState(false)
  const [shelfName, setShelfName] = useState('')

  const shelf = data.shelves.find((s) => s.id === pile)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data.entries.length }
    for (const e of data.entries) {
      c[e.status] = (c[e.status] ?? 0) + 1
      for (const s of e.shelfIds) c[s] = (c[s] ?? 0) + 1
    }
    return c
  }, [data.entries])

  const lastFinished = (e: Entry) =>
    (readsByEntry.get(e.id) ?? []).filter((r) => r.finishedOn).map((r) => r.finishedOn!).sort().pop() ?? ''

  const list = useMemo(() => {
    const needle = fold(q)
    let xs = data.entries.filter((e) => {
      if (pile === 'all') return true
      if (shelf) return e.shelfIds.includes(shelf.id)
      if (pile === 'favorites') return e.favorite
      return e.status === pile
    })
    if (format !== 'all') xs = xs.filter((e) => mediumOf(store.editionOf(e)?.format) === format)
    if (needle) {
      xs = xs.filter((e) => {
        const w = works.get(e.workId)
        return w && fold([w.title, w.subtitle, w.series, ...w.authors, ...w.genres, ...e.tags].filter(Boolean).join(' ')).includes(needle)
      })
    }
    const w = (e: Entry) => works.get(e.workId)!
    const len = (e: Entry) => {
      const ed = store.editionOf(e)
      return ed?.pages ?? (ed?.durationMin ? ed.durationMin / 2 : 0)
    }
    const cmp: Record<Sort, (a: Entry, b: Entry) => number> = {
      added: (a, b) => b.addedAt.localeCompare(a.addedAt),
      title: (a, b) => w(a).title.localeCompare(w(b).title),
      author: (a, b) => (w(a).authors[0]?.split(' ').pop() ?? '').localeCompare(w(b).authors[0]?.split(' ').pop() ?? ''),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      finished: (a, b) => lastFinished(b).localeCompare(lastFinished(a)),
      length: (a, b) => len(b) - len(a),
    }
    return xs.filter((e) => works.has(e.workId)).sort(cmp[sort])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.entries, pile, shelf, q, sort, format, works, readsByEntry])

  const title = shelf ? shelf.name : pile === 'favorites' ? 'Favourites' : STATUSES.find((s) => s.id === pile)?.label ?? 'Library'
  const piles: { id: string; label: string }[] = [
    { id: 'all', label: 'All' },
    ...STATUSES.map((s) => ({ id: s.id, label: s.short })),
    { id: 'favorites', label: '♥ Favourites' },
    ...data.shelves.sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, label: `${s.emoji ? s.emoji + ' ' : ''}${s.name}` })),
  ]

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <p className="eyebrow">{list.length} {list.length === 1 ? 'book' : 'books'}</p>
          <h1 className="display">{title}</h1>
        </div>
        <Link to="/add" className="btn btn-primary hide-mobile"><Plus size={18} /> Add a book</Link>
      </header>

      <div className="piles" role="tablist" aria-label="Piles">
        {piles.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pile === p.id}
            className={`pile ${pile === p.id ? 'on' : ''}`}
            onClick={() => nav(p.id === 'all' ? '/library' : `/library/${p.id}`)}
          >
            {pile === p.id && <motion.span layoutId="pile-pill" className="pile-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span className="pile-label">{p.label}{counts[p.id] ? <i>{counts[p.id]}</i> : null}</span>
          </button>
        ))}
        <button className="pile add" onClick={() => setNewShelf(true)}><Plus size={14} /> Shelf</button>
      </div>

      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, genre, tag…" />
          {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <select className="select" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} aria-label="Format">
          <option value="all">All formats</option>
          <option value="print">Print</option>
          <option value="ebook">Ebook</option>
          <option value="audio">Audio</option>
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Segmented
          size="sm"
          label="View"
          value={view}
          onChange={setView}
          options={[{ id: 'grid', label: <Grid2x2 size={15} aria-label="Grid" /> }, { id: 'list', label: <List size={15} aria-label="List" /> }]}
        />
      </div>

      {list.length === 0 ? (
        <Empty title={q ? 'No matches' : 'Nothing here yet'}>
          {q ? <p>Try a different search.</p> : <p>Books you add to this pile will show up here. <Link className="link" to="/add">Add one</Link>.</p>}
        </Empty>
      ) : view === 'grid' ? (
        <div className="grid">
          <AnimatePresence initial={false}>
            {list.map((e, i) => <BookTile key={e.id} entry={e} index={i} />)}
          </AnimatePresence>
        </div>
      ) : (
        <div className="table card">
          {list.map((e) => {
            const w = works.get(e.workId)!
            const ed = store.editionOf(e)
            const reads = (readsByEntry.get(e.id) ?? []).filter((r) => r.state === 'finished').length
            return (
              <Link key={e.id} to={`/book/${w.id}`} className="trow">
                <Cover work={w} edition={ed} size="xs" />
                <div className="trow-main">
                  <b>{w.title}</b>
                  <span className="muted">{w.authors.join(', ')}</span>
                </div>
                <span className="trow-cell hide-mobile">{ed?.format === 'audiobook' ? fmtDuration(ed.durationMin) : ed?.pages ? `${ed.pages} p` : ''}</span>
                <span className="trow-cell hide-mobile">{STATUSES.find((s) => s.id === e.status)?.short}{reads > 1 ? ` ×${reads}` : ''}</span>
                <span className="trow-cell hide-mobile muted">{fmtDate(lastFinished(e))}</span>
                <span className="trow-cell">{e.rating ? <Stars value={e.rating} size={12} /> : null}</span>
              </Link>
            )
          })}
        </div>
      )}

      <Sheet
        open={newShelf}
        onClose={() => setNewShelf(false)}
        title="New shelf"
        footer={
          <button
            className="btn btn-primary"
            disabled={!shelfName.trim()}
            onClick={() => {
              const s = { id: uid(), name: shelfName.trim(), position: data.shelves.length }
              store.saveShelf(s)
              setShelfName('')
              setNewShelf(false)
              nav(`/library/${s.id}`)
            }}
          >
            Create shelf
          </button>
        }
      >
        <p className="muted">Shelves are your own piles: “Summer 2026”, “Book club”, “Comfort reads”. A book can sit on as many as you like.</p>
        <input className="input" value={shelfName} onChange={(e) => setShelfName(e.target.value)} placeholder="Shelf name" />
      </Sheet>
    </div>
  )
}

