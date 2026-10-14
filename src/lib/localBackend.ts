import type { Backend } from './backend'
import { emptySnapshot, type Snapshot } from './types'

/** On-device storage (IndexedDB). Used before sign-in or when no Supabase project is configured. */

const DB = 'folio'
const STORE = 'kv'
const KEY = 'snapshot'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
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
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

type ListKey = 'works' | 'editions' | 'entries' | 'reads' | 'logs' | 'shelves'

export function createLocalBackend(): Backend {
  let snap: Snapshot | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const ensure = async () => {
    if (!snap) {
      const stored = await idbGet<Snapshot>(KEY).catch(() => undefined)
      snap = { ...emptySnapshot(), ...(stored ?? {}) }
      snap.settings = { ...emptySnapshot().settings, ...(stored?.settings ?? {}) }
    }
    return snap
  }
  // Coalesce bursts of writes (e.g. dragging a progress slider).
  const persist = () => {
    clearTimeout(timer)
    timer = setTimeout(() => snap && idbSet(KEY, snap).catch(console.error), 120)
  }
  const upsert = async <K extends ListKey>(key: K, item: Snapshot[K][number]) => {
    const s = await ensure()
    const list = s[key] as { id: string }[]
    const i = list.findIndex((x) => x.id === (item as { id: string }).id)
    if (i >= 0) list[i] = item as { id: string }
    else list.push(item as { id: string })
    persist()
  }
  const remove = async (key: ListKey, id: string) => {
    const s = await ensure()
    ;(s[key] as { id: string }[]) = (s[key] as { id: string }[]).filter((x) => x.id !== id)
    persist()
  }

  return {
    kind: 'local',
    userLabel: 'This device',
    async loadAll() {
      return structuredClone(await ensure())
    },
    saveWork: (w) => upsert('works', w),
    saveEdition: (e) => upsert('editions', e),
    saveEntry: (e) => upsert('entries', e),
    deleteEntry: async (id) => {
      const s = await ensure()
      const readIds = new Set(s.reads.filter((r) => r.entryId === id).map((r) => r.id))
      s.reads = s.reads.filter((r) => !readIds.has(r.id))
      s.logs = s.logs.filter((l) => !readIds.has(l.readId))
      await remove('entries', id)
    },
    saveRead: (r) => upsert('reads', r),
    deleteRead: async (id) => {
      const s = await ensure()
      s.logs = s.logs.filter((l) => l.readId !== id)
      await remove('reads', id)
    },
    saveLog: (l) => upsert('logs', l),
    saveShelf: (x) => upsert('shelves', x),
    deleteShelf: (id) => remove('shelves', id),
    async saveSettings(settings) {
      const s = await ensure()
      s.settings = settings
      persist()
    },
    async saveMany(part) {
      for (const key of ['works', 'editions', 'entries', 'reads', 'logs', 'shelves'] as ListKey[]) {
        for (const item of part[key] ?? []) await upsert(key, item as never)
      }
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
      snap = emptySnapshot()
      await idbSet(KEY, snap)
    },
  }
}
