import { AlertTriangle, ArrowRight, Check, FileUp, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildImport, collectKeys, detectSource, FIELDS, guessColumns, guessValues, parseTable,
  type ColumnGuess, type FieldId, type ValueMaps,
} from '../lib/importer'
import { FORMATS, STATUSES, type Format, type Snapshot, type Status } from '../lib/types'
import { fmtDate, plural } from '../lib/util'
import { useStore } from '../state/store'
import { useFillLengths } from './FillLengths'
import { useToast } from '../state/toast'
import { Sheet, Stars } from './ui'

interface Loaded {
  name: string
  source: string
  headers: string[]
  rows: string[][]
}

/**
 * Import from any reading app's CSV export. Folio proposes how each column and
 * value maps; the person can correct anything before a single book is added.
 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<Loaded | null>(null)
  const [cols, setCols] = useState<ColumnGuess[]>([])
  const [values, setValues] = useState<ValueMaps | null>(null)
  // After an import, look up page counts for the new books that came without one.
  const fill = useFillLengths()
  const [autoFill, setAutoFill] = useState(false)
  useEffect(() => {
    if (!autoFill) return
    setAutoFill(false)
    if (fill.missing.length) void fill.run()
  }, [autoFill, fill.missing]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  // Books other readers already added: matched instead of duplicated.
  const [catalogue, setCatalogue] = useState<Pick<Snapshot, 'works' | 'editions'> | null>(null)

  const reset = () => { setFile(null); setCols([]); setValues(null); setError(null) }
  const close = () => { reset(); onClose() }

  const load = async (f: File) => {
    setError(null)
    if (f.size > 20 * 1024 * 1024) { setError('That file is over 20 MB. Export a smaller range, or split it.'); return }
    const text = await f.text()
    const { headers, rows } = parseTable(text)
    if (headers.length < 2 || !rows.length) { setError('Couldn’t find a table in that file. Choose a CSV export with a header row.'); return }
    const guesses = guessColumns(headers, rows)
    setFile({ name: f.name, source: detectSource(headers), headers, rows })
    setCols(guesses)
    setValues(guessValues(rows, guesses))
  }

  const setField = (index: number, field: FieldId) => {
    const next = cols.map((c) => {
      if (c.index === index) return { ...c, field, confidence: 'high' as const }
      // Single-value fields can only come from one column.
      const multi = FIELDS.find((f) => f.id === field)?.multi
      if (!multi && field !== 'ignore' && c.field === field) return { ...c, field: 'ignore' as FieldId }
      return c
    })
    setCols(next)
    if (file) {
      const fresh = guessValues(file.rows, next)
      // Keep any value choices the person already made.
      setValues((v) => v && { ...fresh, status: { ...fresh.status, ...pick(v.status, fresh.status) }, format: { ...fresh.format, ...pick(v.format, fresh.format) } })
    }
  }

  // Look up the shared catalogue for every title and ISBN in the file (again if the mapping changes).
  const keyCols = cols.filter((c) => ['title', 'isbn', 'isbn13', 'isbn10'].includes(c.field)).map((c) => `${c.index}:${c.field}`).join(',')
  useEffect(() => {
    if (!file || !store.backend || store.backend.kind === 'local') { setCatalogue({ works: [], editions: [] }); return }
    let live = true
    setCatalogue(null)
    store.backend.catalogueFor(collectKeys(file.rows, cols))
      .then((c) => live && setCatalogue(c))
      .catch(() => live && setCatalogue({ works: [], editions: [] }))
    return () => { live = false }
  }, [file, keyCols]) // eslint-disable-line react-hooks/exhaustive-deps

  const existing = useMemo(() => {
    if (!catalogue) return store.data
    const haveW = new Set(store.data.works.map((w) => w.id))
    const haveE = new Set(store.data.editions.map((e) => e.id))
    return {
      ...store.data,
      works: [...store.data.works, ...catalogue.works.filter((w) => !haveW.has(w.id))],
      editions: [...store.data.editions, ...catalogue.editions.filter((e) => !haveE.has(e.id))],
    }
  }, [store.data, catalogue])

  // The live preview reads a sample; the full file is processed on import.
  const SAMPLE = 150
  const plan = useMemo(
    () => (file && values ? buildImport(file.rows, cols, values, existing, { limit: SAMPLE }) : null),
    [file, cols, values, existing],
  )
  const sampled = (file?.rows.length ?? 0) > SAMPLE
  const hasTitle = cols.some((c) => c.field === 'title')

  const run = async () => {
    if (!file || !values) return
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30)) // let the spinner paint
    try {
      const full = buildImport(file.rows, cols, values, existing)
      await store.importData(full.data)
      toast(`Imported ${plural(full.data.entries.length, 'book')} from ${file.source}${full.skipped ? ` (${full.skipped} were already on your shelves)` : ''}`)
      setAutoFill(true)
      close()
    } catch (e) {
      setError('The import stopped part-way: ' + (e as Error).message + '. Books already saved will be matched, not duplicated, if you run it again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={close} title={file ? `Import from ${file.source}` : 'Import your books'} wide footer={file && (
      <>
        <button className="btn btn-ghost" onClick={reset}>Choose another file</button>
        <button className="btn btn-primary" disabled={!hasTitle || !plan?.data.entries.length || busy || !catalogue} onClick={run}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {busy ? 'Importing…' : !catalogue ? 'Checking the catalogue…' : plan ? `Import ${sampled ? plural(file.rows.length, 'row') : plural(plan.data.entries.length, 'book')}` : 'Import'}
        </button>
      </>
    )}>
      {!file ? (
        <div
          className={`dropzone ${drag ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) load(f) }}
        >
          <FileUp size={28} />
          <b>Drop a CSV export here</b>
          <p className="muted small">Goodreads, StoryGraph, LibraryThing, Hardcover, a spreadsheet of your own… Folio works out which column is which and you can check it before anything is added.</p>
          <button className="btn btn-primary" onClick={() => input.current?.click()}>Choose a file</button>
          <details className="howto">
            <summary>Where do I find my export?</summary>
            <ul>
              <li><b>Goodreads:</b> My Books → Import and export → Export library.</li>
              <li><b>StoryGraph:</b> Your profile → Manage account → Export StoryGraph library.</li>
              <li><b>LibraryThing:</b> More → Import/Export → Export to CSV.</li>
              <li><b>A spreadsheet:</b> File → Download → Comma-separated values (.csv).</li>
            </ul>
          </details>
          {error && <p className="err small"><AlertTriangle size={14} /> {error}</p>}
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = '' }} />
        </div>
      ) : (
        <div className="import">
          <p className="muted">
            <b>{file.name}</b> · {plural(file.rows.length, 'row')}. Check the columns below; anything marked “Don’t import” is left out.
          </p>

          <section>
            <h3>Columns</h3>
            <div className="map-table" role="table">
              {cols.map((c) => (
                <div key={c.index} className={`map-row ${c.field === 'ignore' ? 'off' : ''}`} role="row">
                  <div className="map-src" role="cell">
                    <b>{c.header || `Column ${c.index + 1}`}</b>
                    <span className="muted tiny">{c.samples.join(' · ') || 'empty'}</span>
                  </div>
                  <ArrowRight size={14} className="muted map-arrow" aria-hidden />
                  <div role="cell" className="map-dst">
                    <select className="select" value={c.field} onChange={(e) => setField(c.index, e.target.value as FieldId)} aria-label={`Folio field for ${c.header}`}>
                      {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                    {c.field !== 'ignore' && c.confidence !== 'high' && <span className="pill tiny" title="Folio guessed this from the values">Guess</span>}
                  </div>
                </div>
              ))}
            </div>
            {!hasTitle && <p className="err small"><AlertTriangle size={14} /> Choose which column holds the book title.</p>}
          </section>

          {values && Object.keys(values.status).length > 0 && (
            <section>
              <h3>Statuses</h3>
              <div className="value-map">
                {Object.entries(values.status).map(([raw, st]) => (
                  <label key={raw} className="value-row">
                    <span className="pill">{raw}</span>
                    <ArrowRight size={14} className="muted" aria-hidden />
                    <select className="select" value={st} onChange={(e) => setValues({ ...values, status: { ...values.status, [raw]: e.target.value as Status } })}>
                      {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          {values && Object.keys(values.format).length > 0 && (
            <section>
              <h3>Formats</h3>
              <div className="value-map">
                {Object.entries(values.format).map(([raw, f]) => (
                  <label key={raw} className="value-row">
                    <span className="pill">{raw}</span>
                    <ArrowRight size={14} className="muted" aria-hidden />
                    <select className="select" value={f} onChange={(e) => setValues({ ...values, format: { ...values.format, [raw]: e.target.value as Format } })}>
                      {FORMATS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          {values && (
            <section className="value-opts">
              {cols.some((c) => c.field === 'rating') && (
                <label className="value-row">
                  <span>Ratings are out of</span>
                  <select className="select" value={values.ratingDivisor} onChange={(e) => setValues({ ...values, ratingDivisor: +e.target.value })}>
                    <option value={1}>5 stars</option>
                    <option value={2}>10</option>
                    <option value={20}>100</option>
                  </select>
                </label>
              )}
              {cols.some((c) => ['dateAdded', 'dateStarted', 'dateFinished', 'datesRead'].includes(c.field)) && (
                <label className="value-row">
                  <span>Dates are written</span>
                  <select className="select" value={values.dateOrder} onChange={(e) => setValues({ ...values, dateOrder: e.target.value as ValueMaps['dateOrder'] })}>
                    <option value="ymd">Year first (2024-03-14)</option>
                    <option value="dmy">Day first (14/03/2024)</option>
                    <option value="mdy">Month first (03/14/2024)</option>
                  </select>
                </label>
              )}
            </section>
          )}

          {plan && (
            <section>
              <h3>Preview</h3>
              <ul className="import-preview">
                {plan.preview.map((p, i) => (
                  <li key={i}>
                    <div><b>{p.title}</b><span className="muted"> · {p.authors.join(', ')}</span></div>
                    <div className="muted small">
                      {STATUSES.find((s) => s.id === p.status)?.label} · {FORMATS.find((f) => f.id === p.format)?.label}
                      {p.finished && ` · finished ${fmtDate(p.finished)}`}
                      {p.reads > 1 && ` · read ${p.reads}×`}
                    </div>
                    {p.rating ? <Stars value={p.rating} size={12} /> : null}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                {sampled && `In the first ${SAMPLE} rows: `}{plural(plan.added, 'new book')} for the catalogue, {plan.matched} matched to books already in Folio
                {plan.skipped ? `, ${plan.skipped} already on your shelves (left as they are)` : ''}.
                {(() => {
                  // Rows for a book that appeared earlier in the file are its rereads.
                  const rows = sampled ? Math.min(SAMPLE, file.rows.length) : file.rows.length
                  const rereads = rows - plan.problems.length - plan.data.entries.length - plan.skipped
                  return rereads > 0 ? ` ${plural(rereads, 'row')} ${rereads === 1 ? 'is a reread' : 'are rereads'} of a book listed above, so ${rereads === 1 ? 'it’s' : 'they’re'} added as extra reads.` : ''
                })()}
              </p>
              {plan.problems.length > 0 && (
                <details className="howto">
                  <summary className="err">{plural(plan.problems.length, 'row')} can’t be imported</summary>
                  <ul>{plan.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul>
                </details>
              )}
            </section>
          )}
          {error && <p className="err small"><AlertTriangle size={14} /> {error}</p>}
        </div>
      )}
    </Sheet>
  )
}

function pick<T>(prev: Record<string, T>, fresh: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(prev).filter(([k]) => k in fresh))
}
