import type { Backend } from './backend'
import type { Snapshot } from './types'

/**
 * Offline support for the signed-in (cloud) library:
 *  - the last library loaded is kept on this device, so Folio opens offline;
 *  - changes made while offline go into an outbox and are sent, in order,
 *    when the connection returns.
 */

const DB = 'folio-offline'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
// Where browser storage is blocked (some private windows), keep things in memory for this visit.
const memory = new Map<string, unknown>()
async function get<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key)
      r.onsuccess = () => resolve(r.result as T | undefined)
      r.onerror = () => reject(r.error)
    })
  } catch {
    return memory.get(key) as T | undefined
  }
}
async function set(key: string, value: unknown): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    memory.set(key, value)
  }
}

export const cacheSnapshot = (userId: string, snap: Snapshot) => set(`snapshot:${userId}`, snap).catch(() => {})
/** Removes this device's copy of a library (on sign-out). Unsent changes in the outbox are kept. */
export async function forgetSnapshot(userId: string): Promise<void> {
  const db = await open().catch(() => null)
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(`snapshot:${userId}`)
    tx.oncomplete = tx.onerror = () => resolve()
  })
}
export const readSnapshot = (userId: string) => get<Snapshot>(`snapshot:${userId}`).catch(() => undefined)

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String((e as { message?: string })?.message ?? e)
  return /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET_DISCONNECTED/i.test(msg)
}

/** Worth trying again later: no connection, the server is busy or down, or the sign-in needs renewing. */
export function isTemporary(e: unknown): boolean {
  if (isNetworkError(e)) return true
  const err = e as { code?: string; status?: number; message?: string }
  if (err?.status && (err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500)) return true
  return err?.code === 'PGRST301' || err?.code === 'PGRST303' || /JWT|token.*expired/i.test(err?.message ?? '')
}

/** Writes that can wait for the connection to come back. */
const QUEUEABLE = ['saveWork', 'saveEdition', 'saveEntry', 'deleteEntry', 'saveRead', 'deleteRead', 'saveLog', 'saveShelf', 'deleteShelf', 'saveSettings', 'saveMany'] as const
type Queueable = (typeof QUEUEABLE)[number]
interface Pending { method: Queueable; args: unknown[] }

export interface OfflineBackend extends Backend {
  /** Sends queued changes. Returns how many went through. */
  flush(): Promise<number>
  pending(): number
  /** The last loadAll() came from this device's saved copy, not the server. */
  fromCache: boolean
}

/** Every tab shares one outbox; the lock stops two of them editing or sending it at once. */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request(name, fn) : fn()
}

export async function withOffline(
  inner: Backend,
  userId: string,
  hooks: {
    onQueue: (n: number) => void
    onDropped: (msg: string) => void
    /** Whether the browser is still signed in as this user; nothing is sent (or dropped) otherwise. */
    signedInAs: () => Promise<string | null>
    /** Called after queued changes went through, so the screen can refresh from the server. */
    onSynced?: () => void
  },
): Promise<OfflineBackend> {
  const key = `outbox:${userId}`
  const lockName = `folio-outbox:${userId}`
  const read = async () => (await get<Pending[]>(key).catch(() => undefined)) ?? []
  // A cached count for the UI; the stored outbox is the source of truth.
  let count = (await read()).length
  let flushing: Promise<number> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 5000
  const report = (n: number) => { count = n; hooks.onQueue(n) }

  const enqueue = (method: Queueable, args: unknown[]) =>
    withLock(lockName, async () => {
      const box = await read()
      box.push({ method, args: JSON.parse(JSON.stringify(args)) })
      await set(key, box)
      report(box.length)
      scheduleRetry()
    })

  // Keep trying in the background (5s, 10s, 20s… up to 5 minutes) until the outbox is empty.
  const scheduleRetry = () => {
    if (retryTimer) return
    retryTimer = setTimeout(async () => {
      retryTimer = undefined
      const sent = await wrapped.flush().catch(() => 0)
      if (count) { retryDelay = Math.min(retryDelay * 2, 300000); scheduleRetry() }
      else retryDelay = 5000
      if (sent) hooks.onSynced?.()
    }, retryDelay)
  }

  const call = (method: Queueable, args: unknown[]) => (inner[method] as (...a: unknown[]) => Promise<unknown>)(...args)

  const wrapped = { ...inner, fromCache: false } as OfflineBackend
  for (const m of QUEUEABLE) {
    ;(wrapped as unknown as Record<string, unknown>)[m] = async (...args: unknown[]) => {
      // Keep order: once something is queued, later changes queue behind it.
      if (count || (typeof navigator !== 'undefined' && navigator.onLine === false)) return enqueue(m, args)
      try {
        return await call(m, args)
      } catch (e) {
        if (isTemporary(e)) return enqueue(m, args)
        throw e
      }
    }
  }

  const needsNetwork = (what: string) => async () => { throw new Error(`You’re offline. ${what} needs a connection.`) }
  const softRead = <T,>(fn: (...a: never[]) => Promise<T>, fallback: T) => async (...a: never[]) => {
    try { return await fn(...a) } catch (e) { if (isNetworkError(e)) return fallback; throw e }
  }

  wrapped.loadAll = async () => {
    try {
      // Signed out meanwhile (e.g. the session lapsed offline): reading now would return an
      // empty library, so use this device's copy until sign-in is sorted out.
      if ((await hooks.signedInAs().catch(() => null)) !== userId) throw new Error('Failed to fetch (not signed in)')
      if (count) await wrapped.flush()
      const snap = await inner.loadAll()
      cacheSnapshot(userId, snap)
      wrapped.fromCache = false
      return snap
    } catch (e) {
      if (!isTemporary(e)) throw e
      const cached = await readSnapshot(userId)
      if (cached) { wrapped.fromCache = true; return cached }
      throw new Error('You’re offline and this device has no saved copy of your library yet.')
    }
  }
  wrapped.searchCatalog = softRead(inner.searchCatalog, { works: [], editions: [] })
  wrapped.catalogueFor = softRead(inner.catalogueFor, { works: [], editions: [] })
  wrapped.seriesWorks = softRead(inner.seriesWorks, { works: [], editions: [] })
  wrapped.fetchWork = softRead(inner.fetchWork, null)
  wrapped.sharedWorks = softRead(inner.sharedWorks, [])
  wrapped.history = softRead(inner.history, [])
  for (const [m, what] of [['uploadCover', 'Uploading a cover'], ['mergeWorks', 'Merging books'], ['deleteEdition', 'Removing an edition'], ['wipe', 'Deleting your library']] as const) {
    const orig = inner[m] as (...a: unknown[]) => Promise<unknown>
    ;(wrapped as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return needsNetwork(what)()
      return orig(...a)
    }
  }

  wrapped.pending = () => count
  wrapped.flush = () => {
    flushing ??= withLock(lockName, async () => {
      let sent = 0
      // Only send as the account these changes belong to; otherwise wait, keeping them.
      if ((await hooks.signedInAs().catch(() => null)) !== userId) return 0
      let box = await read()
      while (box.length) {
        const next = box[0]
        try {
          await call(next.method, next.args)
        } catch (e) {
          if (isTemporary(e)) break
          // The server refused it (e.g. the book was removed meanwhile): don't block everything behind it.
          hooks.onDropped((e as Error).message ?? 'unknown error')
        }
        box = box.slice(1)
        sent++
        await set(key, box)
        report(box.length)
      }
      report(box.length)
      return sent
    }).finally(() => { flushing = null })
    return flushing
  }

  report(count)
  if (count) scheduleRetry()
  return wrapped
}
