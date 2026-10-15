import type { Snapshot } from './types'
import { today } from './util'

const LAST_KEY = 'folio.lastBackup'
const SNOOZE_KEY = 'folio.backupSnoozeUntil'
const DAY = 86400000

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } }

/** Downloads the whole library as a Folio JSON file and remembers when. */
export function downloadBackup(data: Snapshot) {
  const blob = new Blob([JSON.stringify({ app: 'folio', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `folio-library-${today()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  write(LAST_KEY, new Date().toISOString())
}

export const lastBackup = (): string | null => read(LAST_KEY)

/** A gentle monthly nudge once there's something worth keeping. */
export function backupDue(bookCount: number): boolean {
  if (bookCount < 5) return false
  const snooze = Number(read(SNOOZE_KEY) ?? 0)
  if (Date.now() < snooze) return false
  const last = read(LAST_KEY)
  return !last || Date.now() - Date.parse(last) > 30 * DAY
}

export const snoozeBackup = () => write(SNOOZE_KEY, String(Date.now() + 14 * DAY))
