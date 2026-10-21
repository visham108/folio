import { motion } from 'framer-motion'
import { Clock, Gauge, Hourglass, RotateCcw, Ruler, Share2, Star, Table2, Zap } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BarList, Columns, Heatmap, Legend, MEDIA, type ColumnDatum } from '../components/Charts'
import { Cover } from '../components/Cover'
import { AllTimePatterns, YearPatterns } from '../components/StatsPatterns'
import { Empty, Ring, Segmented } from '../components/ui'
import { GoalSheet } from '../components/GoalSheet'
import { YearCardSheet } from '../components/YearCard'
import { ReadingDiary } from '../components/ReadingDiary'
import { FillLengthsButton } from '../components/FillLengths'
import { dailyActivity, pageEquivalent, summarize, undated, yearsWithData, type Completion } from '../lib/stats'
import { goalFor, type Medium } from '../lib/types'
import { compact, fmtDate, fmtDuration, fmtNumber, monthName, plural } from '../lib/util'
import { useStore } from '../state/store'
import { useCompletions, useReadingSlices } from './hooks'

type Metric = 'books' | 'pages' | 'hours' | 'combined'

export function Stats() {
  const { year: yParam } = useParams()
  const nav = useNavigate()
  const { data } = useStore()
  const settings = data.settings
  const all = useCompletions()
  // Pages and hours fall on the days you read them, so a book spanning New Year splits across both.
  const slices = useReadingSlices()
  const years = useMemo(() => {
    const ys = yearsWithData(all)
    const cur = new Date().getFullYear()
    return ys.includes(cur) ? ys : [...ys, cur]
  }, [all])
  const allTime = yParam === 'all'
  const year = allTime ? 0 : yParam ? parseInt(yParam, 10) : new Date().getFullYear()
  const [metric, setMetric] = useState<Metric>('books')
  const [table, setTable] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)

  const sum = useMemo(() => summarize(all, year, slices), [all, year, slices])
  const heat = useMemo(() => dailyActivity(data.logs, all, year, settings), [data.logs, all, year, settings])

  const value = (c: Pick<Completion, 'pages' | 'minutes'> & { n?: number }, m: Medium): Record<Metric, number> => ({
    books: c.n ?? 1,
    pages: m === 'audio' ? 0 : c.pages,
    hours: c.minutes / 60,
    combined: pageEquivalent(c, settings),
  })

  const columns: ColumnDatum[] = useMemo(() => {
    const buckets = allTime ? years.map((y) => ({ key: String(y), label: String(y) })) : Array.from({ length: 12 }, (_, i) => ({ key: String(i), label: monthName(i) }))
    return buckets.map((b) => {
      const inBucket = (x: { year?: number; month?: number }) => (allTime ? x.year === +b.key : x.year === year && x.month === +b.key)
      const parts: Partial<Record<Medium, number>> = {}
      // Books count when finished; pages and hours when read.
      for (const c of metric === 'books' ? all.filter(inBucket) : slices.filter(inBucket)) parts[c.medium] = (parts[c.medium] ?? 0) + value(c, c.medium)[metric]
      return { key: b.key, label: b.label, parts }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, slices, year, allTime, metric, years, settings])

  const totals = useMemo(() => {
    const items = allTime ? all : sum.items
    const read = allTime ? slices : slices.filter((x) => x.year === year)
    return {
      books: items.length,
      pages: read.reduce((s, c) => s + c.pages, 0),
      minutes: read.reduce((s, c) => s + c.minutes, 0),
      combined: read.reduce((s, c) => s + pageEquivalent(c, settings), 0),
      byMedium: MEDIA.map((m) => ({ ...m, n: items.filter((c) => c.medium === m.id).length })),
      rereads: items.filter((c) => c.isReread).length,
      undated: allTime ? undated(items).length : 0,
      // Finished books whose edition has no page count (or listening time), so they add nothing to those totals.
      noLength: items.filter((c) => !c.pages && !c.minutes).length,
    }
  }, [all, slices, sum, allTime, year, settings])

  const fmt = metric === 'hours' ? (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : compact(n)) : compact
  const unit = metric === 'hours' ? 'h' : ''
  // Tables show exact figures; nothing is "–" in cells and totals alike.
  const exact = (n: number) => (n ? fmtNumber(n, metric === 'hours' ? 1 : 0) : '–')
  const charted = MEDIA.filter((m) => columns.some((c) => (c.parts[m.id] ?? 0) > 0))
  const goal = goalFor(settings, year)
  const goalPct = goal ? sum.books / goal : 0
  const isCurrent = year === new Date().getFullYear()

  if (!all.length) {
    return (
      <div className="page">
        <header className="page-head"><p className="eyebrow">Stats</p><h1 className="display">Your reading, <em>in numbers.</em></h1></header>
        <Empty title="Finish a book to see your stats">
          <p>Mark something as <b>Read</b>, or <Link className="link" to="/settings#import">import your history from another app</Link>.</p>
        </Empty>
      </div>
    )
  }

  return (
    <div className="page stats">
      <header className="page-head row">
        <div>
          <p className="eyebrow">Stats</p>
          <h1 className="display">{allTime ? <>All time, <em>all formats.</em></> : <>{year} <em>in books.</em></>}</h1>
        </div>
        {!allTime && sum.books > 0 && (
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={() => setCardOpen(true)}><Share2 size={16} /> Share your year</button>
          </div>
        )}
      </header>
      {!allTime && sum.books > 0 && <YearCardSheet sum={sum} open={cardOpen} onClose={() => setCardOpen(false)} />}

      <div className="piles" role="tablist" aria-label="Year">
        {[...years].reverse().map((y) => (
          <button key={y} role="tab" aria-selected={!allTime && y === year} className={`pile ${!allTime && y === year ? 'on' : ''}`} onClick={() => nav(`/stats/${y}`)}>
            {!allTime && y === year && <motion.span layoutId="year-pill" className="pile-pill" />}
            <span className="pile-label">{y}</span>
          </button>
        ))}
        <button role="tab" aria-selected={allTime} className={`pile ${allTime ? 'on' : ''}`} onClick={() => nav('/stats/all')}>
          {allTime && <motion.span layoutId="year-pill" className="pile-pill" />}
          <span className="pile-label">All time</span>
        </button>
      </div>

      <section className="stat-hero card">
        <div className="stat-hero-main">
          <div className="hero-num">{totals.books}</div>
          <p className="hero-sentence">
            {totals.books === 1 ? 'book' : 'books'} finished{allTime ? '' : ` in ${year}`}
            {totals.noLength === totals.books && !totals.pages && !totals.minutes ? '.' : <>: <b>{totals.pages.toLocaleString()}</b> pages read and{' '}
              <b>{Math.floor(totals.minutes / 60).toLocaleString()} hours</b> listened.</>}
            {totals.rereads > 0 && <> {totals.rereads === 1 ? 'One was a reread.' : `${totals.rereads} were rereads.`}</>}
          </p>
          {!allTime && <p className="muted tiny hero-note">Pages and hours count in the year you read them, going by your progress updates; a book counts in the year you finish it.</p>}
          <div className="split" aria-label="Books by format">
            {totals.byMedium.filter((m) => m.n).map((m) => (
              <motion.span key={m.id} className={`split-seg seg-${m.id}`} initial={{ flexGrow: 0 }} animate={{ flexGrow: m.n }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
            ))}
          </div>
          <div className="legend">
            {totals.byMedium.filter((m) => m.n).map((m) => <span key={m.id}><i className={`sw sw-${m.id}`} />{m.label} <b>{m.n}</b></span>)}
          </div>
          {totals.noLength > 0 && (
            <div className="missing-note">
              <p className="muted small">
                {totals.noLength === totals.books
                  ? `None of ${totals.books === 1 ? 'this book has' : `these ${totals.books} books have`} a page count yet, so pages and hours can’t be added up.`
                  : `${plural(totals.noLength, 'book')} ${totals.noLength === 1 ? 'has' : 'have'} no page count, so ${totals.noLength === 1 ? 'it isn’t' : 'they aren’t'} in the page totals.`}
              </p>
              <FillLengthsButton />
            </div>
          )}
          {totals.undated > 0 && (
            <p className="muted small">{plural(totals.undated, 'finished book')} {totals.undated === 1 ? 'has' : 'have'} no finish date, so {totals.undated === 1 ? 'it’s' : 'they’re'} in the totals but not the timeline.</p>
          )}
        </div>
        {!allTime && (
          <div className="stat-hero-goal">
            <button className="goal-ring-btn" onClick={() => setGoalOpen(true)} aria-label={goal ? `Goal for ${year}: ${goal} books. Change it` : `Set a goal for ${year}`}>
              <Ring pct={goalPct} size={132} stroke={10}>
                {goal ? <div className="ring-num">{sum.books}<small>/{goal}</small></div> : <div className="ring-num ring-empty">{sum.books}</div>}
              </Ring>
            </button>
            <span className="muted small">
              {!goal ? 'No goal for this year'
                : goalPct >= 1 ? 'Goal reached ✦' : isCurrent ? `${goal - sum.books} to go` : `${Math.round(goalPct * 100)}% of goal`}
            </span>
            <button className="link small" onClick={() => setGoalOpen(true)}>{goal ? 'Change goal' : 'Set a goal'}</button>
          </div>
        )}
        <div className="stat-hero-combined">
          <span className="kicker">Combined</span>
          <b>{compact(totals.combined)}</b>
          <span className="muted tiny">page-equivalents, counting an hour of listening as {settings.audioPagesPerHour} pages (<Link to="/settings" className="link">change</Link>)</span>
        </div>
      </section>
      <GoalSheet year={year} open={goalOpen} onClose={() => setGoalOpen(false)} />

      <section className="card chart-card">
        <div className="chart-head">
          <div>
            <h2>{allTime ? 'By year' : 'By month'}</h2>
            <p className="muted small">{metric === 'books' ? 'Books finished' : metric === 'pages' ? 'Pages read (print and ebook)' : metric === 'hours' ? 'Hours listened' : 'Pages plus listening converted to pages'}</p>
          </div>
          <div className="chart-controls">
            <Segmented<Metric> size="sm" label="Measure" value={metric} onChange={setMetric}
              options={[{ id: 'books', label: 'Books' }, { id: 'pages', label: 'Pages' }, { id: 'hours', label: 'Hours' }, { id: 'combined', label: 'Combined' }]} />
            <button className={`icon-btn ${table ? 'on' : ''}`} onClick={() => setTable((t) => !t)} aria-pressed={table} aria-label="Show as table"><Table2 size={16} /></button>
          </div>
        </div>
        <Legend items={charted} />
        {table ? (
          <table className="data-table">
            <thead><tr><th>{allTime ? 'Year' : 'Month'}</th>{MEDIA.map((m) => <th key={m.id}>{m.label}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.key}><td>{c.label}</td>{MEDIA.map((m) => <td key={m.id}>{exact(c.parts[m.id] ?? 0)}</td>)}<td><b>{exact(MEDIA.reduce((s, m) => s + (c.parts[m.id] ?? 0), 0))}</b></td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Total</th>{MEDIA.map((m) => <td key={m.id}><b>{exact(columns.reduce((s, c) => s + (c.parts[m.id] ?? 0), 0))}</b></td>)}
                <td><b>{exact(columns.reduce((s, c) => s + MEDIA.reduce((t, m) => t + (c.parts[m.id] ?? 0), 0), 0))}</b></td></tr>
            </tfoot>
          </table>
        ) : (
          <Columns data={columns} format={fmt} unit={unit} ariaLabel={`${metric} ${allTime ? 'per year' : `per month in ${year}`}`} />
        )}
      </section>

      {!allTime && (
        <section className="card chart-card">
          <div className="chart-head">
            <div><h2>Reading days</h2><p className="muted small">Each square is a day; darker means more pages (or listening, converted).</p></div>
          </div>
          <Heatmap year={year} values={heat} unitLabel="page-equivalents" />
        </section>
      )}

      {!allTime && sum.books > 0 && (
        <>
          <section className="highlights">
            <Highlight icon={<Ruler size={16} />} label="Longest" c={sum.longest} value={sum.longest && `${sum.longest.pages} pages`} />
            <Highlight icon={<Zap size={16} />} label="Shortest" c={sum.shortest} value={sum.shortest && `${sum.shortest.pages} pages`} />
            <Highlight icon={<Gauge size={16} />} label="Fastest" c={sum.fastest} value={sum.fastest && plural(sum.fastest.days!, 'day')} />
            <Tile icon={<Hourglass size={16} />} label="Average time per book" value={sum.avgDays ? `${Math.round(sum.avgDays)} days` : '—'} />
            <Tile icon={<Star size={16} />} label="Average rating" value={sum.avgRating ? sum.avgRating.toFixed(2) + ' ★' : '—'} />
            <Tile icon={<RotateCcw size={16} />} label="Rereads" value={String(sum.rereads)} />
            <Tile icon={<Clock size={16} />} label="Listening" value={fmtDuration(Math.round(sum.minutes))} />
          </section>

          <div className="two-col">
            <section className="card chart-card">
              <h2>Ratings</h2>
              <BarList items={[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((i) => ({ key: String(i), label: `${(i / 2).toString()} ★`, value: sum.ratingHist[i - 1] })).filter((x) => +x.key >= Math.min(...sum.ratingHist.map((v, i) => (v ? i + 1 : 99))))} />
            </section>
            <section className="card chart-card">
              <h2>Most-read authors</h2>
              {sum.topAuthors.length ? <BarList items={sum.topAuthors.map((a) => ({ key: a.name, label: a.name, value: a.count }))} format={(n) => plural(n, 'book')} /> : <p className="muted">—</p>}
            </section>
            {sum.topGenres.length > 0 && (
              <section className="card chart-card">
                <h2>Genres</h2>
                <BarList items={sum.topGenres.map((a) => ({ key: a.name, label: a.name, value: a.count }))} />
              </section>
            )}
          </div>

          <YearPatterns year={year} items={all} />

          <ReadingDiary year={year} items={sum.items} heat={heat} />

          <section className="section">
            <div className="section-head"><h2>Your {year} shelf</h2><span className="muted small">In the order you finished them</span></div>
            <div className="year-shelf">
              {sum.items.map((c, i) => (
                <motion.div key={c.read.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 30) * 0.02 }}>
                  <Link to={`/book/${c.work.id}`} title={`${c.work.title} · ${fmtDate(c.read.finishedOn)}`} aria-label={`${c.work.title}, finished ${fmtDate(c.read.finishedOn)}`}>
                    <Cover work={c.work} edition={c.edition} size="sm" />
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>
        </>
      )}
      {!allTime && sum.books === 0 && <YearPatterns year={year} items={all} />}
      {allTime && <AllTimePatterns items={all} years={years.filter((y) => all.some((c) => c.year === y))} />}
    </div>
  )
}

function Highlight({ icon, label, c, value }: { icon: ReactNode; label: string; c?: Completion; value?: string }) {
  if (!c) return <Tile icon={icon} label={label} value="—" />
  return (
    <Link to={`/book/${c.work.id}`} className="hl card">
      <Cover work={c.work} edition={c.edition} size="xs" />
      <div>
        <span className="kicker">{icon} {label}</span>
        <b className="hl-title">{c.work.title}</b>
        <span className="muted small">{value}</span>
      </div>
    </Link>
  )
}

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="hl card tile-only">
      <span className="kicker">{icon} {label}</span>
      <b className="hl-value">{value}</b>
    </div>
  )
}
