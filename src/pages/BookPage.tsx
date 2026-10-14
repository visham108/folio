import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, BookMarked, Lock, Check, ChevronDown, Headphones, Heart, Library as LibIcon, Pencil, Plus, RotateCcw, Tablet, Trash2,
} from 'lucide-react'
import { nameCase, titleCase } from '../lib/titleCase'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Cover } from '../components/Cover'
import { EditionForm } from '../components/EditionForm'
import { ProgressSheet } from '../components/ProgressSheet'
import { Bar, Chips, ConfirmSheet, Empty, Field, Segmented, Sheet, Stars } from '../components/ui'
import { AdminPanel } from '../components/AdminPanel'
import { averageColor } from '../lib/image'
import { progressInfo } from '../lib/progress'
import { FORMATS, STATUSES, type Edition, type Read, type ReadState, type Status } from '../lib/types'
import { coverPalette, daysBetween, fmtDate, fmtDuration, plural, today } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

const fmtIcon = (f?: string) => (f === 'audiobook' ? <Headphones size={14} /> : f === 'ebook' ? <Tablet size={14} /> : <BookMarked size={14} />)
const fmtLabel = (f?: string) => FORMATS.find((x) => x.id === f)?.label ?? 'Edition'
const edLength = (e?: Edition) => (e?.format === 'audiobook' ? fmtDuration(e.durationMin) : e?.pages ? `${e.pages} pages` : '')

