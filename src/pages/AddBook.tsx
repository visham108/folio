import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Camera, Check, Loader2, PenLine, ScanLine, Search, Undo2, X } from 'lucide-react'
import { nameCase, titleCase } from '../lib/titleCase'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cover } from '../components/Cover'
import { CoverStudio } from '../components/CoverStudio'
import { blankEdition, EditionFields, type EditionDraft } from '../components/EditionForm'
import { Scanner } from '../components/Scanner'
import { Chips, Field, Segmented, Stars } from '../components/ui'
import { searchBooks, type LookupResult } from '../lib/lookup'
import { confidenceOf, findCandidates, type MatchCandidate } from '../lib/match'
import type { Edition, Status, Work } from '../lib/types'
import { cleanIsbn, today } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

interface WorkDraft {
  title: string
  subtitle?: string
  authors: string[]
  series?: string
  seriesIndex?: number
  genres: string[]
  firstPublished?: number
  description?: string
}
const blankWork = (): WorkDraft => ({ title: '', authors: [], genres: [] })

export function AddBook() {
  const nav = useNavigate()
  const [step, setStep] = useState<'search' | 'form'>('search')
  const [work, setWork] = useState<WorkDraft>(blankWork)
  const [edition, setEdition] = useState<EditionDraft>(blankEdition())

  const startForm = (w: WorkDraft, e: EditionDraft) => {
    setWork(w)
    setEdition(e)
    setStep('form')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="page add-page">
      <AnimatePresence mode="wait" initial={false}>
        {step === 'search' ? (
          <motion.div key="s" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
            <SearchStep
              onPick={(r) => startForm(
                { title: r.title, subtitle: r.subtitle, authors: r.authors, genres: r.genres, firstPublished: r.firstPublished ?? (parseInt(r.publishedDate ?? '', 10) || undefined), description: r.description },
                { ...blankEdition(), pages: r.pages, publisher: r.publisher, publishedDate: r.publishedDate, isbn13: r.isbn13, isbn10: r.isbn10, coverUrl: r.coverUrl, language: r.language },
              )}
              onManual={(w, e) => startForm({ ...blankWork(), ...w }, { ...blankEdition(), ...e })}
              onOpen={(workId) => nav(`/book/${workId}`)}
            />
          </motion.div>
        ) : (
          <motion.div key="f" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
            <FormStep work={work} setWork={setWork} edition={edition} setEdition={setEdition} onBack={() => setStep('search')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Step 1: find it ─────────────────────────────────────────────────────────

function SearchStep({ onPick, onManual, onOpen }: {
  onPick: (r: LookupResult) => void
  onManual: (w?: Partial<WorkDraft>, e?: Partial<EditionDraft>) => void
  onOpen: (workId: string) => void
}) {
  const store = useStore()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LookupResult[]>([])
  const [remote, setRemote] = useState<{ works: Work[]; editions: Edition[] }>({ works: [], editions: [] })
  const [loading, setLoading] = useState(false)
  const [scan, setScan] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setResults([]); setLoading(false); return }
    const ctl = new AbortController()
    setLoading(true)
    const t = setTimeout(async () => {
      const [r, c] = await Promise.all([
        searchBooks(query, ctl.signal).catch(() => []),
        store.backend?.searchCatalog(query, []).catch(() => ({ works: [], editions: [] })) ?? { works: [], editions: [] },
      ])
      if (ctl.signal.aborted) return
      setResults(r)
      setRemote(c)
      setLoading(false)
    }, 350)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  // Books already in Folio (yours first, then the shared catalogue).
  const known = useMemo(() => {
    const query = q.trim()
    if (query.length < 2) return []
    const isbn = cleanIsbn(query)
    const works = [...store.data.works, ...remote.works.filter((w) => !store.works.has(w.id))]
    const eds = [...store.data.editions, ...remote.editions.filter((e) => !store.editions.has(e.id))]
    const byTitle = findCandidates({ title: isbn ? '' : query, authors: [], isbn }, works, eds, 6)
    const byAuthor = isbn ? [] : works.filter((w) => w.authors.some((a) => a.toLowerCase().includes(query.toLowerCase()))).slice(0, 6)
    const seen = new Set<string>()
    return [...byTitle.map((c) => c.work), ...byAuthor].filter((w) => !seen.has(w.id) && seen.add(w.id)).slice(0, 6).map((w) => ({
      work: w, editions: eds.filter((e) => e.workId === w.id),
    }))
  }, [q, store.data.works, store.data.editions, remote, store.works, store.editions])

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Add a book</p>
        <h1 className="display">What are you <em>reading?</em></h1>
      </header>
      <label className="search big">
        <Search size={20} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author or ISBN" />
        {loading ? <Loader2 size={18} className="spin muted" /> : q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear"><X size={16} /></button>}
      </label>
      <div className="add-modes">
        <button className="mode" onClick={() => setScan(true)}><ScanLine size={20} /><b>Scan barcode</b><span>Fastest for print books</span></button>
        <button className="mode" onClick={() => fileRef.current?.click()}><Camera size={20} /><b>Photograph the cover</b><span>We’ll tidy the photo up</span></button>
        <button className="mode" onClick={() => onManual({ title: cleanIsbn(q) ? '' : titleCase(q) })}><PenLine size={20} /><b>Enter it yourself</b><span>For anything not listed</span></button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = '' }} />

      {known.length > 0 && (
        <section className="section tight">
          <h3 className="list-head">Already in Folio</h3>
          <ul className="results">
            {known.map(({ work, editions }) => {
              const entry = store.entryByWork.get(work.id)
              return (
                <li key={work.id}>
                  <button className="result" onClick={() => {
                    // From the shared catalogue: bring it into this session so the book page can render it.
                    if (!store.works.has(work.id)) store.remember([work], editions)
                    onOpen(work.id)
                  }}>
                    <Cover work={work} edition={editions[0]} size="sm" />
                    <div className="result-main">
                      <b>{work.title}</b>
                      <span>{work.authors.join(', ')}</span>
                      <span className="muted small">{editions.length} {editions.length === 1 ? 'edition' : 'editions'}{entry ? ' · on your shelves' : ''}</span>
                    </div>
                    {entry && <span className="pill tiny"><Check size={10} /> Yours</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {results.length > 0 && (
        <section className="section tight">
          <h3 className="list-head">From the web</h3>
          <ul className="results">
            {results.map((r, i) => (
              <motion.li key={`${r.title}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <button className="result" onClick={() => onPick(r)}>
                  <Cover work={r} edition={{ coverUrl: r.coverUrl, format: 'paperback' }} size="sm" />
                  <div className="result-main">
                    <b>{r.title}{r.subtitle ? <span className="muted">: {r.subtitle}</span> : null}</b>
                    <span>{r.authors.join(', ') || 'Unknown author'}</span>
                    <span className="muted small">{[r.firstPublished ?? r.publishedDate?.slice(0, 4), r.pages && `${r.pages} pages`, r.publisher].filter(Boolean).join(' · ')}</span>
                  </div>
                </button>
              </motion.li>
            ))}
          </ul>
        </section>
      )}
      {!loading && q.trim().length >= 2 && !results.length && !known.length && (
        <p className="muted center pad">No results online. <button className="link" onClick={() => onManual({ title: titleCase(q) })}>Add “{q}” yourself</button></p>
      )}

      <Scanner open={scan} onClose={() => setScan(false)} onIsbn={(isbn) => { setScan(false); setQ(isbn) }} />
      <CoverStudio
        file={photo}
        onClose={() => setPhoto(null)}
        onDone={(url) => {
          setPhoto(null)
          onManual({ title: cleanIsbn(q) ? '' : titleCase(q) }, { coverUrl: url })
        }}
      />
    </>
  )
}

// ── Step 2: confirm details ─────────────────────────────────────────────────

function FormStep({ work, setWork, edition, setEdition, onBack }: {
  work: WorkDraft; setWork: (w: WorkDraft) => void; edition: EditionDraft; setEdition: (e: EditionDraft) => void; onBack: () => void
}) {
  const store = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [status, setStatus] = useState<Status>('want')
  const [startedOn, setStartedOn] = useState(today())
  const [finishedOn, setFinishedOn] = useState(today())
  const [rating, setRating] = useState<number>()
  const [attach, setAttach] = useState<MatchCandidate | null>(null)
  const [useExisting, setUseExisting] = useState<Edition | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [remote, setRemote] = useState<{ works: Work[]; editions: Edition[] }>({ works: [], editions: [] })
  const [touched, setTouched] = useState(false)

  // Shared catalogue lookups for duplicate detection (debounced).
  useEffect(() => {
    if (!store.backend || work.title.trim().length < 2) return
    const t = setTimeout(() => store.backend!.searchCatalog(work.title, work.authors).then(setRemote).catch(() => {}), 400)
    return () => clearTimeout(t)
  }, [work.title, work.authors.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => {
    const works = [...store.data.works, ...remote.works.filter((w) => !store.works.has(w.id))]
    const eds = [...store.data.editions, ...remote.editions.filter((e) => !store.editions.has(e.id))]
    return findCandidates({ title: work.title, authors: work.authors, isbn: edition.isbn13 ?? edition.isbn10, asin: edition.asin }, works, eds, 3)
      .filter((c) => !dismissed.has(c.work.id))
  }, [work.title, work.authors, edition.isbn13, edition.isbn10, edition.asin, remote, dismissed, store.data.works, store.data.editions, store.works, store.editions])
  const top = attach ? null : candidates[0]

  const errors = {
    title: !attach && !work.title.trim() ? 'Title is required' : '',
    authors: !attach && !work.authors.length ? 'Add at least one author' : '',
  }
  const dateError = status === 'read' && startedOn && finishedOn && finishedOn < startedOn ? 'The finish date is before the start date.' : ''
  const valid = !errors.title && !errors.authors && !dateError

  const doAttach = (c: MatchCandidate) => {
    setAttach(c)
    if (c.sameEdition) setUseExisting(c.sameEdition)
    store.remember([c.work], c.editions)
  }

  const save = () => {
    setTouched(true)
    if (!valid) return
    const w = attach?.work
    const entry = store.addBook({
      work: w ?? {
        title: titleCase(work.title), subtitle: work.subtitle ? titleCase(work.subtitle) : undefined, authors: work.authors, series: work.series ? titleCase(work.series) : undefined,
        seriesIndex: work.seriesIndex, genres: work.genres, firstPublished: work.firstPublished, description: work.description,
      },
      edition: useExisting ?? edition,
      status,
      startedOn: status === 'reading' || status === 'read' ? startedOn || undefined : undefined,
      finishedOn: status === 'read' ? finishedOn || undefined : undefined,
      rating: status === 'read' ? rating : undefined,
    })
    toast(attach ? `Added as a new edition of ${attach.work.title}` : 'Added to your library')
    nav(`/book/${entry.workId}`)
  }

  return (
    <>
      <button className="back" onClick={onBack}><ArrowLeft size={16} /> Search again</button>
      <header className="page-head">
        <p className="eyebrow">{attach ? 'New edition' : 'New book'}</p>
        <h1 className="display">{attach ? <>Adding an edition of <em>{attach.work.title}</em></> : <>Check the <em>details.</em></>}</h1>
      </header>

      <AnimatePresence>
        {top && (
          <motion.div className={`match card conf-${confidenceOf(top)}`} initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Cover work={top.work} edition={top.sameEdition ?? top.editions[0]} size="sm" />
            <div className="match-body">
              <span className="kicker">{confidenceOf(top) === 'exact' ? 'This exact edition is already here' : confidenceOf(top) === 'strong' ? 'Looks like this book is already in Folio' : 'Is this the same book?'}</span>
              <b>{top.work.title}</b>
              <span>{top.work.authors.join(', ')} · {top.editions.length} {top.editions.length === 1 ? 'edition' : 'editions'}</span>
              <span className="muted small">{top.reason}</span>
              <div className="match-actions">
                <button className="btn btn-primary sm" onClick={() => doAttach(top)}>
                  {top.sameEdition ? 'Use this edition' : 'Add as another edition'}
                </button>
                <button className="btn btn-ghost sm" onClick={() => setDismissed(new Set([...dismissed, top.work.id]))}>It’s a different book</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {attach && (
        <div className="attached card">
          <Cover work={attach.work} edition={attach.editions[0]} size="xs" />
          <div><b>{attach.work.title}</b><span className="muted"> · {attach.work.authors.join(', ')}</span></div>
          <button className="btn btn-ghost sm" onClick={() => { setAttach(null); setUseExisting(null) }}><Undo2 size={14} /> Undo</button>
        </div>
      )}

      <div className="add-form">
        {!attach && (
          <section className="card form-card">
            <h3>The book</h3>
            <div className="form-grid">
              <Field label="Title" required className="span-2" hint={touched && errors.title ? <span className="err">{errors.title}</span> : undefined}>
                <input className="input" value={work.title} onChange={(e) => setWork({ ...work, title: e.target.value })} onBlur={(e) => setWork({ ...work, title: titleCase(e.target.value) })} placeholder="The Left Hand of Darkness" />
              </Field>
              <Field label="Author(s)" required className="span-2" hint={touched && errors.authors ? <span className="err">{errors.authors}</span> : 'Press Enter after each name'}>
                <Chips value={work.authors} onChange={(authors) => setWork({ ...work, authors })} normalize={nameCase} placeholder="Ursula K. Le Guin" suggestions={[...new Set(store.data.works.flatMap((w) => w.authors))]} />
              </Field>
              <Field label="Subtitle" className="span-2"><input className="input" value={work.subtitle ?? ''} onChange={(e) => setWork({ ...work, subtitle: e.target.value || undefined })} onBlur={(e) => setWork({ ...work, subtitle: titleCase(e.target.value) || undefined })} /></Field>
              <Field label="Series"><input className="input" value={work.series ?? ''} onChange={(e) => setWork({ ...work, series: e.target.value || undefined })} onBlur={(e) => setWork({ ...work, series: titleCase(e.target.value) || undefined })} /></Field>
              <Field label="#"><input className="input" inputMode="decimal" value={work.seriesIndex ?? ''} onChange={(e) => setWork({ ...work, seriesIndex: parseFloat(e.target.value) || undefined })} /></Field>
              <Field label="Genres" className="span-2"><Chips value={work.genres} onChange={(genres) => setWork({ ...work, genres })} normalize={titleCase} placeholder="Fantasy, Memoir…" suggestions={[...new Set(store.data.works.flatMap((w) => w.genres))]} /></Field>
              <Field label="First published"><input className="input" inputMode="numeric" value={work.firstPublished ?? ''} onChange={(e) => setWork({ ...work, firstPublished: parseInt(e.target.value, 10) || undefined })} /></Field>
            </div>
          </section>
        )}

        {!useExisting && (
          <section className="card form-card">
            <h3>Your edition</h3>
            <EditionFields
              value={edition}
              onChange={setEdition}
              title={attach?.work.title ?? work.title}
              authors={attach?.work.authors ?? work.authors}
            />
          </section>
        )}

        <section className="card form-card">
          <h3>Your reading</h3>
          <Segmented<Status>
            label="Pile"
            value={status}
            onChange={setStatus}
            options={[{ id: 'want', label: 'Want to read' }, { id: 'reading', label: 'Reading' }, { id: 'read', label: 'Read' }, { id: 'dnf', label: 'DNF' }]}
          />
          {(status === 'reading' || status === 'read') && (
            <div className="form-grid">
              <Field label="Started" hint="Optional"><input className="input" type="date" max={today()} value={startedOn} onChange={(e) => setStartedOn(e.target.value)} /></Field>
              {status === 'read' && <Field label="Finished"><input className="input" type="date" max={today()} min={startedOn || undefined} value={finishedOn} onChange={(e) => setFinishedOn(e.target.value)} /></Field>}
            </div>
          )}
          {dateError && <p className="err small">{dateError}</p>}
          {status === 'read' && (
            <div className="rating-row"><span className="field-label">Your rating</span><Stars value={rating} onChange={setRating} size={28} /></div>
          )}
        </section>
      </div>

      <div className="sticky-save">
        <button className="btn btn-ghost" onClick={onBack}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{attach ? 'Add edition' : 'Add to library'}</button>
      </div>
    </>
  )
}
