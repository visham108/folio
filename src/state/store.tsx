import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Backend } from '../lib/backend'
import { createLocalBackend } from '../lib/localBackend'
import { sampleLibrary } from '../lib/sample'
import { cloudConfigured, createCloudBackend, supabase } from '../lib/supabaseBackend'
import {
  emptySnapshot, mediumOf, type Edition, type Entry, type LogPoint, type Read, type Settings, type Shelf,
  type Snapshot, type Status, type Work,
} from '../lib/types'
import { nowIso, today, uid } from '../lib/util'

const MODE_KEY = 'folio.mode'
/** Preview builds (VITE_DEMO=1) skip sign-in and open on the sample library. */
export const DEMO = import.meta.env.VITE_DEMO === '1'

function getMode() {
  try { return localStorage.getItem(MODE_KEY) } catch { return null }
}
function setMode(v: string | null) {
  try { if (v) localStorage.setItem(MODE_KEY, v); else localStorage.removeItem(MODE_KEY) } catch { /* storage blocked */ }
}

export interface NewBook {
  work: Omit<Work, 'id' | 'createdAt'> & { id?: string }
  edition: Omit<Edition, 'id' | 'workId' | 'createdAt'> & { id?: string }
  status: Status
  startedOn?: string
  finishedOn?: string
  rating?: number
}

