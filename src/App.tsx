import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { AddBook } from './pages/AddBook'
import { BookPage } from './pages/BookPage'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { SettingsPage } from './pages/Settings'
import { Stats } from './pages/Stats'
import { StoreProvider, useStore } from './state/store'
import { ToastProvider } from './state/toast'

function Routed() {
  const { ready, backend, data } = useStore()
  const theme = data.settings.theme
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  if (!ready) return <div className="boot"><span className="boot-mark">Folio</span></div>
  if (!backend) return <Login />
  return (
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
  )
}

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        {(push) => (
          <StoreProvider onError={(m) => push(m, { tone: 'error' })}>
            <Routed />
          </StoreProvider>
        )}
      </ToastProvider>
    </HashRouter>
  )
}
