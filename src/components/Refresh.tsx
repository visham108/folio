import { RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { checkForUpdate } from '../lib/appVersion'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

/** "Today, 10:42 am", "Yesterday, 9:05 pm" or "19 Oct, 10:42 am" (with the year if it isn't this one). */
export function fmtRefreshed(t: number, now = Date.now()) {
  const d = new Date(t)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = new Date(now)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yesterday = new Date(day); yesterday.setDate(day.getDate() - 1)
  if (sameDay(d, day)) return `Today, ${time}`
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== day.getFullYear() ? { year: 'numeric' } : {}) })
  return `${date}, ${time}`
}

/** Reload the library from the server, with when that last happened. */
export function RefreshControl({ className = '' }: { className?: string }) {
  const { refresh, refreshedAt, ready } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // Re-render around midnight so "Today" becomes "Yesterday".
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t) }, [])

  const run = async () => {
    setBusy(true)
    checkForUpdate() // a newer Folio, if one has been deployed, offers itself too
    const res = await refresh()
    setBusy(false)
    if (res === 'ok') toast('Library refreshed')
    else if (res === 'offline') toast('You’re offline, so this is the copy saved on this device. Try again when you’re connected.', { tone: 'error' })
  }
  const when = refreshedAt ? fmtRefreshed(refreshedAt) : null
  return (
    <div className={`refresh ${className}`}>
      <button className="refresh-btn" onClick={run} disabled={busy || !ready} aria-label="Refresh library" title="Load the latest from your account">
        <RotateCw size={14} className={busy ? 'spin' : undefined} /> {busy ? 'Refreshing…' : 'Refresh'}
      </button>
      <span className="refresh-when" aria-live="polite" title={refreshedAt ? new Date(refreshedAt).toLocaleString() : undefined}>
        {when ? <>Last refreshed <time dateTime={new Date(refreshedAt!).toISOString()}>{when}</time></> : 'Not refreshed yet'}
      </span>
    </div>
  )
}