interface Store {
  ready: boolean
  backend: Backend | null
  data: Snapshot
  works: Map<string, Work>
  editions: Map<string, Edition>
  entries: Map<string, Entry>
  entryByWork: Map<string, Entry>
  editionsByWork: Map<string, Edition[]>
  readsByEntry: Map<string, Read[]>
  // session
  continueOnDevice(): void
  signOut(): Promise<void>
  // mutations
  addBook(b: NewBook): Entry
  saveWork(w: Work): void
  /** Bring shared-catalogue records into memory without writing them. */
  remember(works: Work[], editions: Edition[]): void
  saveEdition(e: Edition): void
  updateEntry(id: string, patch: Partial<Entry>): void
  removeEntry(id: string): void
  setStatus(entryId: string, s: Status): void
  startRead(entryId: string, editionId?: string): Read
  saveRead(r: Read): void
  deleteRead(id: string): void
  logProgress(readId: string, value: number): void
  saveShelf(s: Shelf): void
  deleteShelf(id: string): void
  saveSettings(s: Partial<Settings>): void
  importData(part: Partial<Snapshot>): Promise<void>
  wipe(): Promise<void>
  /** Latest read, preferring one in progress. */
  activeRead(entryId: string): Read | undefined
  editionOf(entry: Entry): Edition | undefined
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

function index<T extends { id: string }>(xs: T[]) {
  return new Map(xs.map((x) => [x.id, x]))
}

export function StoreProvider({ children, onError }: { children: ReactNode; onError: (msg: string) => void }) {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<Snapshot>(emptySnapshot)
  const be = useRef<Backend | null>(null)
  be.current = backend
  // Keep the latest callback without making boot() depend on it.
  const errRef = useRef(onError)
  errRef.current = onError

  const boot = useCallback(async () => {
    let b: Backend | null = null
    if (cloudConfigured) b = await createCloudBackend().catch(() => null)
    if (!b && (DEMO || getMode() === 'local')) b = createLocalBackend()
    if (b) {
      try {
        let snap = await b.loadAll()
        if (DEMO && b.kind === 'local' && !snap.entries.length) {
          await b.saveMany(sampleLibrary())
          snap = await b.loadAll()
        }
        setData(snap)
      } catch (e) {
        errRef.current('Could not load your library. ' + (e as Error).message)
      }
    } else setData(emptySnapshot())
    setBackend(b)
    setReady(true)
  }, [])

  useEffect(() => {
    boot()
    if (!cloudConfigured) return
    const { data: sub } = supabase().auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') boot()
    })
    return () => sub.subscription.unsubscribe()
  }, [boot])

  // Fire-and-forget persistence with a visible error if the write fails.
  const persist = useCallback(
    (f: (b: Backend) => Promise<unknown>) => {
      const b = be.current
      if (!b) return
      f(b).catch((e) => errRef.current('Couldn’t save: ' + ((e as Error).message ?? 'unknown error')))
    },
    [],
  )

  const works = useMemo(() => index(data.works), [data.works])
  const editions = useMemo(() => index(data.editions), [data.editions])
  const entries = useMemo(() => index(data.entries), [data.entries])
  const entryByWork = useMemo(() => new Map(data.entries.map((e) => [e.workId, e])), [data.entries])
  const editionsByWork = useMemo(() => {
    const m = new Map<string, Edition[]>()
    for (const e of data.editions) {
      const a = m.get(e.workId)
      if (a) a.push(e)
      else m.set(e.workId, [e])
    }
    return m
  }, [data.editions])
  const readsByEntry = useMemo(() => {
    const m = new Map<string, Read[]>()
    for (const r of data.reads) {
      const a = m.get(r.entryId)
      if (a) a.push(r)
      else m.set(r.entryId, [r])
    }
    for (const a of m.values()) a.sort((x, y) => (x.startedOn ?? x.finishedOn ?? '').localeCompare(y.startedOn ?? y.finishedOn ?? ''))
    return m
  }, [data.reads])

  const upsertIn = <K extends 'works' | 'editions' | 'entries' | 'reads' | 'logs' | 'shelves'>(key: K, item: Snapshot[K][number]) =>
    setData((d) => {
      const list = d[key] as { id: string }[]
      const i = list.findIndex((x) => x.id === (item as { id: string }).id)
      const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item]
      return { ...d, [key]: next }
    })

  const activeRead = useCallback(
    (entryId: string) => {
      const rs = readsByEntry.get(entryId) ?? []
      return rs.find((r) => r.state === 'reading' || r.state === 'paused') ?? rs[rs.length - 1]
    },
    [readsByEntry],
  )

  const store: Store = {
    ready, backend, data, works, editions, entries, entryByWork, editionsByWork, readsByEntry, activeRead,

    editionOf: (entry) => editions.get(entry.editionId ?? '') ?? editionsByWork.get(entry.workId)?.[0],

    continueOnDevice() {
      setMode('local')
      boot()
    },
    async signOut() {
      setMode(null)
      await be.current?.signOut?.()
      await boot()
    },

    addBook(b) {
      const t = nowIso()
      const existing = b.work.id ? works.get(b.work.id) : undefined
      const work: Work = existing ?? { ...b.work, id: b.work.id ?? uid(), createdAt: t }
      const edition: Edition = b.edition.id && editions.get(b.edition.id)
        ? editions.get(b.edition.id)!
        : { ...b.edition, id: b.edition.id ?? uid(), workId: work.id, createdAt: t }
      const prev = entryByWork.get(work.id)
      const entry: Entry = prev
        ? { ...prev, editionId: edition.id, status: b.status, updatedAt: t }
        : {
          id: uid(), workId: work.id, editionId: edition.id, status: b.status, rating: b.rating, favorite: false,
          owned: false, tags: [], shelfIds: [], addedAt: t, updatedAt: t,
        }
      const newRead: Read | undefined =
        b.status === 'read' || b.status === 'reading' || b.status === 'dnf'
          ? {
            id: uid(), entryId: entry.id, editionId: edition.id,
            state: b.status === 'read' ? 'finished' : b.status === 'dnf' ? 'dnf' : 'reading',
            startedOn: b.startedOn ?? (b.status === 'reading' ? today() : undefined),
            finishedOn: b.status === 'read' ? b.finishedOn ?? today() : undefined,
            rating: b.rating,
          }
          : undefined
      if (!existing) upsertIn('works', work)
      if (!editions.get(edition.id)) upsertIn('editions', edition)
      upsertIn('entries', entry)
      if (newRead) upsertIn('reads', newRead)
      persist(async (be) => {
        if (!existing) await be.saveWork(work)
        if (!editions.get(edition.id)) await be.saveEdition(edition)
        await be.saveEntry(entry)
        if (newRead) await be.saveRead(newRead)
      })
      return entry
    },

    saveWork(w) {
      upsertIn('works', w)
      persist((b) => b.saveWork(w))
    },
    remember(ws, es) {
      setData((d) => ({
        ...d,
        works: [...d.works, ...ws.filter((w) => !works.has(w.id))],
        editions: [...d.editions, ...es.filter((e) => !editions.has(e.id))],
      }))
    },
    saveEdition(e) {
      upsertIn('editions', e)
      persist((b) => b.saveEdition(e))
    },
    updateEntry(id, patch) {
      const cur = entries.get(id)
      if (!cur) return
      const next = { ...cur, ...patch, updatedAt: nowIso() }
      upsertIn('entries', next)
      persist((b) => b.saveEntry(next))
    },
    removeEntry(id) {
      setData((d) => {
        const readIds = new Set(d.reads.filter((r) => r.entryId === id).map((r) => r.id))
        return {
          ...d,
          entries: d.entries.filter((e) => e.id !== id),
          reads: d.reads.filter((r) => r.entryId !== id),
          logs: d.logs.filter((l) => !readIds.has(l.readId)),
        }
      })
      persist((b) => b.deleteEntry(id))
    },

    setStatus(entryId, status) {
      const entry = entries.get(entryId)
      if (!entry) return
      const reads = readsByEntry.get(entryId) ?? []
      const open = reads.find((r) => r.state === 'reading' || r.state === 'paused')
      let changed: Read | undefined
      if (status === 'reading') {
        if (open) changed = { ...open, state: 'reading' }
        else changed = { id: uid(), entryId, editionId: entry.editionId, state: 'reading', startedOn: today() }
      } else if (status === 'read') {
        changed = open
          ? { ...open, state: 'finished', finishedOn: today(), progress: undefined }
          : reads.some((r) => r.state === 'finished')
            ? undefined
            : { id: uid(), entryId, editionId: entry.editionId, state: 'finished', finishedOn: today() }
      } else if ((status === 'dnf' || status === 'paused') && open) {
        changed = { ...open, state: status }
      }
      if (changed) {
        const c = changed
        upsertIn('reads', c)
        persist((b) => b.saveRead(c))
      }
      store.updateEntry(entryId, { status })
    },

    startRead(entryId, editionId) {
      const entry = entries.get(entryId)!
      const r: Read = { id: uid(), entryId, editionId: editionId ?? entry.editionId, state: 'reading', startedOn: today() }
      upsertIn('reads', r)
      persist((b) => b.saveRead(r))
      store.updateEntry(entryId, { status: 'reading', editionId: r.editionId })
      return r
    },
    saveRead(r) {
      upsertIn('reads', r)
      persist((b) => b.saveRead(r))
      // Keep the pile in sync with the latest read.
      const entry = entries.get(r.entryId)
      if (!entry) return
      const all = (readsByEntry.get(r.entryId) ?? []).filter((x) => x.id !== r.id).concat(r)
      const open = all.find((x) => x.state === 'reading')
      const status: Status = open ? 'reading' : r.state === 'finished' ? 'read' : r.state === 'dnf' ? 'dnf' : r.state === 'paused' ? 'paused' : entry.status
      const patch: Partial<Entry> = {}
      if (status !== entry.status) patch.status = status
      if (r.rating && r.state === 'finished') patch.rating = r.rating
      if (Object.keys(patch).length) store.updateEntry(entry.id, patch)
    },
    deleteRead(id) {
      setData((d) => ({ ...d, reads: d.reads.filter((r) => r.id !== id), logs: d.logs.filter((l) => l.readId !== id) }))
      persist((b) => b.deleteRead(id))
    },
    logProgress(readId, value) {
      const r = data.reads.find((x) => x.id === readId)
      if (!r) return
      const entry = entries.get(r.entryId)
      const ed = editions.get(r.editionId ?? entry?.editionId ?? '')
      const delta = value - (r.progress ?? 0)
      const next: Read = { ...r, progress: value }
      upsertIn('reads', next)
      persist((b) => b.saveRead(next))
      if (delta !== 0) {
        // One log row per read per day; repeated updates adjust it.
        const day = today()
        const existing = data.logs.find((l) => l.readId === readId && l.on === day)
        const log: LogPoint = existing
          ? { ...existing, amount: existing.amount + delta }
          : { id: uid(), readId, on: day, amount: delta, medium: mediumOf(ed?.format) }
        upsertIn('logs', log)
        persist((b) => b.saveLog(log))
      }
    },

    saveShelf(s) {
      upsertIn('shelves', s)
      persist((b) => b.saveShelf(s))
    },
    deleteShelf(id) {
      setData((d) => ({
        ...d,
        shelves: d.shelves.filter((s) => s.id !== id),
        entries: d.entries.map((e) => (e.shelfIds.includes(id) ? { ...e, shelfIds: e.shelfIds.filter((x) => x !== id) } : e)),
      }))
      persist((b) => b.deleteShelf(id))
    },
    saveSettings(patch) {
      const next = { ...data.settings, ...patch }
      setData((d) => ({ ...d, settings: next }))
      persist((b) => b.saveSettings(next))
    },
    async importData(part) {
      const b = be.current
      if (!b) return
      await b.saveMany(part)
      setData(await b.loadAll())
    },
    async wipe() {
      const b = be.current
      if (!b) return
      await b.wipe()
      setData(await b.loadAll())
    },
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
