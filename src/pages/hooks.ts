import { useEffect, useMemo, useState } from 'react'
import { buildSeries, type Series } from '../lib/series'
import type { Work } from '../lib/types'
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

// ── Series ────────────────────────────────────────────────────────────────────

let seriesCache: { key: string; works: Work[] } | null = null

/** Your series, filled out with the other volumes other readers have added to the catalogue. */
export function useSeries(): { series: Series[]; loading: boolean } {
  const { data, entryByWork, readsByEntry, backend } = useStore()
  const names = useMemo(() => [...new Set(data.works.map((w) => w.series?.trim()).filter((s): s is string => !!s))].sort(), [data.works])
  const key = names.join('|')
  const [extra, setExtra] = useState<Work[]>(seriesCache?.key === key ? seriesCache.works : [])
  const [loading, setLoading] = useState(seriesCache?.key !== key && names.length > 0)
  useEffect(() => {
    if (!names.length || !backend || seriesCache?.key === key) { setLoading(false); return }
    let live = true
    setLoading(true)
    backend.seriesWorks(names)
      .then((r) => { seriesCache = { key, works: r.works }; if (live) setExtra(r.works) })
      .catch(() => {})
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [key, backend]) // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => {
    const mine = new Set(data.works.map((w) => w.id))
    return buildSeries([...data.works, ...extra.filter((w) => !mine.has(w.id))], entryByWork, readsByEntry)
  }, [data.works, extra, entryByWork, readsByEntry])
  return { series, loading }
}
