import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Headphones } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { progressInfo } from '../lib/progress'
import { STATUSES, type Read } from '../lib/types'
import { fmtDate, fmtDuration } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Cover } from './Cover'
import { ProgressSheet } from './ProgressSheet'
import { QuickSteps } from './QuickProgress'
import { Bar, Stars } from './ui'

type Bind = { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void; onPointerLeave: () => void }
const Ctx = createContext<(entryId: string) => Bind | undefined>(() => undefined)

/** Hover handlers for a book (a tile or a spine). Only where there's a mouse; touch taps open the book as before. */
export const useBookPreview = (entryId: string) => useContext(Ctx)(entryId)

const OPEN_DELAY = 450
const CLOSE_DELAY = 160
const CARD_W = 300

/**
 * On desktop, resting the pointer on a book shows a small card: cover, where you are, and the
 * next thing you'd do with it (log some pages, start it), without leaving the page.
 */
export function BookPreviewProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ entryId: string; rect: DOMRect }>()
  const [sheet, setSheet] = useState<{ read: Read; finishing: boolean }>()
  const openTimer = useRef<number>(undefined)
  const closeTimer = useRef<number>(undefined)
  const [fine, setFine] = useState(() => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(hover: hover) and (pointer: fine)')
    const on = () => setFine(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const cancelClose = () => window.clearTimeout(closeTimer.current)
  const close = useCallback(() => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setShown(undefined), CLOSE_DELAY)
  }, [])
  const hideNow = useCallback(() => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    setShown(undefined)
  }, [])

  // Anything that moves the page out from under the card closes it.
  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hideNow() }
    window.addEventListener('scroll', hideNow, { passive: true, capture: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('dragstart', hideNow)
    return () => {
      window.removeEventListener('scroll', hideNow, { capture: true })
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragstart', hideNow)
    }
  }, [shown, hideNow])
  useEffect(() => () => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current) }, [])

  const bind = useCallback((entryId: string): Bind | undefined => {
    if (!fine) return undefined
    return {
      onPointerEnter: (e) => {
        if (e.pointerType !== 'mouse' || e.buttons) return
        const el = e.currentTarget
        cancelClose()
        window.clearTimeout(openTimer.current)
        openTimer.current = window.setTimeout(() => {
          if (el.isConnected) setShown({ entryId, rect: el.getBoundingClientRect() })
        }, OPEN_DELAY)
      },
      onPointerLeave: close,
    }
  }, [fine, close])

  const store = useStore()
  return (
    <Ctx.Provider value={bind}>
      {children}
      {createPortal(
        <AnimatePresence>
          {shown && (
            <PreviewCard key={shown.entryId} entryId={shown.entryId} anchor={shown.rect}
              onEnter={cancelClose} onLeave={close}
              onProgress={(read, finishing) => { hideNow(); setSheet({ read, finishing }) }} onDone={hideNow} />
          )}
        </AnimatePresence>,
        document.body,
      )}
      <ProgressSheet read={sheet && store.data.reads.find((r) => r.id === sheet.read.id)} open={!!sheet} finishing={sheet?.finishing}
        onClose={() => setSheet(undefined)} />
    </Ctx.Provider>
  )
}

function PreviewCard({ entryId, anchor, onEnter, onLeave, onProgress, onDone }: {
  entryId: string; anchor: DOMRect; onEnter: () => void; onLeave: () => void
  onProgress: (read: Read, finishing: boolean) => void; onDone: () => void
}) {
  const store = useStore()
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const entry = store.entries.get(entryId)
  const work = entry && store.works.get(entry.workId)
  // Beside the book, on whichever side has room; kept inside the window.
  const right = anchor.right + 12 + CARD_W < window.innerWidth
  const left = right ? anchor.right + 12 : Math.max(12, anchor.left - 12 - CARD_W)
  const [top, setTop] = useState(Math.max(12, anchor.top))
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setTop(Math.max(12, Math.min(anchor.top, window.innerHeight - h - 12)))
  }, [anchor])
  if (!entry || !work) return null

  const ed = store.editionOf(entry)
  const read = store.activeRead(entry.id)
  const reading = entry.status === 'reading' && read && read.state === 'reading'
  const info = progressInfo(read, ed)
  const audio = ed?.format === 'audiobook'
  const finished = (store.readsByEntry.get(entry.id) ?? []).filter((r) => r.state === 'finished' && r.finishedOn).map((r) => r.finishedOn!).sort().pop()
  const length = audio ? fmtDuration(ed?.durationMin) : ed?.pages ? `${ed.pages} pages` : ''
  const start = () => {
    store.setStatus(entry.id, 'reading')
    toast(`Started ${work.title}`)
    onDone()
  }

  return (
    <motion.div
      ref={ref}
      className="preview-card card"
      style={{ left, top, width: CARD_W }}
      initial={{ opacity: 0, x: right ? -6 : 6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16 }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="preview-top">
        <Cover work={work} edition={ed} size="sm" />
        <div className="preview-main">
          <span className="kicker">{audio && <Headphones size={11} />}{STATUSES.find((s) => s.id === entry.status)?.short}</span>
          <b className="preview-title">{work.title}</b>
          <span className="muted small">{work.authors.join(', ')}</span>
          <span className="muted small">{[length, work.series && `${work.series}${work.seriesIndex != null ? ` #${work.seriesIndex}` : ''}`].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {reading && read && (
        <div className="preview-progress">
          <Bar pct={info.pct} tone={audio ? 'audio' : 'accent'} label="Progress" />
          <div className="now-progress-row"><span>{info.label}</span><span className="muted">{Math.round(info.pct * 100)}%</span></div>
          <div className="preview-actions">
            <QuickSteps read={read} onFinish={() => onProgress(read, true)} />
            <button className="btn btn-ghost sm" onClick={() => onProgress(read, false)}>Update…</button>
          </div>
        </div>
      )}
      {(entry.status === 'want' || entry.status === 'paused') && (
        <div className="preview-actions">
          <button className="btn btn-primary sm" onClick={start}>{entry.status === 'paused' ? 'Pick it back up' : 'Start reading'}</button>
        </div>
      )}
      {entry.status === 'read' && (entry.rating || finished) && (
        <div className="preview-done small">
          {entry.rating ? <Stars value={entry.rating} size={13} /> : null}
          {finished && <span className="muted">Finished {fmtDate(finished)}</span>}
        </div>
      )}
      <Link to={`/book/${work.id}`} className="link small preview-open" onClick={onDone}>Open book <ArrowRight size={13} /></Link>
    </motion.div>
  )
}
