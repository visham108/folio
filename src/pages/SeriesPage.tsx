import { ArrowLeft, Check, Plus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Cover } from '../components/Cover'
import { Bar, Empty } from '../components/ui'
import { STATUSES } from '../lib/types'
import { plural } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { useSeries } from './hooks'

const STATE_LABEL: Record<string, string> = {
  read: 'Read', reading: 'Reading', want: 'Want to read', dnf: 'Did not finish', paused: 'Paused', none: '',
}

export function SeriesPage() {
  const { name = '' } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const toast = useToast()
  const { series, loading } = useSeries()
  const s = series.find((x) => x.name.toLowerCase() === decodeURIComponent(name).trim().toLowerCase())

  if (!s) {
    return (
      <div className="page">
        {loading ? <div className="page-loading" aria-busy="true" /> : (
          <Empty title="Series not found"><p><Link className="link" to="/library">Back to your library</Link></p></Empty>
        )}
      </div>
    )
  }

  return (
    <div className="page series-page">
      <button className="back" onClick={() => (history.length > 1 ? nav(-1) : nav('/library'))}><ArrowLeft size={16} /> Back</button>
      <header className="page-head">
        <p className="eyebrow">Series · {plural(s.books.length, 'book')} known</p>
        <h1 className="display">{s.name}</h1>
        <div className="series-progress">
          <Bar pct={s.books.length ? s.read / s.books.length : 0} label="Series progress" />
          <span className="muted small">{s.read} of {s.books.length} read{s.next ? ` · next up: ${s.next.work.title}` : s.read === s.books.length ? ' · complete ✦' : ''}</span>
        </div>
      </header>
      <ol className="series-list">
        {s.books.map((b) => (
          <li key={b.work.id} className={`series-item state-${b.state} ${s.next?.work.id === b.work.id ? 'is-next' : ''}`}>
            <span className="series-num">{b.index ?? '–'}</span>
            <Link to={`/book/${b.work.id}`} className="series-link">
              <Cover work={b.work} edition={store.editionsByWork.get(b.work.id)?.[0]} size="sm" />
              <div className="series-meta">
                <b>{b.work.title}</b>
                <span className="muted small">{b.work.authors.join(', ')}{b.work.firstPublished ? ` · ${b.work.firstPublished}` : ''}</span>
                {s.next?.work.id === b.work.id && <span className="pill tiny next-pill">Next up</span>}
              </div>
            </Link>
            {b.state === 'none' ? (
              <button className="btn btn-ghost sm" onClick={async () => {
                // A volume someone else added: use its catalogue record and first edition as they are.
                const found = store.editionsByWork.get(b.work.id)?.length
                  ? { work: b.work, editions: store.editionsByWork.get(b.work.id)! }
                  : await store.backend?.fetchWork(b.work.id).catch(() => null)
                const ed = found?.editions[0]
                store.addBook({
                  work: b.work, inCatalogue: true, status: 'want',
                  edition: ed ?? { format: 'paperback', narrators: [], translators: [] },
                })
                toast(`${b.work.title} added to Want to read`)
              }}><Plus size={14} /> Want to read</button>
            ) : (
              <span className={`pill tiny state-pill`}>{b.state === 'read' && <Check size={11} />} {STATE_LABEL[b.state] ?? STATUSES.find((x) => x.id === b.state)?.short}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="muted small">Books appear here when they’re in Folio with this series name. To add a missing volume, add the book and set its series and number.</p>
    </div>
  )
}
