import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, BookOpen, Home, Library, Plus, Search, Settings } from 'lucide-react'
import { Suspense, useCallback, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { useStore } from '../state/store'
import { RefreshControl } from './Refresh'
import { BookPreviewProvider } from './BookPreview'
import { CommandPalette, PALETTE_KEYS, usePaletteShortcut } from './CommandPalette'
import { compact } from '../lib/util'
import { Ring } from './ui'
import { useYearProgress } from '../pages/hooks'

const NAV = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Shell() {
  const loc = useLocation()
  const outlet = useOutlet()
  const nav = useNavigate()
  const { backend } = useStore()
  const yp = useYearProgress()
  const [palette, setPalette] = useState(false)
  usePaletteShortcut(useCallback(() => setPalette((p) => !p), []))
  return (
    <BookPreviewProvider>
    <div className="shell">
      <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>
        Skip to content
      </a>
      <aside className="sidebar">
        <button className="brand" onClick={() => nav('/')}>
          <BookOpen size={20} strokeWidth={2} /> <span>Folio</span>
        </button>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="side-link">
              <n.icon size={18} strokeWidth={1.9} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <button className="side-search" onClick={() => setPalette(true)}>
          <Search size={16} /> <span>Search</span> <kbd>{PALETTE_KEYS}</kbd>
        </button>
        <button className="btn btn-primary add-btn" onClick={() => nav('/add')}>
          <Plus size={18} /> Add a book
        </button>
        <Link className="side-goal side-goals" to="/stats" aria-label={`${yp.year} goals: ${yp.done}${yp.goal ? ` of ${yp.goal}` : ''} books, ${yp.pages.done.toLocaleString()}${yp.pages.goal ? ` of ${yp.pages.goal.toLocaleString()}` : ''} pages`}>
          <div className="side-goal-t">{yp.year} goals</div>
          <div className="side-goal-row">
            <Ring pct={yp.pct} size={38} stroke={4}><span className="ring-mini">{yp.done}</span></Ring>
            <span className="muted small">{yp.goal ? `${yp.done} of ${yp.goal} books` : `${yp.done} ${yp.done === 1 ? 'book' : 'books'}`}</span>
          </div>
          <div className="side-goal-row">
            <Ring pct={yp.pages.pct} size={38} stroke={4}><span className="ring-mini xs">{Math.round(Math.min(1, yp.pages.pct) * 100)}%</span></Ring>
            <span className="muted small">{yp.pages.goal ? `${compact(yp.pages.done)} of ${compact(yp.pages.goal)} pages` : `${compact(yp.pages.done)} pages`}</span>
          </div>
        </Link>
        <RefreshControl className="side-refresh" />
        <div className="side-foot muted small">{backend?.kind === 'cloud' ? backend.userLabel : 'Saved on this device'}</div>
      </aside>

      <main className="main" id="main-content" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loc.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            onAnimationStart={() => window.scrollTo({ top: 0 })}
          >
            <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{outlet}</Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.slice(0, 2).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="tab"><n.icon size={22} strokeWidth={1.8} /><span>{n.label}</span></NavLink>
        ))}
        <button className="tab-add" onClick={() => nav('/add')} aria-label="Add a book"><Plus size={26} strokeWidth={2.2} /></button>
        {NAV.slice(2).map((n) => (
          <NavLink key={n.to} to={n.to} className="tab"><n.icon size={22} strokeWidth={1.8} /><span>{n.label}</span></NavLink>
        ))}
      </nav>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
    </BookPreviewProvider>
  )
}
