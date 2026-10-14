import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, BookOpen, Home, Library, Plus, Settings } from 'lucide-react'
import { Suspense } from 'react'
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { useStore } from '../state/store'
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
  const { data, backend } = useStore()
  const yp = useYearProgress()
  return (
    <div className="shell">
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
        <button className="btn btn-primary add-btn" onClick={() => nav('/add')}>
          <Plus size={18} /> Add a book
        </button>
        <div className="side-goal" onClick={() => nav('/stats')} role="link" tabIndex={0}>
          <Ring pct={yp.pct} size={52} stroke={5}><span className="ring-mini">{yp.done}</span></Ring>
          <div>
            <div className="side-goal-t">{yp.year} goal</div>
            <div className="muted small">{yp.done} of {data.settings.yearlyGoal} books</div>
          </div>
        </div>
        <div className="side-foot muted small">{backend?.kind === 'cloud' ? backend.userLabel : 'Saved on this device'}</div>
      </aside>

      <main className="main">
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
    </div>
  )
}
