import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Backend, CatalogueChange } from './backend'
import type { Edition, Entry, LogPoint, Read, Settings, Shelf, Snapshot, Work } from './types'
import { DEFAULT_SETTINGS } from './types'

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const cloudConfigured = !!(URL_ && KEY)

let client: SupabaseClient | null = null
export function supabase(): SupabaseClient {
  if (!client) {
    if (!URL_ || !KEY) throw new Error('Supabase is not configured')
    // PKCE puts the OAuth result in ?code=… rather than the URL hash, which
    // keeps it clear of the hash router. Sessions persist in localStorage, so
    // you stay signed in until you sign out.
    client = createClient(URL_, KEY, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true } })
  }
  return client
}

export async function signInWithGoogle() {
  const redirectTo = window.location.origin + window.location.pathname
  const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  if (error) throw error
}

/** Sends a one-time sign-in code. New addresses get an account automatically. */
export async function sendEmailCode(email: string) {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw new Error(friendlyAuthError(error))
}

export async function verifyEmailCode(email: string, token: string) {
  const { error } = await supabase().auth.verifyOtp({ email, token, type: 'email' })
  if (error) throw new Error(friendlyAuthError(error))
}

function friendlyAuthError(e: { message?: string; status?: number }): string {
  const m = e.message ?? ''
  if (/not authorized/i.test(m)) return 'Email sign-in isn’t switched on yet. Please continue with Google for now.'
  if (/expired|invalid/i.test(m) && /token|otp|code/i.test(m)) return 'That code didn’t work. Check it, or send a new one.'
  const wait = m.match(/after (\d+) seconds?/)
  if (wait) return `Please wait ${wait[1]} seconds before asking for another code.`
  if (e.status === 429 || /rate limit/i.test(m)) return 'Too many codes have been sent recently. Please try again in a little while.'
  if (/invalid.*email|email.*invalid/i.test(m)) return 'That doesn’t look like an email address.'
  return m || 'Something went wrong. Please try again.'
}

// ── row mapping ─────────────────────────────────────────────────────────────

const und = <T,>(v: T | null): T | undefined => (v === null ? undefined : v)

type Row = Record<string, any>

const workFrom = (r: Row): Work => ({
  id: r.id, title: r.title, subtitle: und(r.subtitle), authors: r.authors ?? [], series: und(r.series),
  seriesIndex: r.series_index == null ? undefined : Number(r.series_index), description: und(r.description),
  genres: r.genres ?? [], firstPublished: und(r.first_published), originalLanguage: und(r.original_language),
  createdBy: und(r.created_by), createdAt: r.created_at, updatedBy: und(r.updated_by), updatedAt: und(r.updated_at),
})
const workTo = (w: Work): Row => ({
  id: w.id, title: w.title, subtitle: w.subtitle ?? null, authors: w.authors, series: w.series ?? null,
  series_index: w.seriesIndex ?? null, description: w.description ?? null, genres: w.genres,
  first_published: w.firstPublished ?? null, original_language: w.originalLanguage ?? null,
})
const editionFrom = (r: Row): Edition => ({
  id: r.id, workId: r.work_id, format: r.format, title: und(r.title), publisher: und(r.publisher),
  publishedDate: und(r.published_date), isbn13: und(r.isbn13), isbn10: und(r.isbn10), asin: und(r.asin),
  language: und(r.language), pages: und(r.pages), durationMin: und(r.duration_min), narrators: r.narrators ?? [],
  translators: r.translators ?? [], coverUrl: und(r.cover_url), note: und(r.note), createdBy: und(r.created_by),
  createdAt: r.created_at, updatedBy: und(r.updated_by), updatedAt: und(r.updated_at),
})
const editionTo = (e: Edition): Row => ({
  id: e.id, work_id: e.workId, format: e.format, title: e.title ?? null, publisher: e.publisher ?? null,
  published_date: e.publishedDate ?? null, isbn13: e.isbn13 ?? null, isbn10: e.isbn10 ?? null, asin: e.asin ?? null,
  language: e.language ?? null, pages: e.pages ?? null, duration_min: e.durationMin ?? null, narrators: e.narrators,
  // Only hosted images are shared; on-device photos (data: URLs) stay local.
  translators: e.translators, cover_url: e.coverUrl?.startsWith('https://') ? e.coverUrl : null, note: e.note ?? null,
})
const entryFrom = (r: Row): Entry => ({
  id: r.id, workId: r.work_id, editionId: und(r.edition_id), status: r.status,
  rating: r.rating == null ? undefined : Number(r.rating), review: und(r.review), favorite: r.favorite,
  owned: r.owned, tags: r.tags ?? [], shelfIds: r.shelf_ids ?? [], moods: r.moods ?? [], pace: und(r.pace),
  addedAt: r.added_at, updatedAt: r.updated_at,
})
const entryTo = (e: Entry): Row => ({
  id: e.id, work_id: e.workId, edition_id: e.editionId ?? null, status: e.status, rating: e.rating ?? null,
  review: e.review ?? null, favorite: e.favorite, owned: e.owned, tags: e.tags, shelf_ids: e.shelfIds,
  moods: e.moods ?? [], pace: e.pace ?? null, added_at: e.addedAt, updated_at: e.updatedAt,
})
const readFrom = (r: Row): Read => ({
  id: r.id, entryId: r.entry_id, editionId: und(r.edition_id), state: r.state, startedOn: und(r.started_on),
  finishedOn: und(r.finished_on), progress: r.progress == null ? undefined : Number(r.progress),
  rating: r.rating == null ? undefined : Number(r.rating), notes: und(r.notes),
})
const readTo = (r: Read): Row => ({
  id: r.id, entry_id: r.entryId, edition_id: r.editionId ?? null, state: r.state, started_on: r.startedOn ?? null,
  finished_on: r.finishedOn ?? null, progress: r.progress ?? null, rating: r.rating ?? null, notes: r.notes ?? null,
})
const logFrom = (r: Row): LogPoint => ({ id: r.id, readId: r.read_id, on: r.on_date, amount: Number(r.amount), medium: r.medium })
const logTo = (l: LogPoint): Row => ({ id: l.id, read_id: l.readId, on_date: l.on, amount: l.amount, medium: l.medium })
const shelfFrom = (r: Row): Shelf => ({ id: r.id, name: r.name, emoji: und(r.emoji), position: r.position })
const shelfTo = (s: Shelf): Row => ({ id: s.id, name: s.name, emoji: s.emoji ?? null, position: s.position })

