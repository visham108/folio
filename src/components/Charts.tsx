import { motion } from 'framer-motion'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { Medium } from '../lib/types'
import { compact } from '../lib/util'

export const MEDIA: { id: Medium; label: string }[] = [
  { id: 'print', label: 'Print' },
  { id: 'audio', label: 'Audio' },
  { id: 'ebook', label: 'Ebook' },
]

export function Legend({ items }: { items: { id: string; label: string }[] }) {
  return (
    <div className="legend">
      {items.map((m) => (
        <span key={m.id}><i className={`sw sw-${m.id}`} />{m.label}</span>
      ))}
    </div>
  )
}

function niceMax(v: number): number {
  if (v <= 2) return 2 // keeps the half-way tick on a whole number for small counts
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  // Steps chosen so the half-way gridline is also a round number.
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10
  return step * p
}

export interface ColumnDatum {
  key: string
  label: string
  /** Stacked values, in MEDIA order. */
  parts: Partial<Record<Medium, number>>
  tip?: ReactNode
}

/** Stacked column chart. ≤24px columns, 4px rounded data-ends, 2px surface gaps, hover tooltip. */
export function Columns({ data, height = 220, format = compact, unit = '', ariaLabel, showPeak = true }: {
  data: ColumnDatum[]; height?: number; format?: (n: number) => string; unit?: string; ariaLabel: string
  /** Label the tallest column (off for shares, where every column is 100%). */
  showPeak?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const totals = data.map((d) => MEDIA.reduce((s, m) => s + (d.parts[m.id] ?? 0), 0))
  const max = niceMax(Math.max(...totals, 0))
  const peak = totals.indexOf(Math.max(...totals))
  return (
    <div className="chart cols" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
      <div className="cols-plot" style={{ height }}>
        {[1, 0.5, 0].map((t) => (
          <div key={t} className={`cols-grid ${t === 0 ? 'base' : ''}`} style={{ bottom: `${t * 100}%` }}>
            <span>{format(max * t)}</span>
          </div>
        ))}
        <div className="cols-row">
          {data.map((d, i) => {
            const segs = MEDIA.filter((m) => (d.parts[m.id] ?? 0) > 0)
            return (
              <div
                key={d.key}
                className={`col ${hover != null && hover !== i ? 'dim' : ''}`}
                onPointerEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                <motion.div
                  className="col-stack"
                  initial={{ height: 0 }}
                  animate={{ height: `${(totals[i] / max) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 140, damping: 22, delay: i * 0.02 }}
                >
                  {showPeak && i === peak && totals[i] > 0 && <span className="col-peak">{format(totals[i])}</span>}
                  {segs.slice().reverse().map((m) => (
                    <span key={m.id} className={`seg-${m.id}`} style={{ flexGrow: d.parts[m.id] }} />
                  ))}
                </motion.div>
                {hover === i && (
                  <div className={`tip ${i > data.length * 0.6 ? 'tip-left' : ''}`}>
                    <strong>{d.label}</strong>
                    {segs.map((m) => (
                      <div key={m.id} className="tip-row"><i className={`sw sw-${m.id}`} />{m.label}<b>{format(d.parts[m.id]!)}{unit}</b></div>
                    ))}
                    {totals[i] === 0 && <div className="tip-row muted">Nothing finished</div>}
                    {d.tip}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="cols-labels">
        {data.map((d, i) => <span key={d.key} className={hover === i ? 'on' : ''}>{d.label}</span>)}
      </div>
    </div>
  )
}

/** Horizontal ranked bars (authors, genres, ratings). */
export function BarList({ items, format = (n: number) => String(n), max: maxIn }: {
  items: { label: ReactNode; value: number; key: string }[]; format?: (n: number) => string; max?: number
}) {
  const max = maxIn ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="barlist">
      {items.map((it, i) => (
        <li key={it.key} title={`${typeof it.label === 'string' ? it.label : ''} ${format(it.value)}`}>
          <span className="bl-label">{it.label}</span>
          <span className="bl-track">
            <motion.span
              className="bl-fill"
              initial={{ width: 0 }}
              animate={{ width: `${(it.value / max) * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 22, delay: i * 0.03 }}
            />
          </span>
          <span className="bl-value">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Calendar heatmap — one column per week, Monday first. */
export function Heatmap({ year, values, unitLabel }: { year: number; values: Map<string, number>; unitLabel: string }) {
  const [hover, setHover] = useState<{ d: string; v: number; x: number; y: number } | null>(null)
  const { weeks, months, levels } = useMemo(() => {
    const start = new Date(Date.UTC(year, 0, 1))
    const offset = (start.getUTCDay() + 6) % 7
    const days: { d: string; v: number; col: number; row: number }[] = []
    const all = [...values.values()].filter((v) => v > 0).sort((a, b) => a - b)
    const q = (p: number) => all[Math.min(all.length - 1, Math.floor(all.length * p))] ?? 0
    const levels = [q(0.25), q(0.5), q(0.75)]
    const months: { label: string; col: number }[] = []
    for (let t = start.getTime(); new Date(t).getUTCFullYear() === year; t += 86400000) {
      const dt = new Date(t)
      const idx = Math.round((t - start.getTime()) / 86400000) + offset
      const d = dt.toISOString().slice(0, 10)
      if (dt.getUTCDate() === 1) months.push({ label: dt.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), col: Math.floor(idx / 7) })
      days.push({ d, v: values.get(d) ?? 0, col: Math.floor(idx / 7), row: idx % 7 })
    }
    return { weeks: days, months, levels }
  }, [year, values])
  const lvl = (v: number) => (v <= 0 ? 0 : v <= levels[0] ? 1 : v <= levels[1] ? 2 : v <= levels[2] ? 3 : 4)
  const cell = 11, gap = 3
  const cols = Math.max(...weeks.map((w) => w.col)) + 1
  const todayIso = new Date().toISOString().slice(0, 10)
  return (
    <div className="heatmap" onPointerLeave={() => setHover(null)}>
      <div className="hm-scroll">
        <svg width="100%" viewBox={`0 0 ${cols * (cell + gap) + 24} ${7 * (cell + gap) + 18}`} className="hm-svg" role="img" aria-label={`Reading activity in ${year}`}>
          {months.map((m) => <text key={m.label} x={24 + m.col * (cell + gap)} y={10} className="tick">{m.label}</text>)}
          {['M', 'W', 'F'].map((l, i) => <text key={l} x={0} y={18 + (i * 2) * (cell + gap) + cell - 2} className="tick">{l}</text>)}
          {weeks.map((w) => (
            <rect
              key={w.d}
              x={24 + w.col * (cell + gap)}
              y={18 + w.row * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              className={`hm hm-${w.d > todayIso ? 'future' : lvl(w.v)}`}
              onPointerEnter={(e) => {
                const r = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
                const c = e.currentTarget.getBoundingClientRect()
                setHover({ d: w.d, v: w.v, x: c.left - r.left + cell / 2, y: c.top - r.top })
              }}
            />
          ))}
        </svg>
      </div>
      <div className="hm-legend">
        Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hm-key hm-${l}`} />)} More
      </div>
      {hover && (
        <div className="tip tip-small" style={{ left: hover.x, top: hover.y - 8 }}>
          <strong>{new Date(hover.d + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
          <div className="tip-row">{hover.v > 0 ? `${Math.round(hover.v)} ${unitLabel}` : 'No reading logged'}</div>
        </div>
      )}
    </div>
  )
}

// ── Single-series columns (histograms, decades, months) ───────────────────────

export function SimpleColumns({ data, tone = 'print', height = 180, format = (n: number) => String(Math.round(n)), unit = '', ariaLabel, labelEvery = 1 }: {
  data: { key: string; label: string; value: number }[]
  tone?: Medium
  height?: number
  format?: (n: number) => string
  unit?: string
  ariaLabel: string
  /** Show every nth axis label when there are many columns. */
  labelEvery?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const peak = data.findIndex((d) => d.value === Math.max(...data.map((x) => x.value)))
  return (
    <div className="chart cols" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
      <div className="cols-plot" style={{ height }}>
        {[1, 0.5, 0].map((t) => (
          <div key={t} className={`cols-grid ${t === 0 ? 'base' : ''}`} style={{ bottom: `${t * 100}%` }}><span>{format(max * t)}</span></div>
        ))}
        <div className="cols-row">
          {data.map((d, i) => (
            <div key={d.key} className={`col ${hover != null && hover !== i ? 'dim' : ''}`} onPointerEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <motion.div className="col-stack" initial={{ height: 0 }} animate={{ height: `${(d.value / max) * 100}%` }}
                transition={{ type: 'spring', stiffness: 140, damping: 22, delay: i * 0.02 }}>
                {i === peak && d.value > 0 && <span className="col-peak">{format(d.value)}{unit}</span>}
                {d.value > 0 && <span className={`seg-${tone}`} style={{ flexGrow: 1 }} />}
              </motion.div>
              {hover === i && (
                <div className={`tip ${i > data.length * 0.6 ? 'tip-left' : ''}`}>
                  <strong>{d.label}</strong>
                  <div className="tip-row"><i className={`sw sw-${tone}`} />{format(d.value)}{unit}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="cols-labels">
        {data.map((d, i) => <span key={d.key} className={hover === i ? 'on' : ''}>{i % labelEvery === 0 ? d.label : ''}</span>)}
      </div>
    </div>
  )
}

// ── Line chart with crosshair ────────────────────────────────────────────────

export interface LineSeries {
  id: string
  label: string
  /** CSS colour (a token), e.g. var(--c-print). */
  color: string
  points: { x: number; y: number }[]
  /** A reference line (goal pace): thinner and quieter than the data. */
  reference?: boolean
}

export function LineChart({ series, xMax, xLabel, height = 220, format = (n: number) => String(Math.round(n)), ariaLabel, ticks }: {
  series: LineSeries[]
  xMax: number
  xLabel: (x: number) => string
  height?: number
  format?: (n: number) => string
  ariaLabel: string
  /** x positions for axis labels. */
  ticks: number[]
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hx, setHx] = useState<number | null>(null)
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y))))
  const W = 1000
  const px = (x: number) => (x / Math.max(1, xMax)) * W
  const py = (y: number) => height - (y / yMax) * height
  const valueAt = (s: LineSeries, x: number) => {
    if (s.reference && s.points.length === 2) {
      const [a, b] = s.points
      return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1, b.x - a.x)
    }
    let best: { x: number; y: number } | undefined
    for (const p of s.points) if (p.x <= x) best = p
    return best && x <= s.points[s.points.length - 1].x ? best.y : undefined
  }
  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    const x = Math.round(((e.clientX - r.left) / r.width) * xMax)
    setHx(Math.max(0, Math.min(xMax, x)))
  }
  const main = series.filter((s) => !s.reference)
  return (
    <div className="chart line-chart" role="img" aria-label={ariaLabel}>
      <div className="lc-plot" style={{ height }} ref={wrap} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHx(null)}>
        {[1, 0.5, 0].map((t) => (
          <div key={t} className={`cols-grid ${t === 0 ? 'base' : ''}`} style={{ bottom: `${t * 100}%` }}><span>{format(yMax * t)}</span></div>
        ))}
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="lc-svg" aria-hidden>
          {series.map((s) => (
            <polyline key={s.id} fill="none" stroke={s.color} strokeWidth={s.reference ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round"
              vectorEffect="non-scaling-stroke" opacity={s.reference ? 0.7 : 1}
              points={(s.reference ? s.points : s.points).map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
          ))}
          {main.map((s) => s.points.length > 1 && (
            <polygon key={s.id + '-area'} fill={s.color} opacity={0.08}
              points={`${px(s.points[0].x)},${height} ${s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} ${px(s.points[s.points.length - 1].x)},${height}`} />
          ))}
        </svg>
        {/* End markers and hover dots in HTML so they stay round at any width. */}
        {main.map((s) => {
          const last = s.points[s.points.length - 1]
          return last ? <span key={s.id} className="lc-dot" style={{ left: `${(last.x / xMax) * 100}%`, top: `${(py(last.y) / height) * 100}%`, background: s.color }} /> : null
        })}
        {series.map((s) => {
          const last = s.points[s.points.length - 1]
          if (!last || !s.reference) return null
          return <span key={s.id + '-lbl'} className="lc-ref-label" style={{ right: 0, top: `calc(${(py(last.y) / height) * 100}% - 18px)` }}>{s.label}</span>
        })}
        {hx != null && (
          <>
            <span className="lc-cross" style={{ left: `${(hx / xMax) * 100}%` }} />
            {series.map((s) => {
              const v = valueAt(s, hx)
              return v == null ? null : <span key={s.id + '-h'} className="lc-dot sm" style={{ left: `${(hx / xMax) * 100}%`, top: `${(py(v) / height) * 100}%`, background: s.color }} />
            })}
            <div className={`tip lc-tip ${hx > xMax * 0.6 ? 'tip-left' : ''}`} style={{ left: `${(hx / xMax) * 100}%` }}>
              <strong>{xLabel(hx)}</strong>
              {series.map((s) => {
                const v = valueAt(s, hx)
                return v == null ? null : <div key={s.id} className="tip-row"><i className="sw" style={{ background: s.color }} />{s.label}<b>{format(v)}</b></div>
              })}
            </div>
          </>
        )}
      </div>
      <div className="lc-xlabels">
        {ticks.map((t) => <span key={t} style={{ left: `${(t / xMax) * 100}%` }}>{xLabel(t)}</span>)}
      </div>
    </div>
  )
}

// ── Scatter ──────────────────────────────────────────────────────────────────

export function Scatter({ points, xLabel, yLabel, ariaLabel, onPick }: {
  points: { id: string; x: number; y: number; medium: Medium; title: string; detail?: string }[]
  xLabel: string
  yLabel: string
  ariaLabel: string
  onPick?: (id: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const xMax = niceMax(Math.max(100, ...points.map((p) => p.x)))
  const h = points.find((p) => p.id === hover)
  // Ratings sit on half-star steps, so nudge overlapping dots sideways a touch.
  const jitter = (id: string) => ((id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 7 - 3) * 0.35
  return (
    <div className="chart scatter" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
      <div className="sc-plot">
        {[5, 4, 3, 2, 1].map((r) => (
          <div key={r} className="cols-grid" style={{ bottom: `${((r - 0.5) / 4.5) * 100}%` }}><span>{r}★</span></div>
        ))}
        <div className="cols-grid base" style={{ bottom: 0 }} />
        {points.map((p) => (
          <button
            key={p.id}
            className={`sc-dot dot-${p.medium} ${hover && hover !== p.id ? 'dim' : ''}`}
            style={{ left: `calc(${(p.x / xMax) * 100}% + ${jitter(p.id)}px)`, bottom: `${((p.y - 0.5) / 4.5) * 100}%` }}
            aria-label={`${p.title}: ${p.y} stars, ${p.detail ?? ''}`}
            onPointerEnter={() => setHover(p.id)}
            onFocus={() => setHover(p.id)}
            onClick={() => onPick?.(p.id)}
          />
        ))}
        {h && (
          <div className={`tip sc-tip ${h.x > xMax * 0.6 ? 'tip-left' : ''}`} style={{ left: `${(h.x / xMax) * 100}%`, bottom: `${((h.y - 0.5) / 4.5) * 100}%` }}>
            <strong>{h.title}</strong>
            <div className="tip-row"><i className={`sw sw-${h.medium}`} />{h.detail}<b>{h.y}★</b></div>
          </div>
        )}
      </div>
      <div className="sc-axis"><span>0</span><span className="muted">{xLabel}</span><span>{compact(xMax)}</span></div>
      <span className="sr-only">{yLabel}</span>
    </div>
  )
}

// ── Heat table (genres × years) ──────────────────────────────────────────────

export function HeatTable({ rows, cols, cells, max, ariaLabel }: {
  rows: string[]; cols: string[]; cells: number[][]; max: number; ariaLabel: string
}) {
  return (
    <div className="heat-table-wrap">
      <table className="heat-table" aria-label={ariaLabel}>
        <thead><tr><th />{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {cells[i].map((v, j) => {
                const pct = v ? 18 + (v / max) * 82 : 0
                return (
                  <td key={j} title={`${r}, ${cols[j]}: ${v} ${v === 1 ? 'book' : 'books'}`}
                    style={{ background: v ? `color-mix(in oklab, var(--c-print) ${pct}%, var(--surface))` : undefined, color: pct > 60 ? '#fff' : undefined }}>
                    {v || ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
