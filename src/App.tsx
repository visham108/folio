import { MotionConfig } from 'framer-motion'
import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from './components/Shell'
import { UpdateNotice } from './components/UpdateNotice'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Login } from './pages/Login'

// Less-visited screens load on demand to keep the first load small, then
// quietly pre-load once the app is idle so opening them later is instant.
const loaders = {
  add: () => import('./pages/AddBook'),
  book: () => import('./pages/BookPage'),
  stats: () => import('./pages/Stats'),
  settings: () => import('./pages/Settings'),
  series: () => import('./pages/SeriesPage'),
  next: () => import('./pages/WhatNext'),
}
const AddBook = lazy(() => loaders.add().then((m) => ({ default: m.AddBook })))
const BookPage = lazy(() => loaders.book().then((m) => ({ default: m.BookPage })))
const Stats = lazy(() => loaders.stats().then((m) => ({ default: m.Stats })))
const SeriesPage = lazy(() => loaders.series().then((m) => ({ default: m.SeriesPage })))
const WhatNext = lazy(() => loaders.next().then((m) => ({ default: m.WhatNext })))
const SettingsPage = lazy(() => loaders.settings().then((m) => ({ default: m.SettingsPage })))

function usePreloadScreens(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200))
    idle(() => Object.values(loaders).forEach((load) => load().catch(() => {})))
  }, [enabled])
}
import { StoreProvider, useStore } from './state/store'
import { ToastProvider } from './state/toast'

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Today'], [/^\/library/, 'Library'], [/^\/book\//, 'Book'], [/^\/add/, 'Add a book'], [/^\/series\//, 'Series'],
  [/^\/stats/, 'Stats'], [/^\/next/, 'What next?'], [/^\/settings/, 'Settings'],
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
  const { backend, pending } = useStore()
  if (backend?.kind !== 'cloud') return null
  if (!online) {
    return (
      <div className="offline" role="status">
        You’re offline. Changes are kept on this device{pending ? ` (${pending} waiting)` : ''} and sync when you’re back.
      </div>
    )
  }
  if (pending) return <div className="offline" role="status">Syncing {pending} {pending === 1 ? 'change' : 'changes'}…</div>
  return null
}

function Routed() {
  const { ready, backend, data } = useStore()
  useDocumentTitle()
  usePreloadScreens(ready && !!backend)
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
    <UpdateNotice />
    <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="library" element={<Library />} />
        <Route path="library/:pile" element={<Library />} />
        <Route path="book/:workId" element={<BookPage />} />
        <Route path="add" element={<AddBook />} />
        <Route path="series/:name" element={<SeriesPage />} />
        <Route path="stats" element={<Stats />} />
        <Route path="stats/:year" element={<Stats />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="next" element={<WhatNext />} />
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
