import { useMemo } from 'react'
import { completions, type Completion } from '../lib/stats'
import { useStore } from '../state/store'

export function useCompletions(includeDnf = false): Completion[] {
  const { data, works, editions, entries } = useStore()
  return useMemo(
    () => completions(data.reads, { works, editions, entries }, { includeDnf }),
    [data.reads, works, editions, entries, includeDnf],
  )
}

export function useYearProgress() {
  const { data } = useStore()
  const all = useCompletions()
  const year = new Date().getFullYear()
  const done = all.filter((c) => c.year === year).length
  const goal = data.settings.yearlyGoal || 1
  const dayOfYear = (Date.now() - Date.UTC(year, 0, 1)) / 86400000
  const expected = (goal * dayOfYear) / 365
  return { year, done, goal, pct: done / goal, ahead: Math.round(done - expected) }
}
