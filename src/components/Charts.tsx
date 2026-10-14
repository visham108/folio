import { motion } from 'framer-motion'
import { useMemo, useState, type ReactNode } from 'react'
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
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
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
export function Columns({ data, height = 220, format = compact, unit = '', ariaLabel }: {
  data: ColumnDatum[]; height?: number; format?: (n: number) => string; unit?: string; ariaLabel: string
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
                  {i === peak && totals[i] > 0 && <span className="col-peak">{format(totals[i])}</span>}
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
