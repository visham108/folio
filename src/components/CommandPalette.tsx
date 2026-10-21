import { BarChart3, BookMarked, Home, Layers, Library, Plus, Search, Settings, Shuffle } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { fold } from '../lib/match'
import { seriesSlug } from '../lib/series'
import { STATUSES } from '../lib/types'
import { useStore } from '../state/store'
import { Cover } from './Cover'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const PALETTE_KEYS = IS_MAC ? '⌘K' : 'Ctrl K'

interface Item { id: string; group: string; label: string; hint?: string; icon: ReactNode; to: string; score: number; order?: number }

/**
 * One search box for everything (⌘K / Ctrl K): your books by title, author or series, your
 * piles and shelves, series pages and the app's screens.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore()
  const { data, works } = store
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    setQ('')
    setActive(0)
    document.body.classList.add('no-scroll')
    setTimeout(() => inputRef.current?.focus(), 0)
    return () => { document.body.classList.remove('no-scroll'); prev?.focus?.() }
  }, [open])

  const items = useMemo(() => {
    if (!open) return []
    const needle = fold(q)
    // Starts-with beats a word starting with it, which beats anywhere in the text.
    const rank = (text: string, base: number) => {
      if (!needle) return base
      const t = fold(text)
      if (t.startsWith(needle)) return base + 3
      if (t.includes(' ' + needle)) return base + 2
      return t.includes(needle) ? base + 1 : 0
    }
    const out: Item[] = []
    const screens: [string, string, ReactNode, string?][] = [
      ['Today', '/', <Home size={16} />],
      ['Library', '/library', <Library size={16} />],
      ['Stats', '/stats', <BarChart3 size={16} />],
      ['What next?', '/next', <Shuffle size={16} />, 'Help choosing from Want to read'],
      ['Add a book', '/add', <Plus size={16} />],
      ['Settings', '/settings', <Settings size={16} />, 'Import, export, backup, theme'],
    ]
    screens.forEach(([label, to, icon, hint], order) => {
      const score = rank(`${label} ${hint ?? ''}`, needle ? 0.5 : 1)
      if (score) out.push({ id: `go:${to}`, group: 'Go to', label, hint, icon, to, score, order })
    })
    for (const s of STATUSES) {
      const score = rank(s.label, 0.4)
      if (score && needle) out.push({ id: `pile:${s.id}`, group: 'Piles and shelves', label: s.label, icon: <Layers size={16} />, to: `/library/${s.id}`, score })
    }
    for (const sh of data.shelves) {
      const score = rank(sh.name, 0.4)
      if (score && needle) out.push({ id: `shelf:${sh.id}`, group: 'Piles and shelves', label: sh.name, hint: 'Your shelf', icon: <Layers size={16} />, to: `/library/${sh.id}`, score })
    }
    const series = new Set<string>()
    for (const w of data.works) if (w.series?.trim()) series.add(w.series.trim())
    for (const name of series) {
      const score = rank(name, 0.4)
      if (score && needle) out.push({ id: `series:${name}`, group: 'Series', label: name, icon: <BookMarked size={16} />, to: `/series/${seriesSlug(name)}`, score })
    }
    // Books: with nothing typed, the ones you're reading.
    for (const e of data.entries) {
      const w = works.get(e.workId)
      if (!w) continue
      if (!needle && e.status !== 'reading') continue
      const score = needle ? Math.max(rank(w.title, 1), rank(w.authors.join(' '), 0.6), rank(w.series ?? '', 0.5), rank(w.subtitle ?? '', 0.3)) : 1
      if (!score) continue
      out.push({
        id: `book:${e.id}`, group: needle ? 'Books' : 'Reading now', label: w.title,
        hint: [w.authors.join(', '), STATUSES.find((s) => s.id === e.status)?.short].filter(Boolean).join(' · '),
        icon: <Cover work={w} edition={store.editionOf(e)} size="xs" badge={false} />, to: `/book/${w.id}`, score,
      })
    }
    const order = ['Reading now', 'Books', 'Series', 'Piles and shelves', 'Go to']
    const byGroup = order.map((g) => out.filter((i) => i.group === g).sort((a, b) => b.score - a.score || (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label)).slice(0, g === 'Books' ? 8 : 5))
    return byGroup.flat()
  }, [open, q, data.entries, data.shelves, data.works, works]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null
  const go = (i?: Item) => {
    if (!i) return
    onClose()
    nav(i.to)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Tab') e.preventDefault() // the box is the only stop; arrows move through the results
  }

  let lastGroup = ''
  return createPortal(
    <div className="palette-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search Folio">
        <div className="palette-input">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search books, authors, series, shelves…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            aria-label="Search Folio"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" id={listId} role="listbox" ref={listRef} aria-label="Results">
          {items.length === 0 && <li className="palette-empty muted" role="presentation">Nothing matches “{q}”.</li>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : ''
            lastGroup = it.group
            return (
              <li key={it.id} role="presentation">
                {head && <div className="palette-group" aria-hidden>{head}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item ${i === active ? 'on' : ''}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => go(it)}
                >
                  <span className="palette-icon" aria-hidden>{it.icon}</span>
                  <span className="palette-text"><b>{it.label}</b>{it.hint && <span className="muted small">{it.hint}</span>}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="palette-foot muted small" aria-hidden>
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>{PALETTE_KEYS}</kbd> open this anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** ⌘K / Ctrl K toggles the palette from anywhere in the app. */
export function usePaletteShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
}