function chunks<T>(xs: T[], n = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function all(q: PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

const LAST_USER = 'folio.lastUser'
interface LastUser { id: string; email?: string; isAdmin: boolean }
function lastUser(): LastUser | null {
  try { return JSON.parse(localStorage.getItem(LAST_USER) ?? 'null') } catch { return null }
}
function rememberUser(u: LastUser | null) {
  try { if (u) localStorage.setItem(LAST_USER, JSON.stringify(u)); else localStorage.removeItem(LAST_USER) } catch { /* storage blocked */ }
}

export async function createCloudBackend(): Promise<Backend | null> {
  const sb = supabase()
  const { data } = await sb.auth.getSession().catch(() => ({ data: { session: null } }))
  let user: { id: string; email?: string; user_metadata?: Record<string, string> } | undefined = data.session?.user
  // Offline, the session can't be refreshed: open the library for whoever was last
  // signed in here. Changes queue up and sync, with a fresh session, once back online.
  const last = lastUser()
  if (!user && typeof navigator !== 'undefined' && navigator.onLine === false && last) user = { id: last.id, email: last.email }
  if (!user) return null
  let admin = last?.id === user.id ? last.isAdmin : false
  try {
    const { data: isAdmin, error } = await sb.rpc('is_super_admin')
    if (!error) admin = isAdmin === true
  } catch { /* offline: keep the remembered value */ }
  rememberUser({ id: user.id, email: user.email, isAdmin: admin })

  const ok = async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p
    if (error) throw error
  }
  const upsert = (table: string, rows: Row[]) => (rows.length ? ok(sb.from(table).upsert(rows)) : Promise.resolve())

  return {
    kind: 'cloud',
    userLabel: user.email ?? user.user_metadata?.full_name,
    userId: user.id,
    isAdmin: admin === true,
    async loadAll(): Promise<Snapshot> {
      const [entries, reads, logs, shelves, profile, mine] = await Promise.all([
        all(sb.from('entries').select('*')),
        all(sb.from('reads').select('*')),
        all(sb.from('logs').select('*')),
        all(sb.from('shelves').select('*').order('position')),
        sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        all(sb.from('works').select('id').eq('created_by', user.id)),
      ])
      const workIds = [...new Set([...entries.map((e) => e.work_id as string), ...mine.map((w) => w.id as string)])]
      const works: Row[] = []
      const editions: Row[] = []
      for (const ids of chunks(workIds)) {
        works.push(...(await all(sb.from('works').select('*').in('id', ids))))
        editions.push(...(await all(sb.from('editions').select('*').in('work_id', ids))))
      }
      const p = profile.data
      return {
        works: works.map(workFrom),
        editions: editions.map(editionFrom),
        entries: entries.map(entryFrom),
        reads: reads.map(readFrom),
        logs: logs.map(logFrom),
        shelves: shelves.map(shelfFrom),
        settings: p
          ? { displayName: und(p.display_name), yearlyGoal: p.yearly_goal, audioPagesPerHour: p.audio_pages_per_hour, theme: p.theme }
          : { ...DEFAULT_SETTINGS, displayName: user.user_metadata?.full_name },
      }
    },
    saveWork: (w) => upsert('works', [workTo(w)]),
    saveEdition: (e) => upsert('editions', [editionTo(e)]),
    saveEntry: (e) => upsert('entries', [entryTo(e)]),
    deleteEntry: (id) => ok(sb.from('entries').delete().eq('id', id)),
    saveRead: (r) => upsert('reads', [readTo(r)]),
    deleteRead: (id) => ok(sb.from('reads').delete().eq('id', id)),
    saveLog: (l) => upsert('logs', [logTo(l)]),
    deleteEdition: (id) => ok(sb.from('editions').delete().eq('id', id)),
    mergeWorks: (fromId, intoId) => ok(sb.rpc('merge_works', { from_id: fromId, into_id: intoId })),
    async history(ids) {
      if (!ids.length) return []
      const rows = await all(sb.from('catalogue_changes').select('*').in('record_id', ids).order('changed_at', { ascending: false }).limit(40))
      const skip = new Set(['updated_at', 'updated_by', 'created_at', 'created_by'])
      return rows.map((r): CatalogueChange => ({
        id: r.id, table: r.table_name, recordId: r.record_id, action: r.action, changedBy: und(r.changed_by), changedAt: r.changed_at,
        fields: r.action === 'update' && r.before && r.after
          ? Object.keys(r.after).filter((k) => !skip.has(k) && JSON.stringify(r.after[k]) !== JSON.stringify(r.before[k]))
          : [],
      }))
    },
    saveShelf: (s) => upsert('shelves', [shelfTo(s)]),
    deleteShelf: (id) => ok(sb.from('shelves').delete().eq('id', id)),
    saveSettings: (s: Settings) =>
      upsert('profiles', [{
        id: user.id, display_name: s.displayName ?? null, yearly_goal: s.yearlyGoal,
        audio_pages_per_hour: s.audioPagesPerHour, theme: s.theme, updated_at: new Date().toISOString(),
      }]),
    async saveMany(part) {
      let works = part.works ?? []
      let editions = part.editions ?? []
      let entries = part.entries ?? []
      let reads = part.reads ?? []
      const logs = part.logs ?? []

      // Safety net: an ISBN that reached the shared catalogue since we last looked
      // is reused rather than rejected as a duplicate.
      const isbns = [...new Set(editions.map((e) => e.isbn13).filter((x): x is string => !!x))]
      const taken = new Map<string, Row>()
      for (const c of chunks(isbns)) for (const r of await all(sb.from('editions').select('id, work_id, isbn13').in('isbn13', c))) taken.set(r.isbn13, r)
      const edMap = new Map<string, string>()
      const workMap = new Map<string, string>()
      editions = editions.filter((e) => {
        const hit = e.isbn13 ? taken.get(e.isbn13) : undefined
        if (!hit || hit.id === e.id) return true
        edMap.set(e.id, hit.id)
        if (hit.work_id !== e.workId) workMap.set(e.workId, hit.work_id)
        return false
      })
      if (edMap.size) {
        editions = editions.map((e) => ({ ...e, workId: workMap.get(e.workId) ?? e.workId }))
        entries = entries.map((en) => ({ ...en, workId: workMap.get(en.workId) ?? en.workId, editionId: (en.editionId && edMap.get(en.editionId)) || en.editionId }))
        reads = reads.map((r) => ({ ...r, editionId: (r.editionId && edMap.get(r.editionId)) || r.editionId }))
        const used = new Set([...editions.map((e) => e.workId), ...entries.map((e) => e.workId)])
        works = works.filter((w) => used.has(w.id))
      }
      // One shelf entry per book: fold anything that collides into the entry you already have.
      const mine = new Map((await all(sb.from('entries').select('id, work_id'))).map((r) => [r.work_id as string, r.id as string]))
      const entryMap = new Map<string, string>()
      entries = entries.filter((en) => {
        const have = mine.get(en.workId)
        if (have && have !== en.id) { entryMap.set(en.id, have); return false }
        return true
      })
      if (entryMap.size) reads = reads.map((r) => ({ ...r, entryId: entryMap.get(r.entryId) ?? r.entryId }))

      // Order matters for foreign keys.
      for (const c of chunks(works, 300)) await upsert('works', c.map(workTo))
      for (const c of chunks(editions, 300)) await upsert('editions', c.map(editionTo))
      for (const c of chunks(part.shelves ?? [], 300)) await upsert('shelves', c.map(shelfTo))
      for (const c of chunks(entries, 300)) await upsert('entries', c.map(entryTo))
      for (const c of chunks(reads, 300)) await upsert('reads', c.map(readTo))
      for (const c of chunks(logs, 500)) await upsert('logs', c.map(logTo))
    },
    async catalogueFor({ isbns, titles }) {
      const workRows = new Map<string, Row>()
      const edRows = new Map<string, Row>()
      const clean = [...new Set(isbns.filter(Boolean))]
      for (const c of chunks(clean)) {
        for (const r of await all(sb.from('editions').select('*').or(`isbn13.in.(${c.join(',')}),isbn10.in.(${c.join(',')})`))) edRows.set(r.id, r)
      }
      const uniqTitles = [...new Set(titles.map((t) => t.trim()).filter(Boolean))]
      for (const c of chunks(uniqTitles, 500)) {
        const { data, error } = await sb.rpc('works_by_titles', { q_titles: c })
        if (!error) for (const r of (data as Row[]) ?? []) workRows.set(r.id, r)
      }
      const needWorks = [...new Set([...edRows.values()].map((e) => e.work_id as string))].filter((id) => !workRows.has(id))
      for (const c of chunks(needWorks)) for (const r of await all(sb.from('works').select('*').in('id', c))) workRows.set(r.id, r)
      const needEds = [...workRows.keys()]
      for (const c of chunks(needEds)) for (const r of await all(sb.from('editions').select('*').in('work_id', c))) edRows.set(r.id, r)
      return { works: [...workRows.values()].map(workFrom), editions: [...edRows.values()].map(editionFrom) }
    },
    async seriesWorks(names) {
      const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
      if (!uniq.length) return { works: [], editions: [] }
      const works: Row[] = []
      for (const c of chunks(uniq, 100)) works.push(...(await all(sb.from('works').select('*').in('series', c).limit(2000))))
      const editions: Row[] = []
      for (const c of chunks(works.map((w) => w.id as string))) editions.push(...(await all(sb.from('editions').select('*').in('work_id', c))))
      return { works: works.map(workFrom), editions: editions.map(editionFrom) }
    },
    async fetchWork(id) {
      const { data: w } = await sb.from('works').select('*').eq('id', id).maybeSingle()
      if (!w) return null
      const eds = await all(sb.from('editions').select('*').eq('work_id', id))
      return { work: workFrom(w), editions: eds.map(editionFrom) }
    },
    async searchCatalog(title) {
      if (title.trim().length < 2) return { works: [], editions: [] }
      const { data, error } = await sb.rpc('find_similar_works', { q_title: title, q_limit: 8 })
      if (error || !data?.length) return { works: [], editions: [] }
      const works = (data as Row[]).map(workFrom)
      const editions = (await all(sb.from('editions').select('*').in('work_id', works.map((w) => w.id)))).map(editionFrom)
      return { works, editions }
    },
    async uploadCover(blob) {
      const path = `${user.id}/${crypto.randomUUID()}.jpg`
      const { error } = await sb.storage.from('covers').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
      if (error) throw error
      return sb.storage.from('covers').getPublicUrl(path).data.publicUrl
    },
    async signOut() {
      rememberUser(null)
      await sb.auth.signOut()
    },
    async wipe() {
      await ok(sb.from('entries').delete().eq('user_id', user.id))
      await ok(sb.from('shelves').delete().eq('user_id', user.id))
    },
  }
}
