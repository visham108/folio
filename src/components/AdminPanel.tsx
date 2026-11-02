import { GitMerge, History, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CatalogueChange } from '../lib/backend'
import type { Edition, Work } from '../lib/types'
import { fmtDate, localIso } from '../lib/util'
import { useStore } from '../state/store'
import { Cover } from './Cover'
import { findCandidates } from '../lib/match'
import { fullTitle } from '../lib/mergePlan'
import { MergeSheet } from './MergeSheet'

const FIELD_LABELS: Record<string, string> = {
  title: 'title', subtitle: 'subtitle', authors: 'authors', series: 'series', series_index: 'series number', genres: 'genres',
  description: 'description', first_published: 'first published', format: 'format', publisher: 'publisher',
  published_date: 'publication date', isbn13: 'ISBN', isbn10: 'ISBN', pages: 'pages', duration_min: 'length',
  narrators: 'narrators', translators: 'translators', cover_url: 'cover', note: 'note', language: 'language', work_id: 'book',
}

/** Catalogue tools for the super admin: change history and merging duplicates. */
export function AdminPanel({ work, editions }: { work: Work; editions: Edition[] }) {
  const store = useStore()
  const nav = useNavigate()
  const [history, setHistory] = useState<CatalogueChange[] | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Work[]>([])
  // Other copies of this book from the shared catalogue, for the suggestions.
  const [catalogue, setCatalogue] = useState<{ works: Work[]; editions: Edition[] }>({ works: [], editions: [] })
  // The copies chosen to merge with this one.
  const [picked, setPicked] = useState<Work[]>([])
  const [merging, setMerging] = useState<Work[] | null>(null)

  useEffect(() => {
    store.backend?.history([work.id, ...editions.map((e) => e.id)]).then(setHistory).catch(() => setHistory([]))
  }, [work.id, editions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPicked([])
    store.backend?.searchCatalog(work.title, work.authors).then(setCatalogue).catch(() => setCatalogue({ works: [], editions: [] }))
  }, [work.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Likely duplicates: same ISBN, or a matching title and author, on your shelves or in the catalogue.
  const suggestions = useMemo(() => {
    const pool = [...store.data.works, ...catalogue.works.filter((w) => !store.works.has(w.id))].filter((w) => w.id !== work.id)
    const eds = [...store.data.editions, ...catalogue.editions]
    const isbns = editions.map((e) => e.isbn13 ?? e.isbn10).filter(Boolean)
    const found = [
      ...findCandidates({ title: work.title, subtitle: work.subtitle, authors: work.authors }, pool, eds, 6),
      ...isbns.flatMap((isbn) => findCandidates({ title: '', authors: [], isbn }, pool, eds, 2)),
    ]
    return found.filter((c, i) => found.findIndex((x) => x.work.id === c.work.id) === i).sort((a, b) => b.score - a.score).slice(0, 6)
  }, [work, editions, catalogue, store.data.works, store.data.editions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const remote = await store.backend?.searchCatalog(q, []).catch(() => null)
      const local = store.data.works.filter((w) => fullTitle(w).toLowerCase().includes(q.toLowerCase()))
      const all = [...local, ...(remote?.works ?? [])].filter((w, i, arr) => w.id !== work.id && arr.findIndex((x) => x.id === w.id) === i)
      setResults(all.slice(0, 6))
    }, 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePick = (w: Work) => setPicked((p) => (p.some((x) => x.id === w.id) ? p.filter((x) => x.id !== w.id) : [...p, w]))
  const pickRow = (w: Work, reason?: string) => {
    const on = picked.some((x) => x.id === w.id)
    return (
      <button className={`result pick ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} onClick={() => togglePick(w)}>
        <span className={`pick-box ${on ? 'on' : ''}`} aria-hidden />
        <Cover work={w} size="xs" />
        <div className="result-main">
          <b>{fullTitle(w)}</b>
          <span>{[w.authors.join(', '), store.entryByWork.has(w.id) && 'on your shelves', reason].filter(Boolean).join(' · ')}</span>
        </div>
      </button>
    )
  }

  const who = (id?: string) => (!id ? 'Unknown' : id === store.userId ? 'You' : 'Another reader')

  return (
    <section className="section card admin-panel">
      <div className="section-head">
        <h2><ShieldCheck size={18} /> Admin</h2>
        <span className="muted small">Only you see this</span>
      </div>

      <div className="admin-grid">
        <div>
          <h3><GitMerge size={15} /> Merge duplicates</h3>
          <p className="muted small">Pick other copies of this book to fold into it. You can still choose which copy to keep before anything changes.</p>
          {suggestions.length > 0 && (
            <>
              <h4 className="merge-head">Possible duplicates</h4>
              <ul className="results compact">
                {suggestions.map((c) => <li key={c.work.id}>{pickRow(c.work, c.reason)}</li>)}
              </ul>
            </>
          )}
          <label className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={suggestions.length ? 'Find another copy…' : 'Find another copy of this book…'} />
          </label>
          <ul className="results compact">
            {results.filter((w) => !suggestions.some((c) => c.work.id === w.id)).map((w) => <li key={w.id}>{pickRow(w)}</li>)}
          </ul>
          {picked.length > 0 && (
            <div className="merge-pick-bar">
              <span><b>{picked.length}</b> selected</span>
              <button className="link" onClick={() => setPicked([])}>Clear</button>
              <span className="grow" />
              <button className="btn btn-primary sm" onClick={() => setMerging([work, ...picked])}>
                <GitMerge size={14} /> Merge {picked.length === 1 ? 'it' : picked.length} into this book…
              </button>
            </div>
          )}
        </div>
        <div>
          <h3><History size={15} /> Change history</h3>
          {history === null ? <p className="muted small">Loading…</p> : history.length === 0 ? <p className="muted small">No recorded changes.</p> : (
            <ul className="history">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="pill tiny">{h.table === 'works' ? 'Book' : 'Edition'}</span>
                  <span>
                    {h.action === 'insert' ? 'Added' : h.action === 'delete' ? 'Removed' : `Edited ${h.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ') || 'details'}`}
                    <span className="muted"> · {who(h.changedBy)} · {fmtDate(localIso(new Date(h.changedAt)))}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <MergeSheet books={merging} keepId={work.id} onClose={() => setMerging(null)}
        onMerged={(kept) => { setPicked([]); if (kept.id !== work.id) nav(`/book/${kept.id}`, { replace: true }) }} />
    </section>
  )
}
