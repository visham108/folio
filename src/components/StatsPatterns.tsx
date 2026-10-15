import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { seriesSlug } from '../lib/series'
import {
  daysByGenre, finishRate, formatMixByYear, genresByYear, goalRace, lengthSpread, monthPeriods, moodProfile,
  publicationDecades, ratingVsLength, readingSpeed, seasonalRhythm, tbrWait, yearPeriods, type Completion,
} from '../lib/stats'
import { fmtDuration, plural } from '../lib/util'
import { useSeries } from '../pages/hooks'
import { useStore } from '../state/store'
import { BarList, Columns, HeatTable, Legend, LineChart, MEDIA, Scatter, SimpleColumns } from './Charts'
import { Cover } from './Cover'
import { Bar } from './ui'

const one = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n)))
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** A chart card with a table view, so every chart can be read without colour or hover. */
function ChartCard({ title, sub, children, table, legend }: {
  title: string; sub?: ReactNode; children: ReactNode; table?: ReactNode; legend?: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>
        {table && (
          <button className={`icon-btn ${asTable ? 'on' : ''}`} onClick={() => setAsTable((t) => !t)} aria-pressed={asTable} aria-label={`Show ${title} as a table`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
          </button>
        )}
      </div>
      {legend}
      {asTable && table ? table : children}
    </section>
  )
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="data-table">
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  )
}

function LengthAndDecades({ items }: { items: Completion[] }) {
  const len = useMemo(() => lengthSpread(items), [items])
  const dec = useMemo(() => publicationDecades(items), [items])
  const hasAudio = len.hours.some((h) => h.value)
  return (
    <>
      <div className="chart-pair">
        <ChartCard title="Book lengths" sub="Print and ebook, by page count"
          table={<SimpleTable head={['Pages', 'Books']} rows={len.pages.map((p) => [p.label, p.value])} />}>
          <SimpleColumns data={len.pages} ariaLabel="Books by page count" />
        </ChartCard>
        {hasAudio && (
          <ChartCard title="Audiobook lengths" sub="By listening time"
            table={<SimpleTable head={['Length', 'Books']} rows={len.hours.map((p) => [p.label, p.value])} />}>
            <SimpleColumns data={len.hours} tone="audio" ariaLabel="Audiobooks by length" />
          </ChartCard>
        )}
      </div>
      {dec.length > 0 && (
        <ChartCard title="When your books were written" sub="By decade of first publication"
          table={<SimpleTable head={['Decade', 'Books']} rows={dec.map((d) => [d.label, d.value])} />}>
          <SimpleColumns data={dec} ariaLabel="Books by decade first published" labelEvery={dec.length > 12 ? 2 : 1} />
        </ChartCard>
      )}
    </>
  )
}

function RatingScatter({ items }: { items: Completion[] }) {
  const { data } = useStore()
  const nav = useNavigate()
  const pts = useMemo(() => ratingVsLength(items, data.settings), [items, data.settings])
  if (pts.length < 3) return null
  const media = MEDIA.filter((m) => pts.some((p) => p.medium === m.id))
  return (
    <ChartCard title="Rating vs length" sub={`One dot per rated book. Length is in pages, with listening counted at ${data.settings.audioPagesPerHour} pages an hour.`}
      legend={media.length > 1 ? <Legend items={media} /> : undefined}
      table={<SimpleTable head={['Book', 'Length', 'Rating']} rows={[...pts].sort((a, b) => b.y - a.y).map((p) => [p.title, p.medium === 'audio' ? fmtDuration(p.minutes) : `${p.pages} p`, `${p.y}★`])} />}>
      <Scatter
        points={pts.map((p) => ({ ...p, detail: p.medium === 'audio' ? fmtDuration(p.minutes) : `${p.pages} pages` }))}
        xLabel="Length (page-equivalents)"
        yLabel="Your rating"
        ariaLabel="Scatter plot of your rating against book length"
        onPick={(id) => { const p = pts.find((x) => x.id === id); if (p) nav(`/book/${p.workId}`) }}
      />
    </ChartCard>
  )
}

