import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support for the deployed site (the service worker needs a real origin, not the dev server).
if (import.meta.env.PROD && 'serviceWorker' in navigator && import.meta.env.VITE_DEMO !== '1') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* unsupported or blocked: the app still works online */ })
  })
}
