import { useEffect, useMemo, useState } from 'react'
import { buildSeries, type Series } from '../lib/series'
import { goalFor, pageGoalFor, type Work } from '../lib/types'
import { completions, readingSlices, type Completion, goalPace, pageEquivalent, type Slice } from '../lib/stats'
import { useStore } from '../state/store'

export function useCompletions(includeDnf = false): Completion[] {
  const { data, works, editions, entries } = useStore()
  return useMemo(
    () => completions(data.reads, { works, editions, entries }, { includeDnf }),
    [data.reads, works, editions, entries, includeDnf],
  )
}

/** Pages and listening time on the days you read them (see readingSlices). */
export function useReadingSlices(): Slice[] {
  const { data, works, editions, entries } = useStore()
  return useMemo(
    () => readingSlices(data.reads, data.logs, { works, editions, entries }),
    [data.reads, data.logs, works, editions, entries],
  )
}

export function useYearProgress() {
  const { data } = useStore()
  const all = useCompletions()
  const year = new Date().getFullYear()
  const done = all.filter((c) => c.year === year).length
  const goal = goalFor(data.settings, year) ?? 0
  // Same pace sum as Stats, so both screens say the same thing.
  const pace = goalPace(done, goal, year)
  const pages = usePageGoal(year)
  return { year, done, goal, pct: goal ? done / goal : 0, ahead: pace.ahead, paceText: goal ? pace.text : 'No goal set for this year', pages }
}

/** Pages read in a year (listening converted at your rate) against that year's page goal. */
export function usePageGoal(year: number) {
  const { data } = useStore()
  const slices = useReadingSlices()
  const done = useMemo(() => Math.round(slices.filter((s) => s.year === year).reduce((n, s) => n + pageEquivalent(s, data.settings), 0)),
    [slices, year, data.settings])
  const goal = pageGoalFor(data.settings, year) ?? 0
  const pace = goalPace(done, goal, year, new Date(), 'page')
  return { done, goal, pct: goal ? done / goal : 0, ahead: pace.ahead, paceText: goal ? pace.text : 'No page goal for this year' }
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