function Finishing({ items, years }: { items: Completion[]; years: number[] }) {
  const { data } = useStore()
  const rates = useMemo(() => finishRate(data.reads, years), [data.reads, years])
  const genres = useMemo(() => daysByGenre(items), [items])
  const totals = rates.reduce((a, r) => ({ f: a.f + r.finished, d: a.d + r.dnf }), { f: 0, d: 0 })
  return (
    <div className="chart-pair">
      <ChartCard title="Finish rate" sub="Books finished vs set aside (did not finish)"
        table={years.length > 1 ? <SimpleTable head={['Year', 'Finished', 'Did not finish', 'Finish rate']} rows={rates.map((r) => [r.label, r.finished, r.dnf, r.rate == null ? '–' : `${Math.round(r.rate * 100)}%`])} /> : undefined}>
        <div className="stat-inline">
          <span><b>{totals.f + totals.d ? Math.round((totals.f / (totals.f + totals.d)) * 100) : 100}%</b>finished</span>
          <span><b>{totals.f}</b>completed</span>
          <span><b>{totals.d}</b>set aside</span>
        </div>
        {years.length > 1 && (
          <SimpleColumns data={rates.map((r) => ({ key: r.key, label: r.label, value: r.dnf }))} tone="print" height={120} ariaLabel="Books set aside per year" />
        )}
        {years.length > 1 && <p className="muted tiny">Columns show books set aside each year.</p>}
      </ChartCard>
      <ChartCard title="Days to finish, by genre" sub="Average from start to finish (genres with 2+ dated reads)">
        {genres.length ? <BarList items={genres.map((g) => ({ key: g.name, label: g.name, value: g.avg }))} format={(n) => `${Math.round(n)} days`} />
          : <p className="muted small">Add start and finish dates to your reads to see this.</p>}
      </ChartCard>
    </div>
  )
}

function Moods({ items }: { items: Completion[] }) {
  const prof = useMemo(() => moodProfile(items), [items])
  const paceTotal = prof.pace.slow + prof.pace.medium + prof.pace.fast
  if (!prof.moods.length && !paceTotal) {
    return (
      <ChartCard title="Moods and pace">
        <p className="muted small">Tag books with how they felt (on each book page, under “How it felt”) to see your reading moods here.</p>
      </ChartCard>
    )
  }
  return (
    <div className="chart-pair">
      <ChartCard title="Reading moods" sub={`Across ${plural(prof.tagged, 'book')}`}>
        <BarList items={prof.moods.slice(0, 8).map((m) => ({ key: m.name, label: cap(m.name), value: m.count }))} format={(n) => plural(n, 'book')} />
      </ChartCard>
      <ChartCard title="Pace" sub="How quickly the books moved">
        {paceTotal ? (
          <>
            <div className="pace-split" role="img" aria-label={`Slow ${prof.pace.slow}, medium ${prof.pace.medium}, fast ${prof.pace.fast}`}>
              {(['slow', 'medium', 'fast'] as const).filter((p) => prof.pace[p]).map((p) => <span key={p} className={`pace-${p}`} style={{ flexGrow: prof.pace[p] }} />)}
            </div>
            <div className="legend">
              {(['slow', 'medium', 'fast'] as const).map((p) => <span key={p}><i className={`sw pace-${p}`} />{cap(p)} <b>{prof.pace[p]}</b></span>)}
            </div>
          </>
        ) : <p className="muted small">No pace set yet.</p>}
      </ChartCard>
    </div>
  )
}

