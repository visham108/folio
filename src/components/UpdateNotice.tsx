import { RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BUILD_ID, liveBuild, onCheckForUpdate } from '../lib/appVersion'

const EVERY = 30 * 60_000
const AT_MOST = 5 * 60_000

/**
 * "A new version of Folio is ready." Checks when the app opens, when you come back to it, every
 * half hour, and when you press Refresh; Reload loads the new version. Changes you've made are
 * already saved (on this device if you're offline), so reloading loses nothing.
 */
export function UpdateNotice() {
  const [live, setLive] = useState<string>()
  const [later, setLater] = useState<string>()
  useEffect(() => {
    let last = 0
    let alive = true
    const check = async (force = false) => {
      if (!force && Date.now() - last < AT_MOST) return
      last = Date.now()
      const id = await liveBuild()
      if (alive && id && id !== BUILD_ID) setLive(id)
    }
    check(true)
    const onShow = () => { if (document.visibilityState === 'visible') check() }
    const timer = window.setInterval(() => check(true), EVERY)
    const stop = onCheckForUpdate(() => check(true))
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    window.addEventListener('online', onShow)
    return () => {
      alive = false
      window.clearInterval(timer)
      stop()
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
      window.removeEventListener('online', onShow)
    }
  }, [])

  if (!live || later === live) return null
  return (
    <div className="update-notice card" role="region" aria-label="Update available">
      <p aria-live="polite"><b>A new version of Folio is ready.</b> <span className="muted">Reload to start using it.</span></p>
      <div className="update-actions">
        <button className="btn btn-primary sm" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload</button>
        <button className="icon-btn" onClick={() => setLater(live)} aria-label="Not now"><X size={16} /></button>
      </div>
    </div>
  )
}
