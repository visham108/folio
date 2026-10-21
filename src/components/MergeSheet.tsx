import { AlertTriangle, Check } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EDITION_FIELDS, FIELD_NAMES, fullTitle, planMerge, type MergeMode } from '../lib/mergePlan'
import { FORMATS, type Edition, type Work } from '../lib/types'
import { fmtDuration } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Segmented, Sheet } from './ui'

const fmtLabel = (e?: Edition) => (e ? FORMATS.find((f) => f.id === e.format)?.label ?? e.format : '')
const edName = (e: Edition) => [fmtLabel(e), e.publisher, e.publishedDate?.slice(0, 4)].filter(Boolean).join(' · ')

function show(field: string, v: unknown): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''
  if (field === 'durationMin') return fmtDuration(v as number)
  if (field === 'coverUrl') return 'Yes'
  if (Array.isArray(v)) return v.join(', ')
  const t = String(v)
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

/** Choose how to merge a duplicate, with a preview of exactly what the kept book ends up with. */
export function MergeSheet({ dup, dupEditions, target, onClose, onMerged }: {
  dup: Work; dupEditions: Edition[]; target: Work | null; onClose: () => void; onMerged: (t: Work) => void
}) {
  const store = useStore()
  const toast = useToast()
  const [mode, setMode] = useState<MergeMode>('combine')
  const [busy, setBusy] = useState(false)
  // The kept book may not be on your shelves: bring its editions in so the preview is complete.
  useEffect(() => { if (target) { setMode('combine'); store.loadWork(target.id) } }, [target?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const keepEditions = target ? store.editionsByWork.get(target.id) ?? [] : []
  const plan = useMemo(() => target && planMerge({
    dup, keep: store.works.get(target.id) ?? target, dupEditions, keepEditions,
    myKeepEditionId: store.entryByWork.get(target.id)?.editionId, myDupEditionId: store.entryByWork.get(dup.id)?.editionId,
  }), [target, dup, dupEditions, keepEditions, store.works, store.entryByWork]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!target || !plan) return <Sheet open={false} onClose={onClose}>{null}</Sheet>
  const combining = mode === 'combine'
  const mine = store.entryByWork.get(target.id) ?? store.entryByWork.get(dup.id)
  const myId = mine?.editionId && (combining ? plan.target.get(mine.editionId) ?? mine.editionId : mine.editionId)
  const afterEds = combining
    ? [...keepEditions, ...plan.moved].map((e) => plan.groups.find((g) => g.into.id === e.id)?.result ?? e)
    : [...keepEditions, ...dupEditions]
  const yourAfter = afterEds.find((e) => e.id === myId)
  const lengthOf = (e: Edition) => (e.pages ? `${e.pages} pages` : e.durationMin ? fmtDuration(e.durationMin) : e.format === 'audiobook' ? 'no length' : 'no page count')

  const merge = async () => {
    setBusy(true)
    try {
      await store.mergeWorks(dup.id, target.id, { absorb: combining })
      toast(`Merged into ${fullTitle(target)}`)
      onMerged(target)
    } catch (e) {
      toast('Merge failed: ' + (e as Error).message, { tone: 'error' })
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <Sheet open onClose={onClose} title="Merge these books" wide footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={merge} disabled={busy}>{combining ? 'Merge and combine' : 'Merge, keep both'}</button>
      </>
    }>
      <div className="merge-sheet">
        <p><b>{fullTitle(dup)}</b> will be folded into <b>{fullTitle(target)}</b> by {target.authors.join(', ')}.</p>

        <Segmented<MergeMode> label="How to merge" value={mode} onChange={setMode}
          options={[{ id: 'combine', label: 'Combine into one copy' }, { id: 'both', label: 'Keep both editions' }]} />
        <p className="muted small">
          {combining
            ? <>Copies of the same format become one: the kept copy keeps its own details and takes anything it’s missing from the duplicate’s. Shelves and reads that used the duplicate’s copy move to it.</>
            : <>Every printing is listed under the kept book, each with its own details. You can switch which one is yours on the book’s page.</>}
        </p>

        {combining && plan.groups.map((g) => {
          const rows = EDITION_FIELDS.filter((f) => show(f, g.into[f]) || g.from.some((d) => show(f, d[f])))
          const fromDup = (f: (typeof EDITION_FIELDS)[number]) => g.from.map((d) => show(f, d[f])).find(Boolean) ?? ''
          return (
            <div key={g.into.id}>
              <h4 className="merge-head">{fmtLabel(g.into)}{g.into.id === myId ? ' · your copy' : ''}{g.from.length > 1 ? ` · ${g.from.length} copies combined into it` : ''}</h4>
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
        })}
        {combining && plan.moved.length > 0 && (
          <p className="muted small">The kept book has no {[...new Set(plan.moved.map((e) => fmtLabel(e).toLowerCase()))].join(' or ')} copy, so {plan.moved.length === 1 ? 'the duplicate’s moves' : 'those move'} across as {plan.moved.length === 1 ? 'its own edition' : 'their own editions'}.</p>
        )}

        <div>
          <h4 className="merge-head">Editions afterwards</h4>
          <ul className="merge-eds">
            {afterEds.map((e) => (
              <li key={e.id}>{edName(e)} · {lengthOf(e)}{yourAfter?.id === e.id && <span className="pill tiny merge-mine">Your edition</span>}</li>
            ))}
          </ul>
        </div>
        {yourAfter && !yourAfter.pages && !yourAfter.durationMin && afterEds.some((e) => e.format === yourAfter.format && e.pages) && (
          <p className="merge-warn"><AlertTriangle size={14} /> Your edition has no page count, so progress and stats won’t count pages. Choose “Combine into one copy”, or switch to the edition that has one on the book’s page afterwards.</p>
        )}

        <p className="muted small">
          {plan.workFilled.length
            ? <>Book details the kept book is missing come from the duplicate: <b>{plan.workFilled.map((f) => FIELD_NAMES[f].toLowerCase()).join(', ')}</b>. </>
            : <>The kept book’s details (title, authors, description…) stay as they are. </>}
          Everyone’s shelf entries and reading history move across; for readers who had both, ratings, tags, shelves and notes are combined. This can’t be undone, but every change is recorded in the history.
        </p>
      </div>
    </Sheet>
  )
}