/** Extra charts for a single year. */
export function YearPatterns({ year, items }: { year: number; items: Completion[] }) {
  const { data } = useStore()
  const all = items
  const ys = useMemo(() => all.filter((c) => c.year === year), [all, year])
  const race = useMemo(() => goalRace(all, year, data.settings.yearlyGoal), [all, year, data.settings.yearlyGoal])
  const speed = useMemo(() => readingSpeed(all, data.logs, monthPeriods(year)), [all, data.logs, year])
  const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const dayLabel = (d: number) => new Date(Date.UTC(year, 0, 1 + d)).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const ahead = race.done - race.expectedNow

  return (
    <>
      <h2 className="stats-group-title">Patterns in {year}</h2>
      <p className="muted stats-group-sub">How the year unfolded, and what you reached for.</p>

      <ChartCard title="Race against your goal"
        sub={race.you.length ? `${plural(race.done, 'book')} so far; the pace line is ${data.settings.yearlyGoal} books spread evenly over the year.` : `Starts on January 1, ${year}.`}
        legend={<Legend items={[{ id: 'print', label: 'You' }, { id: 'pace', label: 'Goal pace' }]} />}
        table={<SimpleTable head={['Month', 'Books by month end', 'Goal pace']} rows={monthStarts.map((s, m) => {
          const end = (monthStarts[m + 1] ?? race.days) - 1
          const you = race.you.filter((p) => p.x <= end).at(-1)?.y
          return [dayLabel(s).split(' ')[0], you ?? '–', one((data.settings.yearlyGoal * (end + 1)) / race.days)]
        })} />}>
        {race.you.length > 0 && Math.abs(ahead) >= 0.5 && (
          <div className="stat-inline"><span><b>{one(Math.abs(ahead))}</b>{ahead > 0 ? 'books ahead of pace' : 'books behind pace'}</span></div>
        )}
        <LineChart
          ariaLabel={`Books finished through ${year} compared with goal pace`}
          xMax={race.days - 1}
          xLabel={dayLabel}
          ticks={[0, 90, 181, 273, race.days - 1]}
          format={one}
          series={[
            { id: 'pace', label: 'Goal pace', color: 'var(--muted)', points: race.pace, reference: true },
            { id: 'you', label: 'You', color: 'var(--c-print)', points: race.you },
          ]}
        />
      </ChartCard>

      <div className="chart-pair">
        <ChartCard title="Pages per day" sub="Average for each month"
          table={<SimpleTable head={['Month', 'Pages per day']} rows={speed.map((s) => [s.label, one(s.pagesPerDay)])} />}>
          <SimpleColumns data={speed.map((s) => ({ key: s.key, label: s.label, value: s.pagesPerDay }))} format={one} height={150} ariaLabel="Pages per day by month" />
        </ChartCard>
        <ChartCard title="Listening per week" sub="Average hours for each month"
          table={<SimpleTable head={['Month', 'Hours per week']} rows={speed.map((s) => [s.label, one(s.hoursPerWeek)])} />}>
          <SimpleColumns data={speed.map((s) => ({ key: s.key, label: s.label, value: s.hoursPerWeek }))} tone="audio" format={one} unit="h" height={150} ariaLabel="Listening hours per week by month" />
        </ChartCard>
      </div>

      {ys.length > 0 && (
        <>
          <LengthAndDecades items={ys} />
          <RatingScatter items={ys} />
          <Finishing items={ys} years={[year]} />
          <Moods items={ys} />
        </>
      )}
    </>
  )
}

