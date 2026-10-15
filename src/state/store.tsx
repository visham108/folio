import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Backend, IdRemap } from '../lib/backend'
import { createLocalBackend, LOCAL_CHANNEL } from '../lib/localBackend'
import { sampleLibrary } from '../lib/sample'
import { mergeLibrary } from '../lib/merge'
import { cacheSnapshot, forgetSnapshot, withOffline, type OfflineBackend } from '../lib/offline'
import { cloudConfigured, createCloudBackend, sessionUserId, supabase } from '../lib/supabaseBackend'
import {
  emptySnapshot, mediumOf, type Edition, type Entry, type LogPoint, type Read, type Settings, type Shelf,
  type Snapshot, type Status, type Work,
} from '../lib/types'
import { nowIso, today, uid } from '../lib/util'

const MODE_KEY = 'folio.mode'
const DEVICE_DISMISSED_KEY = 'folio.deviceBooksDismissed'
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
  /** The work and edition already exist in the shared catalogue: show them, don't save them again. */
  inCatalogue?: boolean
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
  /** Whether the current user may edit this catalogue record. */
  canEdit(rec?: { createdBy?: string }): boolean
  isAdmin: boolean
  userId?: string
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
  /** Removes a book from your library; returns a function that puts it back. */
  removeEntry(id: string): () => void
  deleteEdition(id: string): Promise<void>
  mergeWorks(fromId: string, intoId: string): Promise<void>
  setStatus(entryId: string, s: Status): void
  /** A new read, not yet saved: open it in the editor and save it from there. */
  draftRead(entryId: string, editionId?: string): Read
  startRead(entryId: string, editionId?: string): Read
  /** Switch which edition is yours, carrying a read in progress across. */
  chooseEdition(entryId: string, editionId: string): void
  /** Where a book went if it was matched to an existing catalogue book after adding. */
  movedTo(workId: string): string | undefined
  saveRead(r: Read): void
  deleteRead(id: string): void
  logProgress(readId: string, value: number): void
  saveShelf(s: Shelf): void
  deleteShelf(id: string): void
  saveSettings(s: Partial<Settings>): void
  importData(part: Partial<Snapshot>): Promise<void>
  /** Fold a whole library (an export, or books saved on this device) in without duplicates. */
  mergeIn(src: Pick<Snapshot, 'works' | 'editions' | 'entries' | 'reads' | 'logs' | 'shelves'>): Promise<{ books: number; matched: number }>
  /** Books saved on this device before signing in (cloud only). */
  deviceBooks: number
  /** Changes made offline, waiting to sync. */
  pending: number
  moveDeviceBooks(): Promise<number>
  dismissDeviceBooks(discard: boolean): Promise<void>
  /** Bring a catalogue book that isn't on your shelves into view (shared links). */
  loadWork(id: string): Promise<boolean>
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
  const [data, setDataState] = useState<Snapshot>(emptySnapshot)
  // The latest library, updated synchronously, so changes made in quick succession (or from
  // timers set up on an earlier render) always build on each other instead of a stale copy.
  const live = useRef<Snapshot>(data)
  const setData = useCallback((next: Snapshot | ((d: Snapshot) => Snapshot)) => {
    live.current = typeof next === 'function' ? next(live.current) : next
    setDataState(live.current)
  }, [])
  // Books whose id changed when they were matched to the shared catalogue (old id → new id).
  const moved = useRef(new Map<string, string>())
  const [deviceBooks, setDeviceBooks] = useState(0)
  const [pending, setPending] = useState(0)
  const be = useRef<Backend | null>(null)
  be.current = backend
  // Keep the latest callback without making boot() depend on it.
  const errRef = useRef(onError)
  errRef.current = onError

  const boot = useCallback(async () => {
    let b: Backend | null = null
    if (cloudConfigured) {
      const cloud = await createCloudBackend().catch(() => null)
      if (cloud) {
        // Signed in: forget any earlier "use this device" choice, so signing out shows the sign-in screen.
        setMode(null)
        const ob: OfflineBackend = await withOffline(cloud, cloud.userId!, {
          onQueue: setPending,
          onDropped: (msg) => errRef.current('A change made offline couldn’t be saved: ' + msg),
          signedInAs: sessionUserId,
          onSynced: () => { if (be.current === ob) ob.loadAll().then(setData).catch(() => {}) },
        })
        b = ob
      }
    }
    if (!b && (DEMO || getMode() === 'local')) b = createLocalBackend()
    if (b) {
      try {
        let snap = await b.loadAll()
        if (DEMO && b.kind === 'local' && !snap.entries.length) {
          await b.saveMany(sampleLibrary())
          snap = await b.loadAll()
        }
        setData(snap)
        // Books added before signing in are still in this browser: offer to move them.
        if (b.kind === 'cloud' && !DEMO) {
          const local = await createLocalBackend().loadAll().catch(() => null)
          let dismissed = 0
          try { dismissed = Number(localStorage.getItem(DEVICE_DISMISSED_KEY) ?? 0) } catch { /* storage blocked */ }
          const n = local?.entries.length ?? 0
          setDeviceBooks(n > 0 && n !== dismissed ? n : 0)
        }
      } catch (e) {
        errRef.current('Could not load your library. ' + (e as Error).message)
      }
    } else setData(emptySnapshot())
    setBackend(b)
    setReady(true)
  }, [setData])

  // Back online (or back to this tab): send anything made offline, then refresh from the server.
  useEffect(() => {
    const sync = async () => {
      const b = be.current as OfflineBackend | null
      if (!b || b.kind !== 'cloud' || !b.flush || !b.pending()) return
      try {
        if (await b.flush()) setData(await b.loadAll())
      } catch { /* still flaky: the outbox keeps everything */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [setData])

  // On-device library: another tab changed it, so show the latest.
  useEffect(() => {
    let ch: BroadcastChannel | undefined
    try { ch = new BroadcastChannel(LOCAL_CHANNEL) } catch { return }
    ch.onmessage = () => {
      const b = be.current
      if (b?.kind === 'local') b.loadAll().then(setData).catch(() => {})
    }
    return () => ch?.close()
  }, [setData])

  // Keep this device's copy of the signed-in library current, so it opens offline.
  useEffect(() => {
    if (backend?.kind !== 'cloud' || !backend.userId) return
    const t = setTimeout(() => cacheSnapshot(backend.userId!, data), 1500)
    return () => clearTimeout(t)
  }, [data, backend])

  useEffect(() => {
    boot()
    if (!cloudConfigured) return
    const { data: sub } = supabase().auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') boot()
    })
    return () => sub.subscription.unsubscribe()
  }, [boot])

  // Saves run one after another in the order they were made (a book before its shelf record,
  // "reading" before "finished"), with a visible error if one fails.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const persist = useCallback(
    <T,>(f: (b: Backend) => Promise<T>): Promise<T | undefined> => {
      const b = be.current
      if (!b) return Promise.resolve(undefined)
      // On this device saves are recorded (and kept in order) the instant they're made, so they
      // start straight away; network saves wait their turn.
      const run = b.kind === 'local' ? f(b) : chain.current.then(() => f(b))
      chain.current = run.catch((e) => errRef.current('Couldn’t save: ' + ((e as Error).message ?? 'unknown error')))
      return run.catch(() => undefined)
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

  const isAdmin = !!backend?.isAdmin
  const userId = backend?.userId

  // Lookups against the latest data (not this render's copy), for use inside mutations.
  const entryNow = (id: string) => live.current.entries.find((e) => e.id === id)
  const readsNow = (entryId: string) =>
    live.current.reads.filter((r) => r.entryId === entryId)
      .sort((x, y) => (x.startedOn ?? x.finishedOn ?? '').localeCompare(y.startedOn ?? y.finishedOn ?? ''))

  /** Ids changed when a book was matched to the shared catalogue: point everything at the new ones. */
  const applyRemap = (r: IdRemap) => {
    const w = (id: string) => r.works[id] ?? id
    const ed = (id?: string) => (id ? r.editions[id] ?? id : id)
    const en = (id: string) => r.entries[id] ?? id
    for (const [from, to] of Object.entries(r.works)) moved.current.set(from, to)
    setData((d) => ({
      ...d,
      works: d.works.filter((x) => !r.works[x.id]),
      editions: d.editions.filter((x) => !r.editions[x.id]).map((x) => ({ ...x, workId: w(x.workId) })),
      entries: d.entries.filter((x) => !r.entries[x.id]).map((x) => ({ ...x, workId: w(x.workId), editionId: ed(x.editionId) })),
      reads: d.reads.map((x) => ({ ...x, entryId: en(x.entryId), editionId: ed(x.editionId) })),
    }))
  }

  /**
   * Which pile a book belongs on, judged from its reads: an open read decides; otherwise the
   * most recent finished or abandoned one does. With no reads left, the book goes back to
   * Want to read.
   */
  const statusFromReads = (reads: Read[], current: Status): Status => {
    const open = [...reads].reverse().find((r) => r.state === 'reading' || r.state === 'paused')
    if (open) return open.state === 'paused' ? 'paused' : 'reading'
    const done = reads.filter((r) => r.state === 'finished' || r.state === 'dnf')
      .sort((x, y) => (x.finishedOn ?? x.startedOn ?? '').localeCompare(y.finishedOn ?? y.startedOn ?? ''))
    const last = done[done.length - 1]
    if (last) return last.state === 'finished' ? 'read' : 'dnf'
    // No reads left: the book hasn't been started (yet).
    return reads.length ? current : 'want'
  }
  const syncStatus = (entryId: string) => {
    const entry = entryNow(entryId)
    if (!entry) return
    const reads = readsNow(entryId)
    const status = statusFromReads(reads, entry.status)
    // The book's rating follows its most recent finished read.
    const lastRated = reads.filter((r) => r.state === 'finished' && r.rating)
      .sort((x, y) => (x.finishedOn ?? '').localeCompare(y.finishedOn ?? '')).pop()
    const patch: Partial<Entry> = {}
    if (status !== entry.status) patch.status = status
    if (lastRated && lastRated.rating !== entry.rating) patch.rating = lastRated.rating
    if (Object.keys(patch).length) store.updateEntry(entryId, patch)
  }

  /** Progress in one edition's units (pages, minutes or %) re-expressed in another's. */
  const convertProgress = (value: number | undefined, from?: Edition, to?: Edition) => {
    if (value == null) return value
    const total = (e?: Edition) => (e ? (mediumOf(e.format) === 'audio' ? e.durationMin : e.pages) : undefined)
    const a = total(from), b = total(to)
    const frac = a ? value / a : value / 100
    return Math.round(Math.min(1, Math.max(0, frac)) * (b ?? 100))
  }

  const store: Store = {
    ready, backend, data, works, editions, entries, entryByWork, editionsByWork, readsByEntry, activeRead,
    isAdmin, userId,
    canEdit: (rec) => !!rec && (backend?.kind === 'local' || isAdmin || (!!userId && rec.createdBy === userId)),

    editionOf: (entry) => editions.get(entry.editionId ?? '') ?? editionsByWork.get(entry.workId)?.[0],

    continueOnDevice() {
      setMode('local')
      boot()
    },
    async signOut() {
      const who = be.current?.kind === 'cloud' ? be.current.userId : undefined
      setMode(null)
      await be.current?.signOut?.()
      await boot()
      // Don't leave a readable copy of the library behind on a shared computer.
      if (who) await forgetSnapshot(who)
    },

    addBook(b) {
      const t = nowIso()
      const existing = b.work.id ? works.get(b.work.id) ?? (b.inCatalogue ? (b.work as Work) : undefined) : undefined
      const work: Work = existing ?? { ...b.work, id: b.work.id ?? uid(), createdAt: t, createdBy: userId }
      const knownEdition = b.edition.id ? editions.get(b.edition.id) ?? (b.inCatalogue ? ({ ...b.edition, workId: work.id } as Edition) : undefined) : undefined
      const edition: Edition = knownEdition
        ? knownEdition
        : { ...b.edition, id: b.edition.id ?? uid(), workId: work.id, createdAt: t, createdBy: userId }
      const prev = live.current.entries.find((e) => e.workId === work.id)
      // Already on your shelves: keep its pile unless this add says it moved along.
      const entry: Entry = prev
        ? { ...prev, editionId: edition.id, status: b.status === 'want' ? prev.status : b.status, updatedAt: t }
        : {
          id: uid(), workId: work.id, editionId: edition.id, status: b.status, rating: b.rating, favorite: false,
          owned: false, tags: [], shelfIds: [], addedAt: t, updatedAt: t,
        }
      const hasOpen = prev ? readsNow(prev.id).some((r) => r.state === 'reading' || r.state === 'paused') : false
      const newRead: Read | undefined =
        (b.status === 'read' || b.status === 'dnf' || (b.status === 'reading' && !hasOpen))
          ? {
            id: uid(), entryId: entry.id, editionId: edition.id,
            state: b.status === 'read' ? 'finished' : b.status === 'dnf' ? 'dnf' : 'reading',
            startedOn: b.startedOn ?? (b.status === 'reading' ? today() : undefined),
            finishedOn: b.status === 'read' ? b.finishedOn : undefined,
            rating: b.rating,
          }
          : undefined
      if (!live.current.works.some((x) => x.id === work.id)) upsertIn('works', work)
      if (!live.current.editions.some((x) => x.id === edition.id)) upsertIn('editions', edition)
      upsertIn('entries', entry)
      if (newRead) upsertIn('reads', newRead)
      // One bulk save, so an ISBN that's already in the shared catalogue is reused, not rejected.
      persist((be) => be.saveMany({
        works: existing ? [] : [work],
        editions: knownEdition ? [] : [edition],
        entries: [entry],
        reads: newRead ? [newRead] : [],
      })).then((remap) => { if (remap) applyRemap(remap) })
      return entry
    },

    saveWork(w) {
      upsertIn('works', w)
      persist((b) => b.saveWork(w))
    },
    remember(ws, es) {
      setData((d) => ({
        ...d,
        works: [...d.works, ...ws.filter((w) => !d.works.some((x) => x.id === w.id))],
        editions: [...d.editions, ...es.filter((e) => !d.editions.some((x) => x.id === e.id))],
      }))
    },
    saveEdition(e) {
      upsertIn('editions', e)
      persist((b) => b.saveEdition(e))
    },
    updateEntry(id, patch) {
      const cur = entryNow(id)
      if (!cur) return
      const next = { ...cur, ...patch, updatedAt: nowIso() }
      upsertIn('entries', next)
      persist((b) => b.saveEntry(next))
    },
    removeEntry(id) {
      const entry = entryNow(id)
      const reads = live.current.reads.filter((r) => r.entryId === id)
      const readIds = new Set(reads.map((r) => r.id))
      const logs = live.current.logs.filter((l) => readIds.has(l.readId))
      setData((d) => ({
        ...d,
        entries: d.entries.filter((e) => e.id !== id),
        reads: d.reads.filter((r) => r.entryId !== id),
        logs: d.logs.filter((l) => !readIds.has(l.readId)),
      }))
      persist((b) => b.deleteEntry(id))
      return () => {
        if (!entry) return
        setData((d) => ({ ...d, entries: [...d.entries, entry], reads: [...d.reads, ...reads], logs: [...d.logs, ...logs] }))
        persist((b) => b.saveMany({ entries: [entry], reads, logs }))
      }
    },
    async deleteEdition(id) {
      await be.current?.deleteEdition(id)
      setData((d) => ({
        ...d,
        editions: d.editions.filter((e) => e.id !== id),
        entries: d.entries.map((e) => (e.editionId === id ? { ...e, editionId: undefined } : e)),
        reads: d.reads.map((r) => (r.editionId === id ? { ...r, editionId: undefined } : r)),
      }))
    },
    async mergeWorks(fromId, intoId) {
      const b = be.current
      if (!b) return
      await b.mergeWorks(fromId, intoId)
      setData(await b.loadAll())
    },

    setStatus(entryId, status) {
      const entry = entryNow(entryId)
      if (!entry) return
      const reads = readsNow(entryId)
      const open = reads.find((r) => r.state === 'reading' || r.state === 'paused')
      let changed: Read | undefined
      let removed: Read | undefined
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
        changed = { ...open, state: status, finishedOn: status === 'dnf' ? open.finishedOn ?? today() : open.finishedOn }
      } else if (status === 'want' && open) {
        // Back to the wish list: a read that never got going is dropped; one with progress is
        // kept in your history as set aside.
        const logged = live.current.logs.some((l) => l.readId === open.id)
        if (!logged && !open.progress) removed = open
        else changed = { ...open, state: 'dnf', finishedOn: open.finishedOn ?? today() }
      }
      if (changed) {
        const c = changed
        upsertIn('reads', c)
        persist((b) => b.saveRead(c))
      }
      if (removed) {
        const id = removed.id
        setData((d) => ({ ...d, reads: d.reads.filter((r) => r.id !== id) }))
        persist((b) => b.deleteRead(id))
      }
      store.updateEntry(entryId, { status })
    },

    draftRead(entryId, editionId) {
      const entry = entryNow(entryId) ?? entries.get(entryId)
      return { id: uid(), entryId, editionId: editionId ?? entry?.editionId, state: 'reading', startedOn: today() }
    },
    startRead(entryId, editionId) {
      const r = store.draftRead(entryId, editionId)
      store.saveRead(r)
      return r
    },
    saveRead(r) {
      const isNew = !live.current.reads.some((x) => x.id === r.id)
      upsertIn('reads', r)
      persist((b) => b.saveRead(r))
      // A new read in a different edition makes that edition yours.
      const entry = entryNow(r.entryId)
      if (isNew && entry && r.editionId && r.editionId !== entry.editionId && r.state === 'reading') store.updateEntry(entry.id, { editionId: r.editionId })
      syncStatus(r.entryId)
    },
    deleteRead(id) {
      const r = live.current.reads.find((x) => x.id === id)
      setData((d) => ({ ...d, reads: d.reads.filter((x) => x.id !== id), logs: d.logs.filter((l) => l.readId !== id) }))
      persist((b) => b.deleteRead(id))
      if (r) syncStatus(r.entryId)
    },
    chooseEdition(entryId, editionId) {
      const entry = entryNow(entryId)
      if (!entry || entry.editionId === editionId) return
      // Carry a read in progress over to the new edition, keeping how far through you are.
      const open = readsNow(entryId).find((r) => r.state === 'reading' || r.state === 'paused')
      if (open) {
        const from = live.current.editions.find((e) => e.id === (open.editionId ?? entry.editionId))
        const to = live.current.editions.find((e) => e.id === editionId)
        const next: Read = { ...open, editionId, progress: convertProgress(open.progress, from, to) }
        upsertIn('reads', next)
        persist((b) => b.saveRead(next))
      }
      store.updateEntry(entryId, { editionId })
    },
    logProgress(readId, value) {
      const r = live.current.reads.find((x) => x.id === readId)
      if (!r) return
      const entry = entryNow(r.entryId)
      const ed = live.current.editions.find((e) => e.id === (r.editionId ?? entry?.editionId))
      const delta = value - (r.progress ?? 0)
      const next: Read = { ...r, progress: value }
      upsertIn('reads', next)
      persist((b) => b.saveRead(next))
      if (delta !== 0) {
        // Logs are in pages or minutes. Progress kept as a percentage (no page count known) is
        // converted using another edition's length when there is one; otherwise the day still
        // counts as a reading day, without inventing a number of pages.
        const audio = mediumOf(ed?.format) === 'audio'
        const total = audio ? ed?.durationMin : ed?.pages
        let amount = delta
        if (!total && entry) {
          const sibling = live.current.editions.find((e) => e.workId === entry.workId && (audio ? e.durationMin : e.pages))
          const len = sibling ? (audio ? sibling.durationMin : sibling.pages) : undefined
          amount = len ? Math.round((delta / 100) * len) : 0
        }
        // One log row per read per day; repeated updates adjust it.
        const day = today()
        const existing = live.current.logs.find((l) => l.readId === readId && l.on === day)
        const log: LogPoint = existing
          ? { ...existing, amount: existing.amount + amount }
          : { id: uid(), readId, on: day, amount, medium: mediumOf(ed?.format) }
        upsertIn('logs', log)
        persist((b) => b.saveLog(log))
      }
    },

    saveShelf(s) {
      upsertIn('shelves', s)
      persist((b) => b.saveShelf(s))
    },
    deleteShelf(id) {
      const t = nowIso()
      const touched = live.current.entries.filter((e) => e.shelfIds.includes(id)).map((e) => ({ ...e, shelfIds: e.shelfIds.filter((x) => x !== id), updatedAt: t }))
      setData((d) => ({
        ...d,
        shelves: d.shelves.filter((s) => s.id !== id),
        entries: d.entries.map((e) => touched.find((x) => x.id === e.id) ?? e),
      }))
      // Take the books off the shelf too, so the old shelf doesn't linger in their records.
      persist(async (b) => {
        if (touched.length) await b.saveMany({ entries: touched })
        await b.deleteShelf(id)
      })
    },
    saveSettings(patch) {
      const next = { ...live.current.settings, ...patch }
      setData((d) => ({ ...d, settings: next }))
      persist((b) => b.saveSettings(next))
    },
    async importData(part) {
      const b = be.current
      if (!b) return
      await chain.current // let earlier changes land first
      try {
        await b.saveMany(part)
      } finally {
        // Even if it stopped part-way, show what did arrive so a retry matches it instead of duplicating it.
        setData(await b.loadAll())
      }
    },
    async wipe() {
      const b = be.current
      if (!b) return
      await b.wipe()
      setData(await b.loadAll())
    },
    async mergeIn(src) {
      const b = be.current
      if (!b) return { books: 0, matched: 0 }
      // Include matching books from the shared catalogue, not just your own shelves.
      const catalogue = await b.catalogueFor({
        isbns: src.editions.flatMap((e) => [e.isbn13, e.isbn10]).filter((x): x is string => !!x),
        titles: src.works.map((w) => w.title),
      }).catch(() => ({ works: [], editions: [] }))
      const into = {
        works: [...live.current.works, ...catalogue.works.filter((w) => !live.current.works.some((x) => x.id === w.id))],
        editions: [...live.current.editions, ...catalogue.editions.filter((e) => !live.current.editions.some((x) => x.id === e.id))],
        entries: live.current.entries,
        shelves: live.current.shelves,
      }
      const res = mergeLibrary(src, into)
      await chain.current
      await b.saveMany(res.data)
      setData(await b.loadAll())
      return { books: res.books, matched: res.matched }
    },
    deviceBooks,
    pending,
    async moveDeviceBooks() {
      const b = be.current as OfflineBackend | null
      if (!b || b.kind !== 'cloud') return 0
      // Only clear this device once the books are safely in your account.
      if ((typeof navigator !== 'undefined' && navigator.onLine === false) || (b.pending() && (await b.flush(), b.pending()))) {
        throw new Error('You’re offline. Moving your books needs a connection, so they’re staying on this device for now.')
      }
      const local = createLocalBackend()
      const snap = await local.loadAll()
      // Cover photos taken on this device are stored in the browser; upload them so they come along.
      const editions = await Promise.all(snap.editions.map(async (e) => {
        if (!e.coverUrl?.startsWith('data:')) return e
        try { return { ...e, coverUrl: await b.uploadCover(await (await fetch(e.coverUrl)).blob()) } } catch { return e }
      }))
      const res = await store.mergeIn({ ...snap, editions })
      if (b.pending()) throw new Error('Some books couldn’t be sent yet. They’re still on this device; try again when you’re back online.')
      await local.wipe()
      setDeviceBooks(0)
      return res.books
    },
    async dismissDeviceBooks(discard) {
      if (discard) await createLocalBackend().wipe()
      else try { localStorage.setItem(DEVICE_DISMISSED_KEY, String(deviceBooks)) } catch { /* storage blocked */ }
      setDeviceBooks(0)
    },
    movedTo: (workId) => moved.current.get(workId),
    async loadWork(id) {
      if (works.has(id)) return true
      const found = await be.current?.fetchWork(id).catch(() => null)
      if (!found) return false
      store.remember([found.work], found.editions)
      return true
    },
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
