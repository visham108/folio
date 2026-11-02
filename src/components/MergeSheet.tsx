import { AlertTriangle, Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { titleSimilarity } from '../lib/match'
import { EDITION_FIELDS, FIELD_NAMES, fullTitle, planChain, suggestKeep, type MergeGroup, type MergeMode } from '../lib/mergePlan'
import { FORMATS, type Edition, type Work } from '../lib/types'
import { fmtDuration, plural } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Cover } from './Cover'
import { Segmented, Sheet } from './ui'

const fmtLabel = (e?: Edition) => (e ? FORMATS.find((f) => f.id === e.format)?.label ?? e.format : '')
const edName = (e: Edition) => [fmtLabel(e), e.publisher, e.publishedDate?.slice(0, 4)].filter(Boolean).join(' · ')
const lengthOf = (e: Edition) => (e.pages ? `${e.pages} pages` : e.durationMin ? fmtDuration(e.durationMin) : e.format === 'audiobook' ? 'no length' : 'no page count')

function show(field: string, v: unknown): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''
  if (field === 'durationMin') return fmtDuration(v as number)
  if (field === 'coverUrl') return 'Yes'
  if (Array.isArray(v)) return v.join(', ')
  const t = String(v)
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

/**
 * Merge two or more copies of the same book into one. You pick which copy to keep (the others
 * fold into it) and how editions combine, with a preview of exactly what the kept book ends up with.
 */
