import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { progressInfo } from '../lib/progress'
import type { Read } from '../lib/types'
import { fmtDuration, parseDuration, today } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Sheet, Stars } from './ui'

/** Quick "I'm on page 212" / "I'm 6h 40m in" update, with a one-tap finish. */
export function ProgressSheet({ read, open, onClose }: { read?: Read; open: boolean; onClose: () => void }) {
  const { editions, entries, works, logProgress, saveRead } = useStore()
  const toast = useToast()
  const entry = read ? entries.get(read.entryId) : undefined
  const ed = editions.get(read?.editionId ?? entry?.editionId ?? '')
  const work = entry ? works.get(entry.workId) : undefined
  const info = progressInfo(read, ed)
  const [val, setVal] = useState(info.value)
  const [text, setText] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [rating, setRating] = useState<number | undefined>()
  useEffect(() => {
    if (open) {
      setVal(info.value)
      setText(info.unit === 'minutes' ? fmtDuration(info.value) : String(Math.round(info.value)))
      setFinishing(false)
      setRating(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, read?.id])
  if (!read || !work) return null

  const commitText = (t: string) => {
    const n = info.unit === 'minutes' ? parseDuration(t) : parseFloat(t)
    if (n != null && Number.isFinite(n)) setVal(Math.max(0, Math.min(info.total, n)))
  }
  const save = () => {
    if (val >= info.total) { setFinishing(true); return }
    logProgress(read.id, val)
    toast(`${work.title}: ${progressInfo({ ...read, progress: val }, ed).label}`)
    onClose()
  }
  const finish = () => {
    if (val !== info.value) logProgress(read.id, info.total)
    saveRead({ ...read, progress: undefined, state: 'finished', finishedOn: today(), rating })
    toast(`Finished ${work.title} 🎉`)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={finishing ? 'Finished — how was it?' : 'Update progress'}>
      {!finishing ? (
        <div className="prog-sheet">
          <div className="prog-title">{work.title}</div>
          <div className="prog-big">
            {info.unit === 'pages' && <>page <b>{Math.round(val)}</b> <span className="muted">of {info.total}</span></>}
            {info.unit === 'minutes' && <><b>{fmtDuration(val)}</b> <span className="muted">of {fmtDuration(info.total)}</span></>}
            {info.unit === 'percent' && <><b>{Math.round(val)}%</b></>}
          </div>
          <input
            type="range"
            className="range"
            min={0}
            max={info.total}
            step={info.unit === 'minutes' ? 5 : 1}
            value={val}
            onChange={(e) => { setVal(+e.target.value); setText(info.unit === 'minutes' ? fmtDuration(+e.target.value) : e.target.value) }}
            style={{ ['--pct' as string]: `${(val / info.total) * 100}%` }}
            aria-label="Progress"
          />
          <div className="prog-row">
            <input
              className="input"
              inputMode={info.unit === 'minutes' ? 'text' : 'numeric'}
              value={text}
              onChange={(e) => { setText(e.target.value); commitText(e.target.value) }}
              placeholder={info.unit === 'minutes' ? '6h 40m' : info.unit === 'pages' ? 'Page' : '%'}
              aria-label={info.unit === 'minutes' ? 'Time listened' : info.unit === 'pages' ? 'Current page' : 'Percent'}
            />
            <button className="btn btn-ghost" onClick={() => setFinishing(true)}><Check size={16} /> Finished</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
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
