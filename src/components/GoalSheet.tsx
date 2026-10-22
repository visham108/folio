import { useEffect, useState } from 'react'
import { DEFAULT_GOAL, DEFAULT_PAGE_GOAL, goalFor, pageGoalFor, withGoal, withPageGoal } from '../lib/types'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Sheet } from './ui'

/** Set, change or remove the year's two goals: books finished and pages read. Blank means no goal. */
export function GoalSheet({ year, open, onClose }: { year: number; open: boolean; onClose: () => void }) {
  const store = useStore()
  const toast = useToast()
  const s = store.data.settings
  const [books, setBooks] = useState('')
  const [pages, setPages] = useState('')
  useEffect(() => {
    if (!open) return
    setBooks(String(goalFor(s, year) ?? ''))
    setPages(String(pageGoalFor(s, year) ?? ''))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const b = books ? parseInt(books, 10) : 0
  const p = pages ? parseInt(pages, 10) : 0
  const valid = b >= 0 && b < 1000 && p >= 0 && p < 1_000_000
  const save = () => {
    store.saveSettings({ ...withGoal(s, year, b), ...withPageGoal(s, year, p) })
    toast(b || p ? `Goals for ${year}: ${[b && `${b} books`, p && `${p.toLocaleString()} pages`].filter(Boolean).join(' and ')}` : `Goals for ${year} removed`)
    onClose()
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && valid) save() }
  return (
    <Sheet open={open} onClose={onClose} title={`Reading goals for ${year}`} footer={
      <button className="btn btn-primary" disabled={!valid} onClick={save}>Save</button>
    }>
      <div className="goal-fields">
        <label className="field">
          <span className="field-label">Books to finish</span>
          <input className="input" inputMode="numeric" autoFocus value={books} placeholder="No goal"
            onChange={(e) => setBooks(e.target.value.replace(/\D/g, '').slice(0, 3))} onKeyDown={onKey} />
        </label>
        <label className="field">
          <span className="field-label">Pages to read</span>
          <input className="input" inputMode="numeric" value={pages} placeholder="No goal"
            onChange={(e) => setPages(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={onKey} />
        </label>
      </div>
      <p className="muted small">
        Every year starts at {DEFAULT_GOAL} books and {DEFAULT_PAGE_GOAL.toLocaleString()} pages; leave one blank for no goal. Pages count when you read them, and an hour of listening counts as {s.audioPagesPerHour} pages. Each year keeps its own goals.
      </p>
    </Sheet>
  )
}