export function BookPage() {
  const { workId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const store = useStore()
  const { works, editionsByWork, entryByWork, readsByEntry, data } = store
  const work = works.get(workId)
  const entry = entryByWork.get(workId)
  const eds = editionsByWork.get(workId) ?? []
  const edition = entry ? store.editionOf(entry) : eds[0]
  const reads = entry ? readsByEntry.get(entry.id) ?? [] : []
  const finished = reads.filter((r) => r.state === 'finished')
  const active = reads.find((r) => r.state === 'reading' || r.state === 'paused')

  const [amb, setAmb] = useState<string>()
  const [statusOpen, setStatusOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [editRead, setEditRead] = useState<Read | null>(null)
  const [editEdition, setEditEdition] = useState<Edition | 'new' | null>(null)
  const [editWork, setEditWork] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [review, setReview] = useState(entry?.review ?? '')
  const reviewTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => setReview(entry?.review ?? ''), [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fallbackAmb = useMemo(() => (work ? coverPalette(work.title + (work.authors[0] ?? ''))[0] : '#888'), [work])

  if (!work) {
    return <div className="page"><Empty title="Book not found"><p><Link className="link" to="/library">Back to your library</Link></p></Empty></div>
  }

  const status = entry?.status
  const setStatus = (s: Status) => {
    setStatusOpen(false)
    if (!entry) {
      store.addBook({ work, edition: { ...(edition ?? { format: 'paperback', narrators: [], translators: [] }), id: edition?.id }, status: s })
      toast(`Added to ${STATUSES.find((x) => x.id === s)?.label}`)
      return
    }
    store.setStatus(entry.id, s)
  }

  return (
    <div className="book-page" style={{ ['--amb' as string]: amb ?? fallbackAmb }}>
      <div className="book-ambient" aria-hidden />
      <div className="page">
        <button className="back" onClick={() => (history.length > 1 ? nav(-1) : nav('/library'))}><ArrowLeft size={16} /> Back</button>

        <div className="book-hero">
          <div className="book-cover-col">
            <motion.div layoutId={`cover-${work.id}`}>
              <Cover
                work={work}
                edition={edition}
                size="xl"
                onLoadImg={(img) => {
                  const c = averageColor(img)
                  if (c) setAmb(`rgb(${c[0]} ${c[1]} ${c[2]})`)
                }}
              />
            </motion.div>
          </div>

          <div className="book-info">
            {work.series && <div className="eyebrow">{work.series}{work.seriesIndex ? ` · Book ${work.seriesIndex}` : ''}</div>}
            <h1 className="book-title">{work.title}</h1>
            {work.subtitle && <p className="book-sub">{work.subtitle}</p>}
            <p className="book-by">by {work.authors.join(', ')}</p>
            <div className="book-facts">
              {edition && <span>{fmtIcon(edition.format)} {fmtLabel(edition.format)}</span>}
              {edLength(edition) && <span>{edLength(edition)}</span>}
              {edition?.narrators.length ? <span>Narrated by {edition.narrators.join(', ')}</span> : null}
              {work.firstPublished && <span>First published {work.firstPublished}</span>}
            </div>
            {work.genres.length > 0 && <div className="genres">{work.genres.map((g) => <span key={g} className="pill">{g}</span>)}</div>}

            <div className="book-actions">
              <div className="status-wrap">
                <button className={`btn status-btn ${status ? 'st-' + status : 'btn-primary'}`} onClick={() => setStatusOpen((o) => !o)} aria-haspopup="menu" aria-expanded={statusOpen}>
                  {status ? <><Check size={16} /> {STATUSES.find((s) => s.id === status)?.label}</> : <><Plus size={16} /> Add to library</>}
                  <ChevronDown size={16} />
                </button>
                <AnimatePresence>
                  {statusOpen && (
                    <motion.div className="menu" role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}>
                      {STATUSES.map((s) => (
                        <button key={s.id} role="menuitemradio" aria-checked={status === s.id} onClick={() => setStatus(s.id)}>
                          {s.label}{status === s.id && <Check size={14} />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {entry && (
                <>
                  <Stars value={entry.rating} onChange={(v) => store.updateEntry(entry.id, { rating: v })} size={24} label="Your rating" />
                  <button
                    className={`icon-btn heart ${entry.favorite ? 'on' : ''}`}
                    aria-pressed={entry.favorite}
                    aria-label="Favourite"
                    onClick={() => store.updateEntry(entry.id, { favorite: !entry.favorite })}
                  >
                    <Heart size={20} fill={entry.favorite ? 'currentColor' : 'none'} />
                  </button>
                </>
              )}
            </div>

            {entry && active && (
              <div className="card progress-card">
                {(() => {
                  const ed = store.editions.get(active.editionId ?? '') ?? edition
                  const info = progressInfo(active, ed)
                  return (
                    <>
                      <div className="progress-card-top">
                        <span>{active.state === 'paused' ? 'Paused at' : finished.length ? `Reread #${finished.length + 1}` : 'Progress'} · {info.label}</span>
                        <b>{Math.round(info.pct * 100)}%</b>
                      </div>
                      <Bar pct={info.pct} tone={ed?.format === 'audiobook' ? 'audio' : 'accent'} />
                      <div className="progress-card-foot">
                        <span className="muted small">{info.left}{active.startedOn ? ` · started ${fmtDate(active.startedOn)}` : ''}</span>
                        <button className="btn btn-soft sm" onClick={() => setProgressOpen(true)}>Update</button>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Editions */}
        <section className="section">
          <div className="section-head">
            <h2>Editions <span className="count">{eds.length}</span></h2>
            <button className="link" onClick={() => setEditEdition('new')}><Plus size={14} /> Add edition</button>
          </div>
          <div className="editions">
            {eds.map((e) => {
              const mine = entry?.editionId === e.id
              return (
                <div key={e.id} className={`edition ${mine ? 'mine' : ''}`}>
                  <button className="edition-pick" onClick={() => entry && store.updateEntry(entry.id, { editionId: e.id })} disabled={!entry} title={entry ? 'Make this your edition' : undefined}>
                    <Cover work={work} edition={e} size="sm" />
                    <div className="edition-meta">
                      <b>{fmtIcon(e.format)} {fmtLabel(e.format)}</b>
                      {(e.publisher || e.publishedDate) && <span>{[e.publisher, e.publishedDate?.slice(0, 4)].filter(Boolean).join(' · ')}</span>}
                      <span className="muted">{edLength(e)}{e.language ? ` · ${e.language.toUpperCase()}` : ''}</span>
                      {e.narrators.length > 0 && <span className="muted">Narr. {e.narrators.join(', ')}</span>}
                      {e.title && e.title !== work.title && <span className="muted">“{e.title}”</span>}
                      <span className="muted tiny attribution">
                        {store.backend?.kind === 'cloud' && (e.createdBy === store.userId ? 'Added by you' : 'Added by another reader')}
                        {e.updatedAt && ` · edited ${fmtDate(e.updatedAt.slice(0, 10))}`}
                      </span>
                    </div>
                    {mine && <span className="pill tiny mine-pill">Your edition</span>}
                  </button>
                  {store.canEdit(e) && (
                    <button className="icon-btn edition-edit" aria-label="Edit edition" onClick={() => setEditEdition(e)}><Pencil size={14} /></button>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {entry && (
          <section className="section">
            <div className="section-head">
              <h2>Reading history</h2>
              <button className="link" onClick={() => {
                const r = store.startRead(entry.id)
                toast(finished.length ? `Reread #${finished.length + 1} started` : 'Started reading')
                setEditRead(r)
              }}>
                <RotateCcw size={14} /> {finished.length ? 'Start a reread' : 'Log a read'}
              </button>
            </div>
            {finished.length > 0 && (
              <p className="muted history-sum">
                Read {finished.length === 1 ? 'once' : finished.length === 2 ? 'twice' : `${finished.length} times`}
                {(() => {
                  const fmts = new Set(finished.map((r) => store.editions.get(r.editionId ?? '')?.format).filter(Boolean))
                  return fmts.size > 1 ? ` across ${[...fmts].map((f) => fmtLabel(f).toLowerCase()).join(' and ')}` : ''
                })()}.
              </p>
            )}
            {reads.length === 0 ? (
              <p className="muted">No reads logged yet. Use <b>Log a read</b> to add dates from the past.</p>
            ) : (
              <ol className="timeline">
                {[...reads].reverse().map((r) => {
                  const n = reads.filter((x) => x.state === 'finished' && (x.finishedOn ?? '') <= (r.finishedOn ?? '￿')).length
                  const ed = store.editions.get(r.editionId ?? '')
                  const days = daysBetween(r.startedOn, r.finishedOn)
                  return (
                    <li key={r.id} className={`tl tl-${r.state}`}>
                      <span className="tl-dot" />
                      <button className="tl-body" onClick={() => setEditRead(r)}>
                        <div className="tl-top">
                          <b>{r.state === 'finished' ? `Read #${n}` : r.state === 'reading' ? 'Reading now' : r.state === 'dnf' ? 'Did not finish' : 'Paused'}</b>
                          {ed && <span className="pill tiny">{fmtIcon(ed.format)} {fmtLabel(ed.format)}</span>}
                          {r.rating ? <Stars value={r.rating} size={12} /> : null}
                        </div>
                        <div className="muted small">
                          {r.startedOn || r.finishedOn
                            ? <>{r.startedOn ? fmtDate(r.startedOn) : '?'} → {r.finishedOn ? fmtDate(r.finishedOn) : r.state === 'reading' ? 'now' : '?'}{days ? ` · ${plural(days, 'day')}` : ''}</>
                            : 'No dates'}
                        </div>
                        {r.notes && <p className="tl-notes">{r.notes}</p>}
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )}

        {entry && (
          <section className="section two-col">
            <div>
              <h2>Your notes</h2>
              <textarea
                className="input review"
                rows={5}
                value={review}
                placeholder="Thoughts, quotes, who to lend it to…"
                onChange={(e) => {
                  const v = e.target.value
                  setReview(v)
                  clearTimeout(reviewTimer.current)
                  reviewTimer.current = setTimeout(() => store.updateEntry(entry.id, { review: v || undefined }), 600)
                }}
              />
              <p className="muted tiny">Saves as you type.</p>
            </div>
            <div>
              <h2>Shelves & tags</h2>
              <div className="shelf-toggles">
                {data.shelves.length === 0 && <span className="muted small">No custom shelves yet. Create one in the Library.</span>}
                {data.shelves.map((s) => {
                  const on = entry.shelfIds.includes(s.id)
                  return (
                    <button key={s.id} className={`pill toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() =>
                      store.updateEntry(entry.id, { shelfIds: on ? entry.shelfIds.filter((x) => x !== s.id) : [...entry.shelfIds, s.id] })}>
                      {on && <Check size={12} />} {s.emoji} {s.name}
                    </button>
                  )
                })}
              </div>
              <Chips value={entry.tags} onChange={(tags) => store.updateEntry(entry.id, { tags })} normalize={titleCase} placeholder="Add a tag…" />
              <label className="check">
                <input type="checkbox" checked={entry.owned} onChange={(e) => store.updateEntry(entry.id, { owned: e.target.checked })} />
                I own a copy
              </label>
            </div>
          </section>
        )}

        {work.description && (
          <section className="section">
            <h2>About</h2>
            <p className="about">{work.description.replace(/<[^>]+>/g, '')}</p>
          </section>
        )}

        {store.isAdmin && store.backend?.kind === 'cloud' && <AdminPanel work={work} editions={eds} />}

        <section className="section foot-actions">
          {store.canEdit(work) ? (
            <button className="btn btn-ghost sm" onClick={() => setEditWork(true)}><Pencil size={14} /> Edit book details</button>
          ) : (
            <span className="muted small lock-note"><Lock size={13} /> Added by another reader, so only they or the admin can edit the details.</span>
          )}
          {entry && (
            <button className="btn btn-ghost sm danger" onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Remove from library</button>
          )}
          <Link to="/library" className="btn btn-ghost sm"><LibIcon size={14} /> Library</Link>
        </section>
      </div>

      <ProgressSheet read={active} open={progressOpen} onClose={() => setProgressOpen(false)} />
      <ReadEditor read={editRead} editions={eds} onClose={() => setEditRead(null)} />
      <Sheet open={!!editEdition} onClose={() => setEditEdition(null)} title={editEdition === 'new' ? 'Add an edition' : 'Edit edition'} wide>
        {editEdition && (
          <EditionForm
            workId={work.id}
            workTitle={work.title}
            initial={editEdition === 'new' ? undefined : editEdition}
            onDelete={editEdition !== 'new' && store.isAdmin && store.backend?.kind === 'cloud' ? async () => {
              try {
                await store.deleteEdition(editEdition.id)
                toast('Edition removed')
              } catch (err) {
                toast('Couldn’t remove the edition: ' + (err as Error).message, { tone: 'error' })
              }
              setEditEdition(null)
            } : undefined}
            onDone={(e) => {
              store.saveEdition({ ...e, createdBy: e.createdBy ?? store.userId })
              if (editEdition === 'new' && entry) store.updateEntry(entry.id, { editionId: e.id })
              toast(editEdition === 'new' ? 'Edition added' : 'Edition updated')
              setEditEdition(null)
            }}
          />
        )}
      </Sheet>
      <WorkEditor open={editWork} onClose={() => setEditWork(false)} workId={work.id} />
      <ConfirmSheet
        open={confirmRemove}
        title="Remove from your library?"
        confirmLabel="Remove"
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (!entry) return
          const undo = store.removeEntry(entry.id)
          setConfirmRemove(false)
          toast(`Removed ${work.title}`, { action: { label: 'Undo', run: undo } })
          nav('/library')
        }}
      >
        <p>“{work.title}” and its reading history ({plural(reads.length, 'read')}) will leave your shelves. The book stays in the shared catalogue.</p>
      </ConfirmSheet>
    </div>
  )
}

function ReadEditor({ read, editions, onClose }: { read: Read | null; editions: Edition[]; onClose: () => void }) {
  const store = useStore()
  const [r, setR] = useState<Read | null>(read)
  useEffect(() => setR(read), [read])
  if (!r) return <Sheet open={false} onClose={onClose}>{null}</Sheet>
  const set = (p: Partial<Read>) => setR({ ...r, ...p })
  const dateError =
    r.startedOn && r.finishedOn && r.startedOn.length === 10 && r.finishedOn.length === 10 && r.finishedOn < r.startedOn
      ? 'The finish date is before the start date.'
      : (r.startedOn ?? '') > today() || (r.finishedOn ?? '') > today() ? 'Dates can’t be in the future.' : ''
  return (
    <Sheet
      open={!!read}
      onClose={onClose}
      title="Edit read"
      footer={
        <>
          <button className="btn btn-ghost danger" onClick={() => { store.deleteRead(r.id); onClose() }}><Trash2 size={14} /> Delete</button>
          <button className="btn btn-primary" disabled={!!dateError} onClick={() => { store.saveRead(r); onClose() }}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="State" className="span-2">
          <Segmented<ReadState>
            value={r.state}
            onChange={(state) => set({ state })}
            options={[{ id: 'reading', label: 'Reading' }, { id: 'finished', label: 'Finished' }, { id: 'paused', label: 'Paused' }, { id: 'dnf', label: 'DNF' }]}
          />
        </Field>
        <Field label="Started" hint="Leave blank if you don’t remember">
          <input className="input" type="date" max={today()} value={r.startedOn?.length === 10 ? r.startedOn : ''} onChange={(e) => set({ startedOn: e.target.value || undefined })} />
        </Field>
        <Field label="Finished">
          <input className="input" type="date" max={today()} min={r.startedOn?.length === 10 ? r.startedOn : undefined} value={r.finishedOn?.length === 10 ? r.finishedOn : ''} onChange={(e) => set({ finishedOn: e.target.value || undefined })} />
        </Field>
        {dateError && <p className="err small span-2">{dateError}</p>}
        {r.finishedOn && r.finishedOn.length < 10 && <p className="muted small span-2">Imported as “{r.finishedOn}”. Pick a full date to replace it.</p>}
        <Field label="Edition" className="span-2">
          <select className="select" value={r.editionId ?? ''} onChange={(e) => set({ editionId: e.target.value || undefined })}>
            {editions.map((e) => <option key={e.id} value={e.id}>{fmtLabel(e.format)}{e.publisher ? ` · ${e.publisher}` : ''}{edLength(e) ? ` · ${edLength(e)}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Rating for this read" className="span-2">
          <Stars value={r.rating} onChange={(rating) => set({ rating })} size={28} />
        </Field>
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={3} value={r.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} placeholder="What stood out this time?" />
        </Field>
      </div>
    </Sheet>
  )
}

function WorkEditor({ open, onClose, workId }: { open: boolean; onClose: () => void; workId: string }) {
  const store = useStore()
  const w = store.works.get(workId)
  const [d, setD] = useState(w)
  useEffect(() => { if (open) setD(store.works.get(workId)) }, [open, workId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  const ok = d.title.trim() && d.authors.length
  return (
    <Sheet open={open} onClose={onClose} title="Book details" wide footer={
      <button className="btn btn-primary" disabled={!ok} onClick={() => { store.saveWork({ ...d, title: titleCase(d.title), subtitle: d.subtitle ? titleCase(d.subtitle) : undefined }); onClose() }}>Save</button>
    }>
      <div className="form-grid">
        <Field label="Title" required className="span-2"><input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} onBlur={(e) => setD({ ...d, title: titleCase(e.target.value) })} /></Field>
        <Field label="Subtitle" className="span-2"><input className="input" value={d.subtitle ?? ''} onChange={(e) => setD({ ...d, subtitle: e.target.value || undefined })} onBlur={(e) => setD({ ...d, subtitle: titleCase(e.target.value) || undefined })} /></Field>
        <Field label="Authors" required className="span-2"><Chips value={d.authors} onChange={(authors) => setD({ ...d, authors })} normalize={nameCase} /></Field>
        <Field label="Series"><input className="input" value={d.series ?? ''} onChange={(e) => setD({ ...d, series: e.target.value || undefined })} onBlur={(e) => setD({ ...d, series: titleCase(e.target.value) || undefined })} /></Field>
        <Field label="Number in series"><input className="input" inputMode="decimal" value={d.seriesIndex ?? ''} onChange={(e) => setD({ ...d, seriesIndex: parseFloat(e.target.value) || undefined })} /></Field>
        <Field label="First published"><input className="input" inputMode="numeric" value={d.firstPublished ?? ''} onChange={(e) => setD({ ...d, firstPublished: parseInt(e.target.value) || undefined })} /></Field>
        <Field label="Original language"><input className="input" value={d.originalLanguage ?? ''} onChange={(e) => setD({ ...d, originalLanguage: e.target.value || undefined })} /></Field>
        <Field label="Genres" className="span-2"><Chips value={d.genres} onChange={(genres) => setD({ ...d, genres })} normalize={titleCase} /></Field>
        <Field label="Description" className="span-2"><textarea className="input" rows={4} value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value || undefined })} /></Field>
      </div>
    </Sheet>
  )
}
