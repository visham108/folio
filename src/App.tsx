import { MotionConfig } from 'framer-motion'
import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Login } from './pages/Login'

// Less-visited screens load on demand to keep the first load small.
const AddBook = lazy(() => import('./pages/AddBook').then((m) => ({ default: m.AddBook })))
const BookPage = lazy(() => import('./pages/BookPage').then((m) => ({ default: m.BookPage })))
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
import { StoreProvider, useStore } from './state/store'
import { ToastProvider } from './state/toast'

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Today'], [/^\/library/, 'Library'], [/^\/book\//, 'Book'], [/^\/add/, 'Add a book'],
  [/^\/stats/, 'Stats'], [/^\/settings/, 'Settings'],
]

function useDocumentTitle() {
  const { pathname } = useLocation()
  const { works } = useStore()
  useEffect(() => {
    const book = pathname.startsWith('/book/') ? works.get(pathname.split('/')[2])?.title : undefined
    const page = book ?? TITLES.find(([re]) => re.test(pathname))?.[1]
    document.title = page ? `${page} · Folio` : 'Folio'
  }, [pathname, works])
}

function OfflineNotice() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  const { backend } = useStore()
  if (online || backend?.kind !== 'cloud') return null
  return <div className="offline" role="status">You’re offline. Changes made now may not save.</div>
}

function Routed() {
  const { ready, backend, data } = useStore()
  useDocumentTitle()
  const theme = data.settings.theme
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  if (!ready) return <div className="boot"><span className="boot-mark">Folio</span></div>
  if (!backend) return <Login />
  return (
    <>
    <OfflineNotice />
    <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="library" element={<Library />} />
        <Route path="library/:pile" element={<Library />} />
        <Route path="book/:workId" element={<BookPage />} />
        <Route path="add" element={<AddBook />} />
        <Route path="stats" element={<Stats />} />
        <Route path="stats/:year" element={<Stats />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
    </>
  )
}

export function App() {
  return (
    <HashRouter>
      <MotionConfig reducedMotion="user">
      <ToastProvider>
        {(push) => (
          <StoreProvider onError={(m) => push(m, { tone: 'error' })}>
            <Routed />
          </StoreProvider>
        )}
      </ToastProvider>
      </MotionConfig>
    </HashRouter>
  )
}
