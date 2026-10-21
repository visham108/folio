import { motion } from 'framer-motion'
import { ArrowLeft, Check, Shuffle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Cover } from '../components/Cover'
import { Empty, Segmented } from '../components/ui'
import { nextInSeriesIds } from '../lib/smartShelves'
import { mediumOf, type Entry, type Medium } from '../lib/types'
import { addDays, fmtDuration, hashString, plural, today } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { useSeries } from './hooks'

type Length = 'any' | 'quick' | 'medium' | 'long'
type Fmt = 'any' | Medium

/**
 * Narrow down the want-to-read pile by length, format, genre, mood and what you own, and get a
 * handful of suggestions with the reasons they fit.
 */
export function WhatNext() {
  const store = useStore()
  const { data, works } = store
  const toast = useToast()
  const nav = useNavigate()
  const { series } = useSeries()
  const [length, setLength] = useState<Length>('any')
  const [format, setFormat] = useState<Fmt>('any')
  const [genres, setGenres] = useState<Set<string>>(new Set())
  const [moods, setMoods] = useState<Set<string>>(new Set())
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [seed, setSeed] = useState(0)
  const [started, setStarted] = useState<Set<string>>(new Set())
  // Scores are kept once worked out, so starting a book (which changes what's next in its series) doesn't reshuffle the list under you.
  const scores = useRef(new Map<string, number>())

  const pph = data.settings.audioPagesPerHour
  const pool = useMemo(() => data.entries.filter((e) => (e.status === 'want' || started.has(e.id)) && works.has(e.workId)), [data.entries, works, started])
  const next = useMemo(() => nextInSeriesIds(series), [series])

  // Your recent pace (last 90 days), to say roughly how long a book would take.
  const pace = useMemo(() => {
    const since = addDays(today(), -90)
    const recent = data.logs.filter((l) => l.on >= since && l.amount > 0)
    const per = (m: 'text' | 'audio') => {
      const xs = recent.filter((l) => (m === 'audio') === (l.medium === 'audio'))
      const days = new Set(xs.map((l) => l.on)).size
      return days >= 3 ? xs.reduce((s, l) => s + l.amount, 0) / days : undefined
    }
    return { pages: per('text'), minutes: per('audio') }
  }, [data.logs])

  const info = (e: Entry) => {
    const ed = store.editionOf(e)
    const medium = mediumOf(ed?.format)
    const len = ed?.pages ?? (ed?.durationMin ? (ed.durationMin / 60) * pph : undefined)
    return { ed, medium, len }
  }

  const topGenres = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of pool) for (const g of works.get(e.workId)!.genres) m.set(g, (m.get(g) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([g]) => g)
  }, [pool, works])
  const poolMoods = useMemo(() => [...new Set(pool.flatMap((e) => e.moods ?? []))].sort(), [pool])

  const matches = useMemo(() => {
    const now = Date.now()
    const xs = pool.filter((e) => {
      const w = works.get(e.workId)!
      const { medium, len } = info(e)
      if (ownedOnly && !e.owned) return false
      if (format !== 'any' && medium !== format) return false
      if (length !== 'any') {
        if (len == null) return false
        if (length === 'quick' && len >= 300) return false
        if (length === 'medium' && (len < 300 || len > 500)) return false
        if (length === 'long' && len <= 500) return false
      }
      if (genres.size && !w.genres.some((g) => genres.has(g))) return false
      if (moods.size && !(e.moods ?? []).some((m) => moods.has(m))) return false
      return true
    })
    // Next in a series and books you own come first, then whatever has waited longest.
    // "Surprise me" reshuffles with a new seed.
    const score = (e: Entry) => {
      const key = `${seed}:${e.id}`
      let v = scores.current.get(key)
      if (v == null) {
        v = seed ? hashString(e.id + seed) : (next.has(e.workId) ? 2e13 : 0) + (e.owned ? 1e13 : 0) + (now - Date.parse(e.addedAt))
        if (series.length) scores.current.set(key, v) // series may still be loading: don't keep a score without it
      }
      return v
    }
    return xs.sort((a, b) => score(b) - score(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, works, ownedOnly, format, length, genres, moods, seed, next, pph])

  const reasons = (e: Entry) => {
    const w = works.get(e.workId)!
    const { ed, medium, len } = info(e)
    const out: string[] = []
    if (next.has(e.workId) && w.series) out.push(`Next in ${w.series}`)
    if (e.owned) out.push('Owned')
    if (medium === 'audio' && ed?.durationMin) out.push(fmtDuration(ed.durationMin))
    else if (ed?.pages) out.push(`${ed.pages} pages`)
    const months = Math.floor((Date.now() - Date.parse(e.addedAt)) / (30.4 * 86400000))
    if (months >= 1) out.push(`waiting ${months >= 24 ? plural(Math.floor(months / 12), 'year') : plural(months, 'month')}`)
    const perDay = medium === 'audio' ? pace.minutes : pace.pages
    const total = medium === 'audio' ? ed?.durationMin : ed?.pages
    if (perDay && total) out.push(`about ${plural(Math.max(1, Math.round(total / perDay)), 'day')} at your pace`)
    else if (len == null) out.push('no length yet')
    return out
  }

  const toggle = (set: Set<string>, v: string, put: (s: Set<string>) => void) => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    put(n)
  }
  const start = (e: Entry) => {
    store.setStatus(e.id, 'reading')
    setStarted((s) => new Set(s).add(e.id))
    toast(`Started ${works.get(e.workId)!.title}`, { action: { label: 'Open', run: () => nav(`/book/${e.workId}`) } })
  }

  const wanting = data.entries.filter((e) => e.status === 'want').length
  const shown = matches.slice(0, 8)
  return (
    <div className="page next-page">
      <button className="back" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><ArrowLeft size={16} /> Back</button>
      <header className="page-head">
        <h1 className="display">What <em>next?</em></h1>
        <p className="muted">{wanting ? `Narrow down your ${plural(wanting, 'book')} on Want to read.` : 'Nothing on Want to read yet.'}</p>
      </header>

      {pool.length === 0 ? (
        <Empty title="Your want-to-read pile is empty">
          <p><Link className="link" to="/add">Add a book</Link> you’d like to read, and come back when you’re choosing.</p>
        </Empty>
      ) : (
        <div className="next-layout">
          <div className="next-filters card">
            <div className="next-filter">
              <span className="kicker">How long</span>
              <Segmented<Length> size="sm" label="How long" value={length} onChange={setLength}
                options={[{ id: 'any', label: 'Any' }, { id: 'quick', label: 'Quick read' }, { id: 'medium', label: 'Medium' }, { id: 'long', label: 'Long haul' }]} />
            </div>
            <div className="next-filter">
              <span className="kicker">Format</span>
              <Segmented<Fmt> size="sm" label="Format" value={format} onChange={setFormat}
                options={[{ id: 'any', label: 'Any' }, { id: 'print', label: 'Print' }, { id: 'ebook', label: 'Ebook' }, { id: 'audio', label: 'Audio' }]} />
            </div>
            {topGenres.length > 0 && (
              <fieldset className="next-filter">
                <legend className="kicker">Genre</legend>
                <div className="mood-picker">
                  {topGenres.map((g) => (
                    <button key={g} type="button" className={`pill toggle ${genres.has(g) ? 'on' : ''}`} aria-pressed={genres.has(g)} onClick={() => toggle(genres, g, setGenres)}>{g}</button>
                  ))}
                </div>
              </fieldset>
            )}
            {poolMoods.length > 0 && (
              <fieldset className="next-filter">
                <legend className="kicker">In the mood for</legend>
                <div className="mood-picker">
                  {poolMoods.map((m) => (
                    <button key={m} type="button" className={`pill toggle ${moods.has(m) ? 'on' : ''}`} aria-pressed={moods.has(m)} onClick={() => toggle(moods, m, setMoods)}>{m}</button>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="next-toggle">
              <span><b>Only books I own</b><span className="muted small">Skip anything I’d have to buy or borrow</span></span>
              <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
            </label>
          </div>

          <section className="next-results" aria-label="Suggestions">
            <div className="section-head">
              <h2>{matches.length ? `${plural(matches.length, 'book')} ${matches.length === 1 ? 'fits' : 'fit'}` : 'Nothing fits'}</h2>
              {matches.length > 1 && (
                <button className="link" onClick={() => setSeed((s) => s + 1)}><Shuffle size={14} /> Surprise me</button>
              )}
            </div>
            {matches.length === 0 ? (
              <p className="muted">Try fewer filters.</p>
            ) : (
              <ul className="next-list">
                {shown.map((e, i) => {
                  const w = works.get(e.workId)!
                  const on = started.has(e.id)
                  return (
                    <motion.li key={e.id} className="next-card card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                      <Link to={`/book/${w.id}`} aria-hidden tabIndex={-1}><Cover work={w} edition={store.editionOf(e)} size="sm" /></Link>
                      <div className="next-main">
                        <Link to={`/book/${w.id}`} className="next-title">{w.title}</Link>
                        <span className="muted small">{w.authors.join(', ')}</span>
                        <span className="next-why small">{reasons(e).join(' · ')}</span>
                      </div>
                      {on ? (
                        <span className="next-started small"><Check size={14} /> Reading</span>
                      ) : (
                        <button className={`btn sm ${i === 0 ? 'btn-primary' : 'btn-soft'}`} onClick={() => start(e)}>Start reading</button>
                      )}
                    </motion.li>
                  )
                })}
              </ul>
            )}
            {matches.length > shown.length && <p className="muted small">And {plural(matches.length - shown.length, 'more')}. <Link className="link" to="/library/want">See them all</Link></p>}
          </section>
        </div>
      )}
    </div>
  )
}
