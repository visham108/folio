import { Link } from 'react-router-dom'
import { mediumOf, STATUSES, type Entry } from '../lib/types'
import { coverPalette, fmtDuration, hashString } from '../lib/util'
import { useStore } from '../state/store'

/**
 * Books as spines on a shelf. Spine width follows length (audiobooks in page-equivalents), the
 * colour matches the book's generated cover, and books you're reading now sit a little proud.
 */
export function SpineShelf({ entries, grouped, selecting, selected, onToggle }: {
  entries: Entry[]
  /** Split into one shelf per pile (used for "All"). */
  grouped: boolean
  selecting?: boolean
  selected?: Set<string>
  onToggle?: (id: string) => void
}) {
  const groups = grouped
    ? STATUSES.map((s) => ({ id: s.id, label: s.label, items: entries.filter((e) => e.status === s.id) })).filter((g) => g.items.length)
    : [{ id: 'all', label: '', items: entries }]
  return (
    <div className="spine-shelves">
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label || 'Books'}>
          {g.label && <div className="section-head"><h2>{g.label} <span className="muted small">{g.items.length}</span></h2></div>}
          <div className="spine-shelf">
            {g.items.map((e) => <Spine key={e.id} entry={e} selecting={selecting} selected={selected?.has(e.id)} onToggle={onToggle} />)}
          </div>
        </section>
      ))}
      <div className="spine-legend muted small">
        <span><i className="sw sw-audio" /> Audiobook</span>
        <span><i className="sw sw-ebook" /> Ebook</span>
        <span>Wider spines are longer books. Books you’re reading stand a little taller.</span>
      </div>
    </div>
  )
}

function Spine({ entry, selecting, selected, onToggle }: { entry: Entry; selecting?: boolean; selected?: boolean; onToggle?: (id: string) => void }) {
  const store = useStore()
  const work = store.works.get(entry.workId)!
  const ed = store.editionOf(entry)
  const medium = mediumOf(ed?.format)
  const pages = ed?.pages ?? (ed?.durationMin ? (ed.durationMin / 60) * store.data.settings.audioPagesPerHour : 0)
  const author = work.authors[0] ?? ''
  const [bg, fg] = coverPalette(work.title + author)
  const width = Math.round(Math.max(22, Math.min(64, (pages || 300) / 11)))
  const height = 150 + (hashString(work.title) % 46)
  const length = ed?.format === 'audiobook' ? fmtDuration(ed.durationMin) : pages ? `${pages} pages` : ''
  const label = [work.title, author, length].filter(Boolean).join(' · ')
  return (
    <div className="spine-cell">
      <Link
        to={`/book/${work.id}`}
        className={`spine ${entry.status === 'reading' ? 'raised' : ''} ${selecting && selected ? 'selected' : ''}`}
        style={{ width, height, background: bg, color: fg }}
        title={label}
        aria-label={label}
        role={selecting ? 'checkbox' : undefined}
        aria-checked={selecting ? !!selected : undefined}
        onClick={selecting ? (ev) => { ev.preventDefault(); onToggle?.(entry.id) } : undefined}
      >
        <span className="spine-title">{work.title}</span>
        {medium !== 'print' && <span className={`spine-band sw-${medium}`} aria-hidden />}
      </Link>
    </div>
  )
}

/** Hue of a book's spine, for arranging the shelf by colour. Greys go last. */
export function spineHue(title: string, author = ''): number {
  const hex = coverPalette(title + author)[0]
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d < 0.04) return 400
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
