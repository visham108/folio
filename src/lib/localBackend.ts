import type { Backend } from './backend'
import { mergeEntryFields } from './merge'
import { planMerge } from './mergePlan'
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

/** A change to the on-device library, as plain data so it can be written down before it's saved. */
type Op =
  | { t: 'upsert'; key: ListKey; items: { id: string }[] }
  | { t: 'deleteEntry'; id: string }
  | { t: 'deleteRead'; id: string }
  | { t: 'deleteEdition'; id: string }
  | { t: 'deleteShelf'; id: string }
  | { t: 'merge'; from: string; into: string; absorb?: boolean }
  | { t: 'settings'; settings: Snapshot['settings'] }
interface Pending { op: Op; done: () => void; fail: (e: unknown) => void }

function applyOp(s: Snapshot, op: Op) {
  switch (op.t) {
    case 'upsert':
      for (const item of op.items) {
        const list = s[op.key] as { id: string }[]
        const i = list.findIndex((x) => x.id === item.id)
        const copy = structuredClone(item)
        if (i >= 0) list[i] = copy
        else list.push(copy)
      }
      break
    case 'deleteEntry': {
      const readIds = new Set(s.reads.filter((r) => r.entryId === op.id).map((r) => r.id))
      s.entries = s.entries.filter((e) => e.id !== op.id)
      s.reads = s.reads.filter((r) => !readIds.has(r.id))
      s.logs = s.logs.filter((l) => !readIds.has(l.readId))
      break
    }
    case 'deleteRead':
      s.reads = s.reads.filter((r) => r.id !== op.id)
      s.logs = s.logs.filter((l) => l.readId !== op.id)
      break
    case 'deleteEdition':
      s.editions = s.editions.filter((e) => e.id !== op.id)
      s.entries = s.entries.map((e) => (e.editionId === op.id ? { ...e, editionId: undefined } : e))
      s.reads = s.reads.map((r) => (r.editionId === op.id ? { ...r, editionId: undefined } : r))
      break
    case 'deleteShelf':
      s.shelves = s.shelves.filter((x) => x.id !== op.id)
      s.entries = s.entries.map((e) => (e.shelfIds.includes(op.id) ? { ...e, shelfIds: e.shelfIds.filter((x) => x !== op.id) } : e))
      break
    case 'merge': {
      const keep = s.entries.find((e) => e.workId === op.into)
      const moving = s.entries.find((e) => e.workId === op.from)
      const dupWork = s.works.find((w) => w.id === op.from)
      const keepWork = s.works.find((w) => w.id === op.into)
      if (dupWork && keepWork) {
        // Same rules as the shared catalogue (mergePlan / merge_works).
        const plan = planMerge({
          dup: dupWork, keep: keepWork,
          dupEditions: s.editions.filter((e) => e.workId === op.from), keepEditions: s.editions.filter((e) => e.workId === op.into),
          myKeepEditionId: keep?.editionId, myDupEditionId: moving?.editionId,
        })
        s.works = s.works.map((w) => (w.id === op.into ? plan.work : w))
        if (op.absorb) {
          const results = new Map(plan.groups.map((g) => [g.into.id, g.result]))
          const to = (id: string) => plan.target.get(id) ?? id
          const gone = new Set(plan.groups.flatMap((g) => g.from.map((e) => e.id)))
          s.editions = s.editions.filter((e) => !gone.has(e.id)).map((e) => results.get(e.id) ?? e)
          // In place: `keep` and `moving` above must stay the objects in the list.
          for (const e of s.entries) if (e.editionId && gone.has(e.editionId)) e.editionId = to(e.editionId)
          s.reads = s.reads.map((r) => (r.editionId && gone.has(r.editionId) ? { ...r, editionId: to(r.editionId) } : r))
        }
      }
      s.editions = s.editions.map((e) => (e.workId === op.from ? { ...e, workId: op.into } : e))
      if (moving && keep) {
        // Keep what you'd recorded on the duplicate: rating, review, tags, shelves…
        Object.assign(keep, mergeEntryFields(keep, moving))
        s.reads = s.reads.map((r) => (r.entryId === moving.id ? { ...r, entryId: keep.id } : r))
        s.entries = s.entries.filter((e) => e.id !== moving.id)
      } else if (moving) moving.workId = op.into
      s.works = s.works.filter((w) => w.id !== op.from)
      break
    }
    case 'settings':
      s.settings = structuredClone(op.settings)
      break
  }
}

