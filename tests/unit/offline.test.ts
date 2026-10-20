import { describe, expect, it } from 'vitest'
import type { Backend } from '../../src/lib/backend'
import { withOffline } from '../../src/lib/offline'

function fakeBackend() {
  const state = { down: false, calls: [] as string[], reject: new Set<string>() }
  const write = (name: string) => async (x: { id: string }) => {
    if (state.down) throw new TypeError('Failed to fetch')
    if (state.reject.has(x.id)) throw new Error('new row violates row-level security policy')
    state.calls.push(`${name}:${x.id}`)
  }
  const b = {
    kind: 'cloud', isAdmin: false, userId: 'u1',
    saveEntry: write('saveEntry'), saveRead: write('saveRead'), deleteEntry: async (id: string) => write('deleteEntry')({ id }),
    loadAll: async () => { if (state.down) throw new TypeError('Failed to fetch'); return { works: [], editions: [], entries: [], reads: [], logs: [], shelves: [], settings: {} } },
    searchCatalog: async () => { if (state.down) throw new TypeError('Failed to fetch'); return { works: [{ id: 'w' }], editions: [] } },
  } as unknown as Backend
  return { b, state }
}

let n = 0

describe('offline outbox', () => {
  it('queues writes while offline and sends them in order once back', async () => {
    const { b, state } = fakeBackend()
    const counts: number[] = []
    const off = await withOffline(b, `u${++n}`, { onQueue: (n) => counts.push(n), onDropped: () => {}, signedInAs: async () => `u${n}` })
    state.down = true
    await off.saveEntry({ id: 'e1' } as never)
    await off.saveRead({ id: 'r1' } as never)
    expect(off.pending()).toBe(2)
    state.down = false
    // Still queued behind the earlier ones, so order is kept.
    await off.saveEntry({ id: 'e2' } as never)
    expect(off.pending()).toBe(3)
    expect(await off.flush()).toBe(3)
    expect(state.calls).toEqual(['saveEntry:e1', 'saveRead:r1', 'saveEntry:e2'])
    expect(off.pending()).toBe(0)
    expect(counts.at(-1)).toBe(0)
  })

  it('says when the library shown is the saved copy rather than the server’s', async () => {
    const { b, state } = fakeBackend()
    const off = await withOffline(b, `u${++n}`, { onQueue: () => {}, onDropped: () => {}, signedInAs: async () => `u${n}` })
    await off.loadAll()
    expect(off.fromCache).toBe(false)
    await new Promise((r) => setTimeout(r, 50)) // the copy is saved in the background
    state.down = true
    await off.loadAll()
    expect(off.fromCache).toBe(true)
    state.down = false
    await off.loadAll()
    expect(off.fromCache).toBe(false)
  })

  it('stops at the first network failure and keeps the rest', async () => {
    const { b, state } = fakeBackend()
    const off = await withOffline(b, `u${++n}`, { onQueue: () => {}, onDropped: () => {}, signedInAs: async () => `u${n}` })
    state.down = true
    await off.saveEntry({ id: 'a' } as never)
    await off.saveEntry({ id: 'b' } as never)
    expect(await off.flush()).toBe(0)
    expect(off.pending()).toBe(2)
  })

  it('drops a change the server refuses, reports it, and carries on', async () => {
    const { b, state } = fakeBackend()
    const dropped: string[] = []
    const off = await withOffline(b, `u${++n}`, { onQueue: () => {}, onDropped: (m) => dropped.push(m), signedInAs: async () => `u${n}` })
    state.down = true
    await off.saveEntry({ id: 'bad' } as never)
    await off.saveEntry({ id: 'good' } as never)
    state.down = false
    state.reject.add('bad')
    await off.flush()
    expect(state.calls).toEqual(['saveEntry:good'])
    expect(dropped).toHaveLength(1)
  })

  it('keeps everything when the sign-in has lapsed, instead of dropping it', async () => {
    const { b, state } = fakeBackend()
    const dropped: string[] = []
    const me = `u${++n}`
    let who: string | null = me
    const off = await withOffline(b, me, { onQueue: () => {}, onDropped: (m) => dropped.push(m), signedInAs: async () => who })
    state.down = true
    await off.saveEntry({ id: 'a' } as never)
    state.down = false
    who = null
    expect(await off.flush()).toBe(0)
    expect(off.pending()).toBe(1)
    // Nor does it show an empty library: it falls back to this device's copy.
    await expect(off.loadAll()).rejects.toThrow(/offline/)
    who = me
    expect(await off.flush()).toBe(1)
    expect(dropped).toEqual([])
  })

  it('treats an expired session or a busy server as temporary', async () => {
    const { b, state } = fakeBackend()
    const off = await withOffline(b, `u${++n}`, { onQueue: () => {}, onDropped: () => {}, signedInAs: async () => `u${n}` })
    ;(b as unknown as { saveRead: () => Promise<void> }).saveRead = async () => { throw Object.assign(new Error('JWT expired'), { code: 'PGRST301' }) }
    await off.saveRead({ id: 'r' } as never)
    expect(off.pending()).toBe(1)
    void state
  })

  it('returns empty search results offline instead of failing', async () => {
    const { b, state } = fakeBackend()
    const off = await withOffline(b, `u${++n}`, { onQueue: () => {}, onDropped: () => {}, signedInAs: async () => `u${n}` })
    state.down = true
    expect(await off.searchCatalog('x', [])).toEqual({ works: [], editions: [] })
  })
})
