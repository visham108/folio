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
import { BookDetails } from '../components/BookDetails'
import { averageColor } from '../lib/image'
import { progressInfo } from '../lib/progress'
import { seriesSlug } from '../lib/series'
import { FORMATS, MOODS, PACES, STATUSES, type Edition, type Pace, type Read, type ReadState, type Status } from '../lib/types'
import { coverPalette, daysBetween, fmtDate, fmtDuration, localIso, plural, today } from '../lib/util'
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
  const savedReview = useRef(entry?.review)
  useEffect(() => { savedReview.current = entry?.review; setReview(entry?.review ?? '') }, [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Notes changed somewhere else (the details list): show them, without undoing what you're typing here.
  useEffect(() => {
    if (entry?.review !== savedReview.current) { savedReview.current = entry?.review; setReview(entry?.review ?? '') }
  }, [entry?.review]) // eslint-disable-line react-hooks/exhaustive-deps

  // A book from a shared link may not be on your shelves yet: fetch it from the catalogue.
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'missing'>('idle')
  useEffect(() => {
    if (work || !workId) return
    setLookup('loading')
    store.loadWork(workId).then((ok) => setLookup(ok ? 'idle' : 'missing'))
  }, [workId, !!work]) // eslint-disable-line react-hooks/exhaustive-deps

  // A book you added that other readers now have can only be changed by the admin.
  const [sharedLock, setSharedLock] = useState(false)
  useEffect(() => {
    setSharedLock(false)
    const w = works.get(workId)
    if (!w || store.isAdmin || store.backend?.kind !== 'cloud' || w.createdBy !== store.userId) return
    let live = true
    store.backend.sharedWorks([workId]).then((ids) => { if (live) setSharedLock(ids.includes(workId)) }).catch(() => {})
    return () => { live = false }
  }, [workId, !!works.get(workId)]) // eslint-disable-line react-hooks/exhaustive-deps
  const canEditWork = (rec?: { createdBy?: string }) => store.canEdit(rec) && !sharedLock

  const fallbackAmb = useMemo(() => (work ? coverPalette(work.title + (work.authors[0] ?? ''))[0] : '#888'), [work])

  // Matched to a book already in the catalogue after you added it: follow it there.
  const movedTo = !work ? store.movedTo(workId) : undefined
  useEffect(() => { if (movedTo) nav(`/book/${movedTo}`, { replace: true }) }, [movedTo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Status menu: Escape or a click outside closes it; arrow keys move through it; near the
  // bottom of a phone screen it opens upwards so the tab bar doesn't cover it.
  const statusRef = useRef<HTMLDivElement>(null)
  const [menuUp, setMenuUp] = useState(false)
  useEffect(() => {
    if (!statusOpen) return
    const wrap = statusRef.current
    if (wrap) setMenuUp(wrap.getBoundingClientRect().bottom + 300 > window.innerHeight - 90)
    const items = () => [...(wrap?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [])]
    setTimeout(() => (items().find((b) => b.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus(), 30)
    const onDown = (e: PointerEvent) => { if (wrap && !wrap.contains(e.target as Node)) setStatusOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      const list = items()
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'Escape') { setStatusOpen(false); wrap?.querySelector<HTMLElement>('.status-btn')?.focus() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
      else if (e.key === 'Tab') setStatusOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [statusOpen])

  if (!work) {
    if (lookup !== 'missing') return <div className="page page-loading" aria-busy="true" />
    return <div className="page"><Empty title="Book not found"><p>It may have been merged into another book or removed. <Link className="link" to="/library">Back to your library</Link></p></Empty></div>
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
            {work.series && <Link to={`/series/${seriesSlug(work.series)}`} className="eyebrow series-eyebrow">{work.series}{work.seriesIndex != null ? ` · Book ${work.seriesIndex}` : ''} →</Link>}
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
              <div className="status-wrap" ref={statusRef}>
                <button className={`btn status-btn ${status ? 'st-' + status : 'btn-primary'}`} onClick={() => setStatusOpen((o) => !o)} aria-haspopup="menu" aria-expanded={statusOpen}>
                  {status ? <>{STATUSES.find((s) => s.id === status)?.label}</> : <><Plus size={16} /> Add to library</>}
                  <ChevronDown size={16} />
                </button>
                <AnimatePresence>
                  {statusOpen && (
                    <motion.div className={`menu ${menuUp ? 'menu-up' : ''}`} role="menu" aria-label="Move to pile" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}>
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
                  {(status === 'read' || status === 'dnf' || finished.length > 0) && (
                    <Stars value={entry.rating} size={24} label="Your rating" onChange={(v) => {
                      // The book's rating is the rating of your latest read, so the two never disagree.
                      const last = [...finished].sort((a, b) => (a.finishedOn ?? '').localeCompare(b.finishedOn ?? '')).pop()
                      if (last) store.saveRead({ ...last, rating: v })
                      store.updateEntry(entry.id, { rating: v })
                    }} />
                  )}
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

        <section className="section">
          <div className="section-head">
            <h2>Details</h2>
            {entry && <span className="muted small">Click any value to change it.</span>}
          </div>
          <BookDetails work={work} entry={entry} edition={edition} />
        </section>

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
                  <button className="edition-pick" onClick={() => entry && store.chooseEdition(entry.id, e.id)} disabled={!entry} title={entry ? 'Make this your edition' : undefined}>
                    <Cover work={work} edition={e} size="sm" />
                    <div className="edition-meta">
                      <b>{fmtIcon(e.format)} {fmtLabel(e.format)}</b>
                      {(e.publisher || e.publishedDate) && <span>{[e.publisher, e.publishedDate?.slice(0, 4)].filter(Boolean).join(' · ')}</span>}
                      <span className="muted">{edLength(e)}{e.language ? ` · ${e.language.toUpperCase()}` : ''}</span>
                      {e.narrators.length > 0 && <span className="muted">Narr. {e.narrators.join(', ')}</span>}
                      {e.title && e.title !== work.title && <span className="muted">“{e.title}”</span>}
                      <span className="muted tiny attribution">
                        {store.backend?.kind === 'cloud' && (e.createdBy === store.userId ? 'Added by you' : 'Added by another reader')}
                        {e.updatedAt && ` · edited ${fmtDate(localIso(new Date(e.updatedAt)))}`}
                      </span>
                    </div>
                    {mine && <span className="pill tiny mine-pill">Your edition</span>}
                  </button>
                  {canEditWork(e) && (
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
              {!active && (
                <button className="link" onClick={() => setEditRead(store.draftRead(entry.id))}>
                  <RotateCcw size={14} /> {finished.length ? 'Start a reread' : 'Log a read'}
                </button>
              )}
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
              <p className="muted">No reads logged yet. Use <b>Log a read</b> to record one, with dates if you remember them.</p>
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
                            ? <>{r.startedOn ? fmtDate(r.startedOn) : 'Start unknown'} → {r.finishedOn ? fmtDate(r.finishedOn) : r.state === 'reading' ? 'now' : r.state === 'paused' ? 'paused' : r.state === 'dnf' ? 'set aside' : 'end unknown'}{days ? ` · ${plural(days, 'day')}` : ''}</>
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

        {entry && (status !== 'want' || (entry.moods ?? []).length > 0 || entry.pace) && (
          <section className="section">
            <div className="section-head">
              <h2>How it felt</h2>
              <span className="muted small">Optional. Feeds your mood and pace stats.</span>
            </div>
            <div className="mood-picker" role="group" aria-label="Moods">
              {MOODS.map((m) => {
                const on = (entry.moods ?? []).includes(m)
                return (
                  <button key={m} className={`pill toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() =>
                    store.updateEntry(entry.id, { moods: on ? (entry.moods ?? []).filter((x) => x !== m) : [...(entry.moods ?? []), m] })}>
                    {on && <Check size={12} />} {m[0].toUpperCase() + m.slice(1)}
                  </button>
                )
              })}
            </div>
            <div className="pace-row">
              <span className="field-label">Pace</span>
              <Segmented<Pace | 'none'>
                size="sm"
                label="Pace"
                value={entry.pace ?? 'none'}
                onChange={(v) => store.updateEntry(entry.id, { pace: v === 'none' ? undefined : v })}
                options={[{ id: 'none', label: 'Not set' }, ...PACES.map((p) => ({ id: p.id, label: p.label }))]}
              />
            </div>
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
                  reviewTimer.current = setTimeout(() => { savedReview.current = v || undefined; store.updateEntry(entry.id, { review: v || undefined }) }, 600)
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
          {canEditWork(work) ? (
            <button className="btn btn-ghost sm" onClick={() => setEditWork(true)}><Pencil size={14} /> Edit book details</button>
          ) : (
            <span className="muted small lock-note"><Lock size={13} /> {sharedLock
              ? 'Other readers have this book now, so only the admin can change its details.'
              : 'Added by another reader, so only they or the admin can edit the details.'}</span>
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

/** Progress in one edition's units (pages, minutes or %) re-expressed in another's. */
function convertProgress(value: number | undefined, from?: Edition, to?: Edition) {
  if (value == null) return value
  const total = (e?: Edition) => (e ? (e.format === 'audiobook' ? e.durationMin : e.pages) : undefined)
  const a = total(from), b = total(to)
  const frac = a ? value / a : value / 100
  return Math.round(Math.min(1, Math.max(0, frac)) * (b ?? 100))
}

function ReadEditor({ read, editions, onClose }: { read: Read | null; editions: Edition[]; onClose: () => void }) {
  const store = useStore()
  const toast = useToast()
  const [r, setR] = useState<Read | null>(read)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setR(read); setConfirmDelete(false) }, [read])
  if (!r) return <Sheet open={false} onClose={onClose}>{null}</Sheet>
  // A read opened from "Log a read" isn't saved until you press Save.
  const isNew = !store.data.reads.some((x) => x.id === r.id)
  const set = (p: Partial<Read>) => setR({ ...r, ...p })
  const dateError =
    r.startedOn && r.finishedOn && r.startedOn.length === 10 && r.finishedOn.length === 10 && r.finishedOn < r.startedOn
      ? 'The finish date is before the start date.'
      : (r.startedOn ?? '') > today() || (r.finishedOn ?? '') > today() ? 'Dates can’t be in the future.' : ''
  const save = () => {
    store.saveRead(r)
    if (isNew) {
      const done = (store.readsByEntry.get(r.entryId) ?? []).filter((x) => x.state === 'finished').length
      toast(r.state === 'reading' ? (done ? `Reread #${done + 1} started` : 'Started reading') : 'Read added')
    }
    onClose()
  }
  return (
    <Sheet
      open={!!read}
      onClose={onClose}
      title={isNew ? 'Log a read' : 'Edit read'}
      footer={
        confirmDelete ? (
          <>
            <span className="muted small confirm-q">Delete this read and its progress?</span>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button className="btn btn-danger" onClick={() => { store.deleteRead(r.id); toast('Read deleted'); onClose() }}><Trash2 size={14} /> Delete</button>
          </>
        ) : (
          <>
            {!isNew && <button className="btn btn-ghost danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</button>}
            <button className="btn btn-primary" disabled={!!dateError} onClick={save}>{isNew ? 'Add read' : 'Save'}</button>
          </>
        )
      }
    >
      <div className="form-grid">
        <Field label="State" className="span-2">
          <Segmented<ReadState>
            value={r.state}
            onChange={(state) => set({
              state,
              // Finishing (or giving up) needs an end date for the stats; today is the likely one.
              finishedOn: (state === 'finished' || state === 'dnf') && !r.finishedOn ? today() : state === 'reading' || state === 'paused' ? undefined : r.finishedOn,
            })}
            options={[{ id: 'reading', label: 'Reading' }, { id: 'finished', label: 'Finished' }, { id: 'paused', label: 'Paused' }, { id: 'dnf', label: 'DNF' }]}
          />
        </Field>
        <Field label="Started" hint="Leave blank if you don’t remember">
          <input className="input" type="date" max={today()} value={r.startedOn?.length === 10 ? r.startedOn : ''} onChange={(e) => set({ startedOn: e.target.value || undefined })} />
        </Field>
        {(r.state === 'finished' || r.state === 'dnf') && (
          <Field label={r.state === 'dnf' ? 'Set aside on' : 'Finished'}>
            <input className="input" type="date" max={today()} min={r.startedOn?.length === 10 ? r.startedOn : undefined} value={r.finishedOn?.length === 10 ? r.finishedOn : ''} onChange={(e) => set({ finishedOn: e.target.value || undefined })} />
          </Field>
        )}
        {dateError && <p className="err small span-2">{dateError}</p>}
        {r.finishedOn && r.finishedOn.length < 10 && <p className="muted small span-2">Imported as “{r.finishedOn}”. Pick a full date to replace it.</p>}
        <Field label="Edition" className="span-2">
          <select className="select" value={r.editionId ?? ''} onChange={(e) => {
            const to = editions.find((x) => x.id === e.target.value)
            const from = editions.find((x) => x.id === r.editionId)
            set({ editionId: e.target.value || undefined, progress: convertProgress(r.progress, from, to) })
          }}>
            {editions.map((e) => <option key={e.id} value={e.id}>{fmtLabel(e.format)}{e.publisher ? ` · ${e.publisher}` : ''}{edLength(e) ? ` · ${edLength(e)}` : ''}</option>)}
          </select>
        </Field>
        {(r.state === 'finished' || r.state === 'dnf') && (
          <Field label="Rating for this read" className="span-2">
            <Stars value={r.rating} onChange={(rating) => set({ rating })} size={28} />
          </Field>
        )}
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
  // Kept as typed ("2.", "0") and read as a number on save, so 2.5 and Book 0 can be entered.
  const [indexText, setIndexText] = useState('')
  useEffect(() => {
    if (!open) return
    const cur = store.works.get(workId)
    setD(cur)
    setIndexText(cur?.seriesIndex != null ? String(cur.seriesIndex) : '')
  }, [open, workId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  const index = indexText.trim() === '' ? undefined : Number(indexText.replace(',', '.'))
  const indexBad = index != null && !Number.isFinite(index)
  const ok = d.title.trim() && d.authors.length && !indexBad
  return (
    <Sheet open={open} onClose={onClose} title="Book details" wide footer={
      <button className="btn btn-primary" disabled={!ok} onClick={() => { store.saveWork({ ...d, seriesIndex: index, title: titleCase(d.title), subtitle: d.subtitle ? titleCase(d.subtitle) : undefined }); onClose() }}>Save</button>
    }>
      <div className="form-grid">
        <Field label="Title" required className="span-2"><input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} onBlur={(e) => setD({ ...d, title: titleCase(e.target.value) })} /></Field>
        <Field label="Subtitle" className="span-2"><input className="input" value={d.subtitle ?? ''} onChange={(e) => setD({ ...d, subtitle: e.target.value || undefined })} onBlur={(e) => setD({ ...d, subtitle: titleCase(e.target.value) || undefined })} /></Field>
        <Field label="Authors" required className="span-2"><Chips value={d.authors} onChange={(authors) => setD({ ...d, authors })} normalize={nameCase} /></Field>
        <Field label="Series"><input className="input" value={d.series ?? ''} onChange={(e) => setD({ ...d, series: e.target.value || undefined })} onBlur={(e) => setD({ ...d, series: titleCase(e.target.value) || undefined })} /></Field>
        <Field label="Number in series" hint={indexBad ? 'Use a number, like 2 or 2.5' : undefined}><input className="input" inputMode="decimal" value={indexText} onChange={(e) => setIndexText(e.target.value)} /></Field>
        <Field label="First published"><input className="input" inputMode="numeric" value={d.firstPublished ?? ''} onChange={(e) => setD({ ...d, firstPublished: parseInt(e.target.value) || undefined })} /></Field>
        <Field label="Original language"><input className="input" value={d.originalLanguage ?? ''} onChange={(e) => setD({ ...d, originalLanguage: e.target.value || undefined })} /></Field>
        <Field label="Genres" className="span-2"><Chips value={d.genres} onChange={(genres) => setD({ ...d, genres })} normalize={titleCase} /></Field>
        <Field label="Description" className="span-2"><textarea className="input" rows={4} value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value || undefined })} /></Field>
      </div>
    </Sheet>
  )
}
