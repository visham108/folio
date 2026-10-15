import { useEffect, useState } from 'react'
import { goalFor, withGoal } from '../lib/types'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Sheet } from './ui'

/** Set, change or remove the reading goal for one year. */
export function GoalSheet({ year, open, onClose }: { year: number; open: boolean; onClose: () => void }) {
  const store = useStore()
  const toast = useToast()
  const current = goalFor(store.data.settings, year)
  const [text, setText] = useState('')
  useEffect(() => { if (open) setText(current ? String(current) : '') }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = parseInt(text, 10)
  const valid = Number.isFinite(n) && n > 0 && n < 1000
  const save = (goal: number) => {
    store.saveSettings(withGoal(store.data.settings, year, goal))
    toast(goal ? `Goal for ${year}: ${goal} books` : `Goal for ${year} removed`)
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={`Reading goal for ${year}`} footer={
      <>
        {current && <button className="btn btn-ghost danger" onClick={() => save(0)}>Remove goal</button>}
        <button className="btn btn-primary" disabled={!valid} onClick={() => save(n)}>Save</button>
      </>
    }>
      <label className="field spaced">
        <span className="field-label">Books to read in {year}</span>
        <input className="input" inputMode="numeric" autoFocus value={text} placeholder="e.g. 24"
          onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 3))}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) save(n) }} />
      </label>
      <p className="muted small">Every year starts at 12 books. Each year keeps its own goal, so changing this one doesn’t affect the others.</p>
    </Sheet>
  )
}
