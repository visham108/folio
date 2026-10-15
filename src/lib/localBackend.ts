import type { Backend } from './backend'
import { mergeEntryFields } from './merge'
import { emptySnapshot, type Snapshot } from './types'

/** On-device storage (IndexedDB). Used before sign-in or when no Supabase project is configured. */

const DB = 'folio'
const STORE = 'kv'
const KEY = 'snapshot'
/** Tells other open tabs that the on-device library changed. */
export const LOCAL_CHANNEL = 'folio-local'

// One connection for the page's lifetime, so a write can start straight away when the tab closes.
let dbHandle: IDBDatabase | null = null
let dbOpening: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbHandle) return Promise.resolve(dbHandle)
  dbOpening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      dbHandle = req.result
      dbHandle.onclose = () => { dbHandle = null; dbOpening = null }
      resolve(dbHandle)
    }
    req.onerror = () => { dbOpening = null; reject(req.error) }
  })
  return dbOpening
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.commit?.()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Saving on this device failed (is the disk full?)'))
  })
}

/** Runs fn while holding a lock shared by every tab, so two tabs never interleave a read-modify-write. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('folio-local', fn) : fn()
}

function normalize(stored?: Partial<Snapshot>): Snapshot {
  const s = { ...emptySnapshot(), ...(stored ?? {}) }
  s.settings = { ...emptySnapshot().settings, ...(stored?.settings ?? {}) }
  return s
}

type ListKey = 'works' | 'editions' | 'entries' | 'reads' | 'logs' | 'shelves'
type Op = (s: Snapshot) => void
interface Pending { op: Op; done: () => void; fail: (e: unknown) => void }

function upsertInto<K extends ListKey>(s: Snapshot, key: K, item: Snapshot[K][number]) {
  const list = s[key] as { id: string }[]
  const i = list.findIndex((x) => x.id === (item as { id: string }).id)
  if (i >= 0) list[i] = item as { id: string }
  else list.push(item as { id: string })
}

export function createLocalBackend(): Backend {
  // This tab's view of the library. Writes are recorded as small changes and applied to
  // whatever is stored at the time, so changes made in another tab aren't overwritten.
  let snap: Snapshot | null = null
  let queue: Pending[] = []
  let pumping: Promise<void> | null = null

  const ensure = async () => (snap ??= normalize(await idbGet<Snapshot>(KEY).catch(() => undefined)))

  const pump = () => {
    pumping ??= (async () => {
      while (queue.length) {
        const batch = queue
        queue = []
        try {
          await withLock(async () => {
            const stored = normalize(await idbGet<Snapshot>(KEY))
            for (const p of batch) p.op(stored)
            await idbSet(KEY, stored)
          })
          batch.forEach((p) => p.done())
          try { new BroadcastChannel(LOCAL_CHANNEL).postMessage('changed') } catch { /* not supported */ }
        } catch (e) {
          batch.forEach((p) => p.fail(e))
        }
      }
      pumping = null
    })()
    return pumping
  }

  /** Applies a change here straight away and saves it; resolves once it's on disk. */
  const apply = async (op: Op) => {
    op(await ensure())
    return new Promise<void>((done, fail) => {
      queue.push({ op, done, fail })
      void pump()
    })
  }

  const upsert = <K extends ListKey>(key: K, item: Snapshot[K][number]) => {
    const copy = structuredClone(item)
    return apply((s) => upsertInto(s, key, structuredClone(copy)))
  }

  return {
    kind: 'local',
    userLabel: 'This device',
    // On this device everything is yours to edit.
    isAdmin: true,
    async loadAll() {
      // Pick up anything another tab saved, after our own pending writes land.
      while (pumping) await pumping
      snap = normalize(await idbGet<Snapshot>(KEY).catch(() => undefined))
      return structuredClone(snap)
    },
    saveWork: (w) => upsert('works', w),
    saveEdition: (e) => upsert('editions', e),
    saveEntry: (e) => upsert('entries', e),
    deleteEntry: (id) =>
      apply((s) => {
        const readIds = new Set(s.reads.filter((r) => r.entryId === id).map((r) => r.id))
        s.entries = s.entries.filter((e) => e.id !== id)
        s.reads = s.reads.filter((r) => !readIds.has(r.id))
        s.logs = s.logs.filter((l) => !readIds.has(l.readId))
      }),
    saveRead: (r) => upsert('reads', r),
    deleteRead: (id) =>
      apply((s) => {
        s.reads = s.reads.filter((r) => r.id !== id)
        s.logs = s.logs.filter((l) => l.readId !== id)
      }),
    saveLog: (l) => upsert('logs', l),
    deleteEdition: (id) =>
      apply((s) => {
        s.editions = s.editions.filter((e) => e.id !== id)
        s.entries = s.entries.map((e) => (e.editionId === id ? { ...e, editionId: undefined } : e))
        s.reads = s.reads.map((r) => (r.editionId === id ? { ...r, editionId: undefined } : r))
      }),
    mergeWorks: (fromId, intoId) =>
      apply((s) => {
        s.editions = s.editions.map((e) => (e.workId === fromId ? { ...e, workId: intoId } : e))
        const keep = s.entries.find((e) => e.workId === intoId)
        const moving = s.entries.find((e) => e.workId === fromId)
        if (moving && keep) {
          // Keep what you'd recorded on the duplicate: rating, review, tags, shelves…
          Object.assign(keep, mergeEntryFields(keep, moving))
          s.reads = s.reads.map((r) => (r.entryId === moving.id ? { ...r, entryId: keep.id } : r))
          s.entries = s.entries.filter((e) => e.id !== moving.id)
        } else if (moving) moving.workId = intoId
        s.works = s.works.filter((w) => w.id !== fromId)
      }),
    async history() {
      return []
    },
    saveShelf: (x) => upsert('shelves', x),
    deleteShelf: (id) =>
      apply((s) => {
        s.shelves = s.shelves.filter((x) => x.id !== id)
        s.entries = s.entries.map((e) => (e.shelfIds.includes(id) ? { ...e, shelfIds: e.shelfIds.filter((x) => x !== id) } : e))
      }),
    saveSettings: (settings) => {
      const copy = structuredClone(settings)
      return apply((s) => { s.settings = structuredClone(copy) })
    },
    async saveMany(part) {
      const copy = structuredClone(part)
      await apply((s) => {
        for (const key of ['works', 'editions', 'shelves', 'entries', 'reads', 'logs'] as ListKey[]) {
          for (const item of copy[key] ?? []) upsertInto(s, key, structuredClone(item) as never)
        }
      })
    },
    async catalogueFor() {
      return { works: [], editions: [] }
    },
    async seriesWorks() {
      // On this device the only books are your own, which the app already has.
      return { works: [], editions: [] }
    },
    async fetchWork() {
      return null
    },
    async sharedWorks() {
      return []
    },
    async searchCatalog() {
      // On-device there is no shared catalogue beyond the user's own books,
      // which the UI already matches against.
      return { works: [], editions: [] }
    },
    async uploadCover(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(blob)
      })
    },
    async wipe() {
      queue.forEach((p) => p.done())
      queue = []
      while (pumping) await pumping
      snap = emptySnapshot()
      await withLock(() => idbSet(KEY, snap))
      try { new BroadcastChannel(LOCAL_CHANNEL).postMessage('changed') } catch { /* not supported */ }
    },
  }
}