export function MergeSheet({ books, keepId: initialKeep, onClose, onMerged }: {
  /** Every copy involved, including the one to keep. `null` closes the sheet. */
  books: Work[] | null
  /** The copy to keep at first; otherwise the one on your shelves with the most details. */
  keepId?: string
  onClose: () => void
  onMerged: (kept: Work) => void
}) {
  const store = useStore()
  const toast = useToast()
  const [mode, setMode] = useState<MergeMode>('combine')
  const [keepId, setKeepId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const ids = books?.map((b) => b.id).join() ?? ''
  const editionsOf = (id: string) => store.editionsByWork.get(id) ?? []

  // Copies that aren't on your shelves: bring their editions in so the preview is complete.
  useEffect(() => {
    if (!books) return
    setMode('combine')
    setKeepId(initialKeep ?? suggestKeep(books, editionsOf, (id) => store.entryByWork.has(id))?.id)
    books.forEach((b) => store.loadWork(b.id))
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = (b: Work) => store.works.get(b.id) ?? b
  const keep = books?.find((b) => b.id === keepId)
  const live = useMemo(() => keep && books && planChain({
    keep: current(keep), dups: books.filter((b) => b.id !== keep.id).map(current), mode, editionsOf,
    myEditionOf: (id) => store.entryByWork.get(id)?.editionId,
  }), [keep, books, mode, store.works, store.editionsByWork, store.entryByWork]) // eslint-disable-line react-hooks/exhaustive-deps
  // While merging, the library reloads after each step: keep showing the preview that was confirmed.
  const frozen = useRef(live)
  if (!busy) frozen.current = live
  const chain = frozen.current

  if (!books || books.length < 2 || !keep || !chain) return <Sheet open={false} onClose={onClose}>{null}</Sheet>
  const combining = mode === 'combine'
  const dups = chain.steps.map((s) => s.dup)
  const yourAfter = chain.editions.find((e) => e.id === chain.myEditionId)
  // Picked from a list, two different books are easy to merge by mistake: say when titles don't match.
  const unlike = dups.filter((d) => titleSimilarity(fullTitle(keep), fullTitle(d)) < 0.8)

  const merge = async () => {
    setBusy(true)
    let done = 0
    try {
      for (const d of dups) {
        await store.mergeWorks(d.id, keep.id, { absorb: combining })
        done++
      }
      toast(dups.length === 1 ? `Merged into ${fullTitle(keep)}` : `Merged ${dups.length} books into ${fullTitle(keep)}`)
      onMerged(keep)
    } catch (e) {
      toast(`Merge failed${done ? ` after ${done} of ${dups.length}` : ''}: ${(e as Error).message}`, { tone: 'error' })
      if (done) onMerged(keep)
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const groupTable = (g: MergeGroup) => {
    const rows = EDITION_FIELDS.filter((f) => show(f, g.into[f]) || g.from.some((d) => show(f, d[f])))
    const fromDup = (f: (typeof EDITION_FIELDS)[number]) => g.from.map((d) => show(f, d[f])).find(Boolean) ?? ''
    return (
      <div key={g.into.id}>
        <h4 className="merge-head">{fmtLabel(g.into)}{g.into.id === chain.myEditionId ? ' · your copy' : ''}{g.from.length > 1 ? ` · ${g.from.length} copies combined into it` : ''}</h4>
        <table className="merge-table">
          <thead><tr><th>Field</th><th>Keeping</th><th>Duplicate</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((f) => {
              const filled = g.filled.includes(f)
              const lost = g.discarded.some((d) => d.field === f)
              return (
                <tr key={f} className={filled ? 'filled' : lost ? 'lost' : ''}>
                  <th scope="row">{FIELD_NAMES[f]}</th>
                  <td>{show(f, g.into[f]) || <span className="cell-empty">—</span>}</td>
                  <td>{fromDup(f) || <span className="cell-empty">—</span>}</td>
                  <td>{show(f, g.result[f]) || <span className="cell-empty">—</span>}{filled && <Check size={12} aria-label="filled in" />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {g.discarded.length > 0 && (
          <p className="muted small">Where both have a value the kept copy’s wins, so the duplicate’s {[...new Set(g.discarded.map((d) => FIELD_NAMES[d.field].toLowerCase()))].join(', ')} {g.discarded.length === 1 ? 'is' : 'are'} dropped.</p>
        )}
      </div>
    )
  }

  return (
    <Sheet open onClose={onClose} title={books.length > 2 ? `Merge ${books.length} books` : 'Merge these books'} wide footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={merge} disabled={busy}>
          {busy ? 'Merging…' : dups.length > 1 ? `Merge ${dups.length} into this one` : combining ? 'Merge and combine' : 'Merge, keep both'}
        </button>
      </>
    }>
      <div className="merge-sheet">
        <div>
          <h4 className="merge-head">Which copy to keep?</h4>
          <div className="merge-keep" role="radiogroup" aria-label="Copy to keep">
            {books.map((b) => {
              const w = current(b)
              const eds = editionsOf(b.id)
              const on = b.id === keep.id
              return (
                <button key={b.id} type="button" role="radio" aria-checked={on} className={`merge-keep-opt ${on ? 'on' : ''}`} onClick={() => setKeepId(b.id)} disabled={busy}>
                  <span className={`pick-dot ${on ? 'on' : ''}`} aria-hidden />
                  <Cover work={w} edition={eds[0]} size="xs" />
                  <span className="result-main">
                    <b>{fullTitle(w)}</b>
                    <span>{w.authors.join(', ') || 'No author'}</span>
                    <span className="muted small">
                      {[eds.length ? eds.map(lengthOf).join(', ') : 'no editions', store.entryByWork.has(b.id) && 'on your shelves'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={`pill tiny ${on ? 'merge-mine' : ''}`}>{on ? 'Keep' : 'Fold in'}</span>
                </button>
              )
            })}
          </div>
          <p className="muted small">The kept copy’s title, authors and other details stay; {dups.length === 1 ? 'the other copy folds into it and disappears' : `the other ${plural(dups.length, 'copy', 'copies')} fold into it and disappear`}.</p>
        </div>

        {unlike.length > 0 && (
          <p className="merge-warn"><AlertTriangle size={14} /> {unlike.map((d) => `“${fullTitle(d)}”`).join(', ')} {unlike.length === 1 ? 'doesn’t look like' : 'don’t look like'} the same book as “{fullTitle(keep)}”. Merge only copies of one book: different books, or different volumes of a series, should stay separate.</p>
        )}

        <Segmented<MergeMode> label="How to merge" value={mode} onChange={setMode}
          options={[{ id: 'combine', label: 'Combine into one copy' }, { id: 'both', label: 'Keep both editions' }]} />
        <p className="muted small">
          {combining
            ? <>Copies of the same format become one: the kept copy keeps its own details and takes anything it’s missing from the duplicate’s. Shelves and reads that used the duplicate’s copy move to it.</>
            : <>Every printing is listed under the kept book, each with its own details. You can switch which one is yours on the book’s page.</>}
        </p>

        {combining && chain.steps.map((s) => (
          (s.plan.groups.length > 0 || s.plan.moved.length > 0) && (
            <div key={s.dup.id} className="merge-step">
              {dups.length > 1 && <h4 className="merge-step-title">Folding in {fullTitle(s.dup)}</h4>}
              {s.plan.groups.map(groupTable)}
              {s.plan.moved.length > 0 && (
                <p className="muted small">The kept book has no {[...new Set(s.plan.moved.map((e) => fmtLabel(e).toLowerCase()))].join(' or ')} copy, so {s.plan.moved.length === 1 ? 'the duplicate’s moves' : 'those move'} across as {s.plan.moved.length === 1 ? 'its own edition' : 'their own editions'}.</p>
              )}
            </div>
          )
        ))}

        <div>
          <h4 className="merge-head">Editions afterwards</h4>
          <ul className="merge-eds">
            {chain.editions.map((e) => (
              <li key={e.id}>{edName(e)} · {lengthOf(e)}{yourAfter?.id === e.id && <span className="pill tiny merge-mine">Your edition</span>}</li>
            ))}
          </ul>
        </div>
        {yourAfter && !yourAfter.pages && !yourAfter.durationMin && chain.editions.some((e) => e.format === yourAfter.format && e.pages) && (
          <p className="merge-warn"><AlertTriangle size={14} /> Your edition has no page count, so progress and stats won’t count pages. Choose “Combine into one copy”, or switch to the edition that has one on the book’s page afterwards.</p>
        )}

        <p className="muted small">
          {chain.workFilled.length
            ? <>Book details the kept copy is missing come from the {dups.length > 1 ? 'others' : 'duplicate'}: <b>{chain.workFilled.map((f) => FIELD_NAMES[f].toLowerCase()).join(', ')}</b>. </>
            : <>The kept copy’s details (title, authors, description…) stay as they are. </>}
          Everyone’s shelf entries and reading history move across; for readers who had more than one, ratings, tags, shelves and notes are combined. This can’t be undone, but every change is recorded in the history.
        </p>
      </div>
    </Sheet>
  )
}
