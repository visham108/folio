import { motion } from 'framer-motion'
import { ArrowRight, Flame, Headphones, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookTile } from '../components/BookTile'
import { Cover } from '../components/Cover'
import { Notices } from '../components/Notices'
import { GoalSheet } from '../components/GoalSheet'
import { ProgressSheet } from '../components/ProgressSheet'
import { Bar, Empty, Ring, Stars } from '../components/ui'
import { progressInfo } from '../lib/progress'
import { pageEquivalent, streak, summarize } from '../lib/stats'
import type { Read } from '../lib/types'
import { compact, fmtDate, plural } from '../lib/util'
import { useStore } from '../state/store'
import { useCompletions, useSeries, useYearProgress } from './hooks'
import { seriesSlug } from '../lib/series'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Home() {
  const store = useStore()
  const { data, works, editions } = store
  const nav = useNavigate()
  const [goalOpen, setGoalOpen] = useState(false)
  const yp = useYearProgress()
  const comps = useCompletions()
  const [sheetRead, setSheetRead] = useState<Read>()
  const { series } = useSeries()
  const nextInSeries = series.filter((x) => x.next).slice(0, 6)
  const year = new Date().getFullYear()
  const sum = useMemo(() => summarize(comps, year), [comps, year])
  const st = useMemo(() => streak(data.logs), [data.logs])

  const current = data.entries
    .filter((e) => e.status === 'reading')
    .map((e) => ({ entry: e, read: store.activeRead(e.id) }))
    .sort((a, b) => (b.entry.updatedAt ?? '').localeCompare(a.entry.updatedAt ?? ''))
  const upNext = data.entries.filter((e) => e.status === 'want').sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 8)
  const recent = [...comps].sort((a, b) => (b.read.finishedOn ?? '').localeCompare(a.read.finishedOn ?? '')).slice(0, 6)
  const name = data.settings.displayName?.split(' ')[0]

  if (!data.entries.length) {
    return (
      <div className="page">
        <header className="page-head">
          <p className="eyebrow">{greeting()}{name ? `, ${name}` : ''}</p>
          <h1 className="display">Let’s start your <em>library.</em></h1>
        </header>
        <Notices />
        <div className="onboard">
          <button className="onboard-card" onClick={() => nav('/add')}>
            <Plus size={22} /><b>Add a book</b><span>Search, scan a barcode, or snap the cover.</span>
          </button>
          <button className="onboard-card" onClick={() => nav('/settings#import')}>
            <ArrowRight size={22} /><b>Bring your books with you</b><span>Import a CSV from Goodreads, StoryGraph or any spreadsheet, with shelves, ratings and dates included.</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{greeting()}{name ? `, ${name}` : ''} · {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="display">
          {yp.done === 0 ? <>A fresh year of <em>reading.</em></> : <>{plural(yp.done, 'book')} into <em>{year}.</em></>}
        </h1>
      </header>
      <Notices />

      <section className="hero-strip">
        <button className="goal-card card" onClick={() => setGoalOpen(true)} aria-label={yp.goal ? `Reading goal: ${yp.done} of ${yp.goal} books. Change it` : 'Set a reading goal for this year'}>
          <Ring pct={yp.pct} size={104} stroke={9}>
            <div className="ring-num">{yp.goal ? <>{Math.round(Math.min(1, yp.pct) * 100)}<small>%</small></> : yp.done}</div>
          </Ring>
          <div>
            <div className="kicker">Reading goal</div>
            {yp.goal ? (
              <>
                <div className="goal-line"><b>{yp.done}</b> of {yp.goal} books</div>
                <div className={`goal-pace ${yp.ahead >= 0 ? 'good' : ''}`}>{yp.paceText}</div>
              </>
            ) : (
              <>
                <div className="goal-line"><b>{yp.done}</b> {yp.done === 1 ? 'book' : 'books'} so far</div>
                <div className="goal-pace">Tap to set a goal for {yp.year}</div>
              </>
            )}
          </div>
        </button>
        <GoalSheet year={yp.year} open={goalOpen} onClose={() => setGoalOpen(false)} />
        <div className="mini-stats">
          <div className="mini card"><span className="kicker">Pages</span><b>{compact(sum.pages)}</b></div>
          <div className="mini card"><span className="kicker">Listening</span><b>{Math.floor(sum.minutes / 60)}<small>h</small></b></div>
          <div className="mini card"><span className="kicker">Combined</span><b>{compact(sum.items.reduce((s, c) => s + pageEquivalent(c, data.settings), 0))}</b><span className="muted tiny">page-equivalents</span></div>
          <div className="mini card"><span className="kicker"><Flame size={12} /> Streak</span><b>{st.current}<small>d</small></b><span className="muted tiny">best {st.best}d</span></div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Currently reading</h2>
          <Link to="/library/reading" className="link">All <ArrowRight size={14} /></Link>
        </div>
        {current.length === 0 ? (
          <Empty title="Nothing on the go">
            <p>Pick something from <Link to="/library/want" className="link">Want to read</Link>, or <Link to="/add" className="link">add a book</Link>.</p>
          </Empty>
        ) : (
          <div className="now-grid">
            {current.map(({ entry, read }, i) => {
              const work = works.get(entry.workId)!
              const ed = editions.get(read?.editionId ?? entry.editionId ?? '')
              const info = progressInfo(read, ed)
              const audio = ed?.format === 'audiobook'
              const finishedBefore = (store.readsByEntry.get(entry.id) ?? []).filter((r) => r.state === 'finished').length
              return (
                <motion.article
                  key={entry.id}
                  className="now-card card"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link to={`/book/${work.id}`}><Cover work={work} edition={ed} size="lg" /></Link>
                  <div className="now-body">
                    <div className="now-kicker">
                      {audio && <><Headphones size={12} /> Listening</>}
                      {!audio && 'Reading'}
                      {finishedBefore > 0 && <span className="pill tiny">Reread #{finishedBefore + 1}</span>}
                    </div>
                    <Link to={`/book/${work.id}`} className="now-title">{work.title}</Link>
                    <div className="now-author">{work.authors.join(', ')}</div>
                    <div className="now-progress">
                      <Bar pct={info.pct} tone={audio ? 'audio' : 'accent'} label="Progress" />
                      <div className="now-progress-row"><span>{info.label}</span><span className="muted">{Math.round(info.pct * 100)}%</span></div>
                    </div>
                    <div className="now-actions">
                      <button className="btn btn-soft" onClick={() => read && setSheetRead(read)}>Update progress</button>
                      {read?.startedOn && <span className="muted small">since {fmtDate(read.startedOn, { year: false })}</span>}
                    </div>
                  </div>
                </motion.article>
              )
            })}
          </div>
        )}
      </section>

      {nextInSeries.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Next in your series</h2>
          </div>
          <div className="series-next">
            {nextInSeries.map((x) => (
              <Link key={x.name} to={`/series/${seriesSlug(x.name)}`} className="series-next-card card">
                <Cover work={x.next!.work} edition={editions.get(store.editionsByWork.get(x.next!.work.id)?.[0]?.id ?? '')} size="sm" />
                <div>
                  <span className="kicker">{x.name}{x.next!.index != null ? ` · Book\u00a0${x.next!.index}` : ''}</span>
                  <b>{x.next!.work.title}</b>
                  <span className="muted small">{x.read} of {x.books.length} read{x.next!.state === 'none' ? ' · not on your shelves yet' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {upNext.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Up next</h2>
            <Link to="/library/want" className="link">Want to read <ArrowRight size={14} /></Link>
          </div>
          <div className="shelf-row">
            {upNext.map((e, i) => <BookTile key={e.id} entry={e} index={i} />)}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recently finished</h2>
            <Link to="/stats" className="link">Your year <ArrowRight size={14} /></Link>
          </div>
          <ul className="recent">
            {recent.map((c) => {
              const ed = editions.get(c.read.editionId ?? '') ?? c.edition
              return (
                <li key={c.read.id}>
                  <Link to={`/book/${c.work.id}`} className="recent-row">
                    <Cover work={c.work} edition={ed} size="xs" />
                    <div className="recent-main">
                      <b>{c.work.title}</b>
                      <span className="muted">{c.work.authors[0]}{c.isReread ? ' · reread' : ''}</span>
                    </div>
                    <div className="recent-side">
                      {c.rating ? <Stars value={c.rating} size={12} /> : null}
                      <span className="muted small">{fmtDate(c.read.finishedOn)}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <ProgressSheet read={sheetRead && data.reads.find((r) => r.id === sheetRead.id)} open={!!sheetRead} onClose={() => setSheetRead(undefined)} />
    </div>
  )
}
