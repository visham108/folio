import { AnimatePresence, motion } from 'framer-motion'
import { Star, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// ── Stars ────────────────────────────────────────────────────────────────────

export function Stars({
  value, onChange, size = 18, label = 'Rating',
}: { value?: number; onChange?: (v: number | undefined) => void; size?: number; label?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  const ro = !onChange
  const pick = (e: React.PointerEvent<HTMLSpanElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect()
    return i + (e.clientX - r.left < r.width / 2 ? 0.5 : 1)
  }
  const onKey = (e: KeyboardEvent) => {
    if (ro) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value ?? 0) + 0.5)) }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); const v = (value ?? 0) - 0.5; onChange(v > 0 ? v : undefined) }
    if (e.key === '0' || e.key === 'Backspace') onChange(undefined)
  }
  return (
    <span
      className={`stars ${ro ? 'ro' : ''}`}
      role={ro ? 'img' : 'slider'}
      aria-label={`${label}: ${value ? `${value} of 5` : 'not rated'}`}
      aria-valuemin={ro ? undefined : 0}
      aria-valuemax={ro ? undefined : 5}
      aria-valuenow={ro ? undefined : value ?? 0}
      tabIndex={ro ? undefined : 0}
      onKeyDown={onKey}
      onPointerLeave={() => setHover(null)}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, shown - i))
        return (
          <span
            key={i}
            className="star"
            style={{ width: size, height: size }}
            onPointerMove={ro ? undefined : (e) => setHover(pick(e, i))}
            onClick={ro ? undefined : (e) => {
              const v = pick(e as unknown as React.PointerEvent<HTMLSpanElement>, i)
              onChange(v === value ? undefined : v)
            }}
          >
            <Star size={size} className="star-empty" strokeWidth={1.6} />
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>
              <Star size={size} strokeWidth={1.6} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

// ── Sheet (bottom sheet on phones, dialog on larger screens) ──────────────────

export function Sheet({
  open, onClose, title, children, wide = false, footer,
}: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,textarea,select,button:not(.sheet-x)')?.focus(), 60)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
      prev?.focus?.()
    }
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? id : undefined}
            className={`sheet ${wide ? 'wide' : ''}`}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <div className="sheet-grip" aria-hidden />
            {title && (
              <header className="sheet-head">
                <h2 id={id}>{title}</h2>
                <button className="icon-btn sheet-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
              </header>
            )}
            <div className="sheet-body">{children}</div>
            {footer && <footer className="sheet-foot">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function Bar({ pct, tone = 'accent', label }: { pct: number; tone?: 'accent' | 'audio' | 'ebook'; label?: string }) {
  return (
    <div className={`bar tone-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={label}>
      <motion.span initial={{ width: 0 }} animate={{ width: `${Math.min(100, pct * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 24 }} />
    </div>
  )
}

export function Ring({ pct, size = 120, stroke = 10, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} className="ring-fill" strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, pct)) }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export function Field({ label, hint, required, children, className = '' }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{required && <i className="req" aria-label="required">*</i>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/** Free-text tokens (authors, narrators, genres). Enter or comma commits. */
export function Chips({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('')
  const listId = useId()
  const commit = (raw = text) => {
    const t = raw.trim().replace(/,$/, '')
    if (t && !value.includes(t)) onChange([...value, t])
    setText('')
  }
  return (
    <div className="chips-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((v) => (
        <span key={v} className="chip">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><X size={12} /></button>
        </span>
      ))}
      <input
        value={text}
        list={suggestions.length ? listId : undefined}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (e.target.value.endsWith(',') ? commit(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => commit()}
      />
      {suggestions.length > 0 && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', label }: {
  value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string
}) {
  const id = useId()
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {value === o.id && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children}
    </div>
  )
}
