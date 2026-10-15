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

describe('offline outbox', () => {
  it('queues writes while offline and sends them in order once back', async () => {
    const { b, state } = fakeBackend()
    const counts: number[] = []
    const off = await withOffline(b, 'u1', { onQueue: (n) => counts.push(n), onDropped: () => {} })
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

  it('stops at the first network failure and keeps the rest', async () => {
    const { b, state } = fakeBackend()
    const off = await withOffline(b, 'u1', { onQueue: () => {}, onDropped: () => {} })
    state.down = true
    await off.saveEntry({ id: 'a' } as never)
    await off.saveEntry({ id: 'b' } as never)
    expect(await off.flush()).toBe(0)
    expect(off.pending()).toBe(2)
  })

  it('drops a change the server refuses, reports it, and carries on', async () => {
    const { b, state } = fakeBackend()
    const dropped: string[] = []
    const off = await withOffline(b, 'u1', { onQueue: () => {}, onDropped: (m) => dropped.push(m) })
    state.down = true
    await off.saveEntry({ id: 'bad' } as never)
    await off.saveEntry({ id: 'good' } as never)
    state.down = false
    state.reject.add('bad')
    await off.flush()
    expect(state.calls).toEqual(['saveEntry:good'])
    expect(dropped).toHaveLength(1)
  })

  it('returns empty search results offline instead of failing', async () => {
    const { b, state } = fakeBackend()
    const off = await withOffline(b, 'u1', { onQueue: () => {}, onDropped: () => {} })
    state.down = true
    expect(await off.searchCatalog('x', [])).toEqual({ works: [], editions: [] })
  })
})