/** Extra charts across all years. */
export function AllTimePatterns({ items, years }: { items: Completion[]; years: number[] }) {
  const { data, readsByEntry, works } = useStore()
  const mix = useMemo(() => formatMixByYear(items, years), [items, years])
  const speed = useMemo(() => readingSpeed(items, data.logs, yearPeriods(years)), [items, data.logs, years])
  const genres = useMemo(() => genresByYear(items, years), [items, years])
  const season = useMemo(() => seasonalRhythm(items), [items])
  const wait = useMemo(() => tbrWait(data.entries, readsByEntry, works), [data.entries, readsByEntry, works])
  const { series } = useSeries()
  const started = series.filter((s) => s.read > 0 || s.books.some((b) => b.state === 'reading'))

  return (
    <>
      <h2 className="stats-group-title">Patterns over the years</h2>
      <p className="muted stats-group-sub">How your reading has changed, and the habits underneath it.</p>

      {years.length > 1 && (
        <ChartCard title="Format mix by year" sub="Share of books finished in each format"
          legend={<Legend items={MEDIA} />}
          table={<SimpleTable head={['Year', 'Print', 'Audio', 'Ebook', 'Books']} rows={mix.map((m) => [m.label, `${Math.round(m.parts.print)}%`, `${Math.round(m.parts.audio)}%`, `${Math.round(m.parts.ebook)}%`, m.total])} />}>
          <Columns data={mix.map((m) => ({ key: m.key, label: m.label, parts: m.parts }))} format={(n) => `${Math.round(n)}%`} showPeak={false} ariaLabel="Share of books by format for each year" />
        </ChartCard>
      )}

      <div className="chart-pair">
        <ChartCard title="Pages per day" sub="Average for each year"
          table={<SimpleTable head={['Year', 'Pages per day']} rows={speed.map((s) => [s.label, one(s.pagesPerDay)])} />}>
          <SimpleColumns data={speed.map((s) => ({ key: s.key, label: s.label, value: s.pagesPerDay }))} format={one} height={150} ariaLabel="Pages per day by year" />
        </ChartCard>
        <ChartCard title="Listening per week" sub="Average hours for each year"
          table={<SimpleTable head={['Year', 'Hours per week']} rows={speed.map((s) => [s.label, one(s.hoursPerWeek)])} />}>
          <SimpleColumns data={speed.map((s) => ({ key: s.key, label: s.label, value: s.hoursPerWeek }))} tone="audio" format={one} unit="h" height={150} ariaLabel="Listening hours per week by year" />
        </ChartCard>
      </div>

      {genres.genres.length > 0 && years.length > 1 && (
        <ChartCard title="Genres over the years" sub="Your six most-read genres; darker means more books">
          <HeatTable rows={genres.genres} cols={genres.years.map(String)} cells={genres.cells} max={genres.max} ariaLabel="Books per genre per year" />
        </ChartCard>
      )}

      <ChartCard title="Seasonal rhythm" sub={`Average books finished in each month${years.length > 1 ? `, across ${years.length} years` : ''}`}
        table={<SimpleTable head={['Month', 'Average books']} rows={season.map((s) => [s.label, one(s.value)])} />}>
        <SimpleColumns data={season} format={one} height={150} ariaLabel="Average books finished per calendar month" />
      </ChartCard>

      <LengthAndDecades items={items} />
      <RatingScatter items={items} />
      <Finishing items={items} years={years} />

      <div className="chart-pair">
        <ChartCard title="Time on your want-to-read list" sub={wait.median != null ? `Half your books are started within ${Math.round(wait.median)} days of being added` : 'From adding a book to starting it'}
          table={<SimpleTable head={['Waited', 'Books']} rows={wait.buckets.map((b) => [b.label, b.value])} />}>
          <BarList items={wait.buckets.map((b) => ({ key: b.key, label: b.label, value: b.value }))} format={(n) => plural(n, 'book')} />
          {wait.waiting.length > 0 && (
            <>
              <p className="muted small" style={{ marginTop: 16 }}>Waiting longest ({wait.waitingCount} on the list)</p>
              <ul className="waiting-list">
                {wait.waiting.map((w) => (
                  <li key={w.entry.id}>
                    <Link to={`/book/${w.work!.id}`}>
                      <Cover work={w.work!} size="xs" />
                      <span><b>{w.work!.title}</b><span className="muted small"> · {w.days > 365 ? `${one(w.days / 365)} years` : plural(w.days, 'day')}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </ChartCard>
        <ChartCard title="Series progress" sub={started.length ? `${plural(started.length, 'series', 'series')} under way` : undefined}>
          {started.length ? (
            <ul className="series-stats">
              {started.slice(0, 8).map((s) => (
                <li key={s.name}>
                  <Link to={`/series/${seriesSlug(s.name)}`}>
                    <b>{s.name}</b>
                    <span className="muted small">{s.read} of {s.books.length}</span>
                    <Bar pct={s.books.length ? s.read / s.books.length : 0} label={`${s.name} progress`} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">Set a series and number on a book (Edit book details) to track series here.</p>}
        </ChartCard>
      </div>

      <Moods items={items} />
    </>
  )
}
