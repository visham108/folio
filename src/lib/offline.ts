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
async function get<T>(key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })
}
async function set(key: string, value: unknown): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
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

/** Writes that can wait for the connection to come back. */
const QUEUEABLE = ['saveWork', 'saveEdition', 'saveEntry', 'deleteEntry', 'saveRead', 'deleteRead', 'saveLog', 'saveShelf', 'deleteShelf', 'saveSettings', 'saveMany'] as const
type Queueable = (typeof QUEUEABLE)[number]
interface Pending { method: Queueable; args: unknown[] }

export interface OfflineBackend extends Backend {
  /** Sends queued changes. Returns how many went through. */
  flush(): Promise<number>
  pending(): number
}

export async function withOffline(
  inner: Backend,
  userId: string,
  hooks: { onQueue: (n: number) => void; onDropped: (msg: string) => void },
): Promise<OfflineBackend> {
  const key = `outbox:${userId}`
  let outbox: Pending[] = (await get<Pending[]>(key).catch(() => undefined)) ?? []
  let flushing: Promise<number> | null = null
  const save = () => { hooks.onQueue(outbox.length); return set(key, outbox).catch(() => {}) }

  const enqueue = async (method: Queueable, args: unknown[]) => {
    outbox.push({ method, args: JSON.parse(JSON.stringify(args)) })
    await save()
  }

  const call = (method: Queueable, args: unknown[]) => (inner[method] as (...a: unknown[]) => Promise<void>)(...args)

  const wrapped = { ...inner } as OfflineBackend
  for (const m of QUEUEABLE) {
    ;(wrapped as unknown as Record<string, unknown>)[m] = async (...args: unknown[]) => {
      // Keep order: once something is queued, later changes queue behind it.
      if (outbox.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return enqueue(m, args)
      try {
        await call(m, args)
      } catch (e) {
        if (isNetworkError(e)) return enqueue(m, args)
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
      if (outbox.length) await wrapped.flush()
      const snap = await inner.loadAll()
      cacheSnapshot(userId, snap)
      return snap
    } catch (e) {
      if (!isNetworkError(e)) throw e
      const cached = await readSnapshot(userId)
      if (cached) return cached
      throw new Error('You’re offline and this device has no saved copy of your library yet.')
    }
  }
  wrapped.searchCatalog = softRead(inner.searchCatalog, { works: [], editions: [] })
  wrapped.catalogueFor = softRead(inner.catalogueFor, { works: [], editions: [] })
  wrapped.seriesWorks = softRead(inner.seriesWorks, { works: [], editions: [] })
  wrapped.fetchWork = softRead(inner.fetchWork, null)
  wrapped.history = softRead(inner.history, [])
  for (const [m, what] of [['uploadCover', 'Uploading a cover'], ['mergeWorks', 'Merging books'], ['deleteEdition', 'Removing an edition'], ['wipe', 'Deleting your library']] as const) {
    const orig = inner[m] as (...a: unknown[]) => Promise<unknown>
    ;(wrapped as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return needsNetwork(what)()
      return orig(...a)
    }
  }

  wrapped.pending = () => outbox.length
  wrapped.flush = () => {
    if (flushing) return flushing
    flushing = (async () => {
      let sent = 0
      while (outbox.length) {
        const next = outbox[0]
        try {
          await call(next.method, next.args)
        } catch (e) {
          if (isNetworkError(e)) break
          // The server refused it (e.g. the book was removed meanwhile): don't block everything behind it.
          hooks.onDropped((e as Error).message ?? 'unknown error')
        }
        outbox.shift()
        sent++
        await save()
      }
      flushing = null
      return sent
    })()
    return flushing
  }

  hooks.onQueue(outbox.length)
  return wrapped
}
