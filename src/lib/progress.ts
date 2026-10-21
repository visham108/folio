import type { Edition, Read } from './types'
import { mediumOf } from './types'
import { fmtDuration } from './util'

export type Unit = 'pages' | 'minutes' | 'percent'

export function unitFor(ed?: Edition): Unit {
  const m = mediumOf(ed?.format)
  if (m === 'audio') return ed?.durationMin ? 'minutes' : 'percent'
  return ed?.pages ? 'pages' : 'percent'
}

export function progressInfo(read: Read | undefined, ed?: Edition) {
  const unit = unitFor(ed)
  const total = unit === 'pages' ? ed!.pages! : unit === 'minutes' ? ed!.durationMin! : 100
  const value = Math.min(total, Math.max(0, read?.progress ?? 0))
  const pct = total ? value / total : 0
  const label =
    unit === 'pages' ? `p. ${Math.round(value)} of ${total}`
      : unit === 'minutes' ? `${fmtDuration(value)} of ${fmtDuration(total)}`
        : `${Math.round(value)}%`
  const left =
    unit === 'pages' ? `${total - Math.round(value)} pages left`
      : unit === 'minutes' ? `${fmtDuration(total - value)} left`
        : `${100 - Math.round(value)}% left`
  return { unit, total, value, pct, label, left }
}

/** One-tap amounts, in whatever unit the book's progress is kept in. */
export function quickSteps(unit: Unit): { by: number; label: string }[] {
  if (unit === 'pages') return [{ by: 10, label: '+10 pages' }, { by: 25, label: '+25 pages' }]
  if (unit === 'minutes') return [{ by: 15, label: '+15 min' }, { by: 30, label: '+30 min' }]
  return [{ by: 5, label: '+5%' }, { by: 10, label: '+10%' }]
}
