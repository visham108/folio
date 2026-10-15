import { GitMerge, History, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CatalogueChange } from '../lib/backend'
import type { Edition, Work } from '../lib/types'
import { fmtDate, localIso } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Cover } from './Cover'
import { ConfirmSheet } from './ui'

const FIELD_LABELS: Record<string, string> = {
  title: 'title', subtitle: 'subtitle', authors: 'authors', series: 'series', series_index: 'series number', genres: 'genres',
  description: 'description', first_published: 'first published', format: 'format', publisher: 'publisher',
  published_date: 'publication date', isbn13: 'ISBN', isbn10: 'ISBN', pages: 'pages', duration_min: 'length',
  narrators: 'narrators', translators: 'translators', cover_url: 'cover', note: 'note', language: 'language', work_id: 'book',
}

/** Catalogue tools for the super admin: change history and merging duplicates. */
export function AdminPanel({ work, editions }: { work: Work; editions: Edition[] }) {
  const store = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [history, setHistory] = useState<CatalogueChange[] | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Work[]>([])
  const [target, setTarget] = useState<Work | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    store.backend?.history([work.id, ...editions.map((e) => e.id)]).then(setHistory).catch(() => setHistory([]))
  }, [work.id, editions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const remote = await store.backend?.searchCatalog(q, []).catch(() => null)
      const local = store.data.works.filter((w) => w.title.toLowerCase().includes(q.toLowerCase()))
      const all = [...local, ...(remote?.works ?? [])].filter((w, i, arr) => w.id !== work.id && arr.findIndex((x) => x.id === w.id) === i)
      setResults(all.slice(0, 6))
    }, 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const who = (id?: string) => (!id ? 'Unknown' : id === store.userId ? 'You' : 'Another reader')

  return (
    <section className="section card admin-panel">
      <div className="section-head">
        <h2><ShieldCheck size={18} /> Admin</h2>
        <span className="muted small">Only you see this</span>
      </div>

      <div className="admin-grid">
        <div>
          <h3><GitMerge size={15} /> Merge a duplicate</h3>
          <p className="muted small">Fold this book into another. Its editions, and every reader’s shelf entry and reading history, move to the book you choose.</p>
          <label className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the book to keep…" />
          </label>
          <ul className="results compact">
            {results.map((w) => (
              <li key={w.id}>
                <button className="result" onClick={() => setTarget(w)}>
                  <Cover work={w} size="xs" />
                  <div className="result-main"><b>{w.title}</b><span>{w.authors.join(', ')}</span></div>
                </button>
              </li>
            ))}
          </ul>
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

      <ConfirmSheet
        open={!!target}
        title="Merge these books?"
        confirmLabel="Merge"
        busy={busy}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return
          setBusy(true)
          try {
            await store.mergeWorks(work.id, target.id)
            toast(`Merged into ${target.title}`)
            nav(`/book/${target.id}`, { replace: true })
          } catch (e) {
            toast('Merge failed: ' + (e as Error).message, { tone: 'error' })
          } finally {
            setBusy(false)
            setTarget(null)
          }
        }}
      >
        <p><b>{work.title}</b> will be folded into <b>{target?.title}</b> by {target?.authors.join(', ')}. This can’t be undone, but every change is recorded in the history.</p>
      </ConfirmSheet>
    </section>
  )
}
