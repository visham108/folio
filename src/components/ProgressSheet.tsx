import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { progressInfo } from '../lib/progress'
import { mediumOf, type Read } from '../lib/types'
import { fmtDuration, parseDuration, today } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Segmented, Sheet, Stars } from './ui'

type Mode = 'amount' | 'percent'

/**
 * "I'm on page 212" or "I'm 6h 40m in", or simply "I'm 40% through", with a one-tap finish.
 * If the book has no page count (or length) yet, it's asked for once and saved to the edition,
 * so the percentage, and your stats, can be worked out from then on.
 */
export function ProgressSheet({ read, open, onClose }: { read?: Read; open: boolean; onClose: () => void }) {
  const store = useStore()
  const { editions, entries, works, logProgress, saveRead } = store
  const toast = useToast()
  const entry = read ? entries.get(read.entryId) : undefined
  const ed = editions.get(read?.editionId ?? entry?.editionId ?? '')
  const work = entry ? works.get(entry.workId) : undefined
  const info = progressInfo(read, ed)
  const audio = mediumOf(ed?.format) === 'audio'
  const knownTotal = audio ? ed?.durationMin : ed?.pages

  const [mode, setMode] = useState<Mode>('amount')
  const [amount, setAmount] = useState('') // page number, or time listened
  const [totalText, setTotalText] = useState('') // total pages, or total length
  const [pctText, setPctText] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [rating, setRating] = useState<number | undefined>()

  useEffect(() => {
    if (!open) return
    const pct = Math.round(info.pct * 100)
    setMode('amount')
    setTotalText(knownTotal ? (audio ? fmtDuration(knownTotal) : String(knownTotal)) : '')
    setAmount(info.unit === 'percent' ? '' : audio ? fmtDuration(info.value) : String(Math.round(info.value)))
    setPctText(String(pct))
    setFinishing(false)
    setRating(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, read?.id])
  if (!read || !work) return null

  const parse = (t: string) => (audio ? parseDuration(t) : t.trim() === '' ? undefined : Number(t.replace(',', '.')))
  const total = parse(totalText)
  const done = parse(amount)
  const totalOk = total != null && Number.isFinite(total) && total > 0 && total <= 20000
  const amountOk = done != null && Number.isFinite(done) && done >= 0
  const pctNum = Number(pctText.replace('%', '').replace(',', '.'))
  const pctOk = pctText.trim() !== '' && Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100
  // The fraction read, from whichever way you entered it.
  const frac = mode === 'percent' ? (pctOk ? pctNum / 100 : undefined) : amountOk && totalOk ? Math.min(1, done! / total!) : undefined
  const tooFar = mode === 'amount' && amountOk && totalOk && done! > total!

  /** Saves a new total (pages or length) to the edition, re-expressing any progress so far in it. */
  const rememberTotal = (t: number) => {
    if (!ed || knownTotal === t || !store.canEdit(ed)) return false
    // Progress so far was kept as a percentage (or in the old total): convert it first,
    // so the day's log counts only what you read now.
    const before = info.pct
    store.saveEdition(audio ? { ...ed, durationMin: Math.round(t) } : { ...ed, pages: Math.round(t) })
    saveRead({ ...read, progress: Math.round(before * t) })
    return true
  }

  const save = () => {
    if (frac == null) return
    if (frac >= 1) { setFinishing(true); return }
    let next: number
    if (mode === 'amount' && totalOk) {
      const saved = rememberTotal(total!)
      // If the length couldn't be saved (another reader's edition), keep progress as a percentage.
      next = saved || knownTotal === total ? Math.round(done!) : Math.round(frac * (knownTotal ?? 100))
    } else {
      next = Math.round(frac * (knownTotal ?? 100))
    }
    logProgress(read.id, next)
    toast(`${work.title}: ${Math.round(frac * 100)}%`)
    onClose()
  }
  const finish = () => {
    if (mode === 'amount' && totalOk) rememberTotal(total!)
    const t = (mode === 'amount' && totalOk ? total : knownTotal) ?? 100
    logProgress(read.id, Math.round(t))
    saveRead({ ...read, progress: undefined, state: 'finished', finishedOn: today(), rating })
    toast(`Finished ${work.title} 🎉`)
    onClose()
  }

  const unitWord = audio ? 'Time listened' : 'Current page'
  return (
    <Sheet open={open} onClose={onClose} title={finishing ? 'Finished — how was it?' : 'Update progress'}>
      {!finishing ? (
        <div className="prog-sheet">
          <div className="prog-title">{work.title}</div>
          <Segmented<Mode> size="sm" label="Update by" value={mode} onChange={setMode}
            options={[{ id: 'amount', label: audio ? 'Time' : 'Page' }, { id: 'percent', label: 'Percent' }]} />

          {mode === 'amount' ? (
            <div className="prog-fields">
              <label className="field">
                <span className="field-label">{unitWord}</span>
                <input className="input" autoFocus inputMode={audio ? 'text' : 'numeric'} value={amount} placeholder={audio ? 'e.g. 6h 40m' : 'e.g. 120'}
                  onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && frac != null) save() }} />
              </label>
              <span className="prog-of">of</span>
              <label className="field">
                <span className="field-label">{audio ? 'Total length' : 'Total pages'}</span>
                <input className="input" inputMode={audio ? 'text' : 'numeric'} value={totalText} placeholder={audio ? 'e.g. 11h 23m' : 'e.g. 300'}
                  onChange={(e) => setTotalText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && frac != null) save() }} />
              </label>
            </div>
          ) : (
            <div className="prog-fields">
              <label className="field">
                <span className="field-label">Percent read</span>
                <input className="input" autoFocus inputMode="decimal" value={pctText} placeholder="e.g. 40"
                  onChange={(e) => setPctText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && frac != null) save() }} />
              </label>
              <span className="prog-of">%</span>
            </div>
          )}

          {mode === 'amount' && !knownTotal && (
            <p className="muted small">This book has no {audio ? 'length' : 'page count'} yet. Enter the total once and Folio remembers it for the percentage and your stats.</p>
          )}
          {tooFar && <p className="err small">That’s past the end. Check the {audio ? 'length' : 'page count'}, or use Finished.</p>}

          <div className="prog-big" aria-live="polite">
            {frac != null ? <><b>{Math.round(frac * 100)}%</b> <span className="muted">
              {mode === 'percent' && knownTotal ? `· ${audio ? fmtDuration(Math.round(frac * knownTotal)) : `page ${Math.round(frac * knownTotal)}`} of ${audio ? fmtDuration(knownTotal) : knownTotal}` : 'through'}
            </span></> : <span className="muted">{mode === 'amount' ? `Enter where you are${knownTotal ? '' : ' and the total'}` : 'Enter a percentage'}</span>}
          </div>
          <input type="range" className="range" min={0} max={100} step={1} value={Math.round((frac ?? 0) * 100)} aria-label="Progress"
            style={{ ['--pct' as string]: `${Math.round((frac ?? 0) * 100)}%` }}
            onChange={(e) => {
              const p = +e.target.value
              setPctText(String(p))
              if (mode === 'amount' && totalOk) setAmount(audio ? fmtDuration(Math.round((p / 100) * total!)) : String(Math.round((p / 100) * total!)))
            }} />
          <div className="prog-row">
            <button className="btn btn-ghost" onClick={() => setFinishing(true)}><Check size={16} /> Finished</button>
            <button className="btn btn-primary" disabled={frac == null || tooFar} onClick={save}>Save</button>
          </div>
        </div>
      ) : (
        <div className="prog-sheet center">
          <p className="muted">Rate <b>{work.title}</b> (optional)</p>
          <Stars value={rating} onChange={setRating} size={34} />
          <div className="prog-row">
            <button className="btn btn-ghost" onClick={() => setFinishing(false)}>Back</button>
            <button className="btn btn-primary" onClick={finish}>Mark as read</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