// Changes not yet on disk are also written to localStorage the instant they're made (that's
// synchronous), so closing or reloading the tab mid-save can't lose them; the next load replays them.
const JOURNAL = 'folio.journal.'
const tabJournal = JOURNAL + Math.random().toString(36).slice(2)
function journal(ops: Op[]) {
  try { if (ops.length) localStorage.setItem(tabJournal, JSON.stringify(ops)); else localStorage.removeItem(tabJournal) } catch { /* storage full or blocked */ }
}
function leftoverJournals(): { key: string; ops: Op[] }[] {
  const out: { key: string; ops: Op[] }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(JOURNAL) || key === tabJournal) continue
      try { out.push({ key, ops: JSON.parse(localStorage.getItem(key) ?? '[]') }) } catch { /* unreadable */ }
    }
  } catch { /* storage blocked */ }
  return out
}

export function createLocalBackend(): Backend {
  // This tab's view of the library. Writes are recorded as small changes and applied to
  // whatever is stored at the time, so changes made in another tab aren't overwritten.
  let snap: Snapshot | null = null
  let queue: Pending[] = []
  let unsaved: Op[] = []
  let pumping: Promise<void> | null = null

  const load = async () => {
    const stored = normalize(await idbGet<Snapshot>(KEY).catch(() => undefined))
    // Changes a closed tab didn't get to save.
    const left = leftoverJournals()
    if (left.length) {
      for (const j of left) for (const op of j.ops) applyOp(stored, op)
      await withLock(() => idbSet(KEY, stored)).catch(() => {})
      try { left.forEach((j) => localStorage.removeItem(j.key)) } catch { /* blocked */ }
    }
    return stored
  }
  const ensure = async () => (snap ??= await load())

  const pump = () => {
    pumping ??= (async () => {
      while (queue.length) {
        const batch = queue
        queue = []
        try {
          await withLock(async () => {
            const stored = normalize(await idbGet<Snapshot>(KEY))
            for (const p of batch) applyOp(stored, p.op)
            await idbSet(KEY, stored)
          })
          unsaved = unsaved.slice(batch.length)
          journal(unsaved)
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
  const apply = (op: Op) => {
    // Written down synchronously, before anything else can interrupt.
    unsaved.push(op)
    journal(unsaved)
    return new Promise<void>((done, fail) => {
      void ensure().then((s) => {
        applyOp(s, op)
        queue.push({ op, done, fail })
        void pump()
      }, fail)
    })
  }

  const upsert = <K extends ListKey>(key: K, item: Snapshot[K][number]) =>
    apply({ t: 'upsert', key, items: [structuredClone(item) as { id: string }] })

  return {
    kind: 'local',
    userLabel: 'This device',
    // On this device everything is yours to edit.
    isAdmin: true,
    async loadAll() {
      // Pick up anything another tab saved, after our own pending writes land.
      await ensure()
      while (pumping) await pumping
      snap = await load()
      return structuredClone(snap)
    },
    saveWork: (w) => upsert('works', w),
    saveEdition: (e) => upsert('editions', e),
    saveEntry: (e) => upsert('entries', e),
    deleteEntry: (id) => apply({ t: 'deleteEntry', id }),
    saveRead: (r) => upsert('reads', r),
    deleteRead: (id) => apply({ t: 'deleteRead', id }),
    saveLog: (l) => upsert('logs', l),
    deleteEdition: (id) => apply({ t: 'deleteEdition', id }),
    mergeWorks: (fromId, intoId, opts) => apply({ t: 'merge', from: fromId, into: intoId, absorb: !!opts?.absorb }),
    async history() {
      return []
    },
    saveShelf: (x) => upsert('shelves', x),
    deleteShelf: (id) => apply({ t: 'deleteShelf', id }),
    saveSettings: (settings) => apply({ t: 'settings', settings: structuredClone(settings) }),
    async saveMany(part) {
      const saving: Promise<void>[] = []
      for (const key of ['works', 'editions', 'shelves', 'entries', 'reads', 'logs'] as ListKey[]) {
        const items = (part[key] ?? []) as { id: string }[]
        if (items.length) saving.push(apply({ t: 'upsert', key, items: structuredClone(items) }))
      }
      await Promise.all(saving)
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
      unsaved = []
      journal([])
      while (pumping) await pumping
      snap = emptySnapshot()
      await withLock(() => idbSet(KEY, snap))
      try { new BroadcastChannel(LOCAL_CHANNEL).postMessage('changed') } catch { /* not supported */ }
    },
  }
}
