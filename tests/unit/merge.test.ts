import { describe, expect, it } from 'vitest'
import { mergeEntryFields } from '../../src/lib/merge'
import { mergeLibrary } from '../../src/lib/merge'

const t = '2026-01-01T00:00:00Z'
const entry = (id: string, workId: string, editionId: string, shelfIds: string[] = []) => ({
  id, workId, editionId, status: 'read' as const, favorite: false, owned: false, tags: [], shelfIds, addedAt: t, updatedAt: t,
})

describe('mergeLibrary', () => {
  const into = {
    works: [{ id: 'cat-dune', title: 'Dune', authors: ['Frank Herbert'], genres: [], createdAt: t }],
    editions: [{ id: 'cat-dune-pb', workId: 'cat-dune', format: 'paperback' as const, isbn13: '9780441172719', narrators: [], translators: [], createdAt: t }],
    entries: [entry('mine-dune', 'cat-dune', 'cat-dune-pb')],
    shelves: [{ id: 'fav', name: 'Favourites', position: 0 }],
  }
  const src = {
    works: [
      { id: 'dev-dune', title: 'Dune', authors: ['Frank Herbert'], genres: [], createdAt: t },
      { id: 'dev-new', title: 'Piranesi', authors: ['Susanna Clarke'], genres: [], createdAt: t },
    ],
    editions: [
      { id: 'dev-dune-pb', workId: 'dev-dune', format: 'paperback' as const, isbn13: '9780441172719', narrators: [], translators: [], createdAt: t },
      { id: 'dev-new-pb', workId: 'dev-new', format: 'paperback' as const, narrators: [], translators: [], createdAt: t },
    ],
    entries: [entry('dev-e1', 'dev-dune', 'dev-dune-pb'), entry('dev-e2', 'dev-new', 'dev-new-pb', ['dev-fav'])],
    reads: [
      { id: 'r1', entryId: 'dev-e1', editionId: 'dev-dune-pb', state: 'finished' as const, finishedOn: '2020-01-01' },
      { id: 'r2', entryId: 'dev-e2', editionId: 'dev-new-pb', state: 'finished' as const, finishedOn: '2021-01-01' },
    ],
    logs: [],
    shelves: [{ id: 'dev-fav', name: 'favourites', position: 0 }],
  }
  const res = mergeLibrary(src, into)

  it('reuses the catalogue book and edition', () => {
    expect(res.matched).toBe(1)
    expect(res.data.works.map((w) => w.id)).toEqual(['dev-new'])
    expect(res.data.editions.map((e) => e.id)).toEqual(['dev-new-pb'])
  })
  it('adds reads of a book you already have to your existing entry', () => {
    // The new book gets an entry; the one you already had is kept (updated with anything only the device copy had).
    expect(res.data.entries.map((e) => e.id).sort()).toEqual(['dev-e2', 'mine-dune'].filter((id) => res.data.entries.some((e) => e.id === id)).sort())
    expect(res.data.entries.some((e) => e.id === 'dev-e1')).toBe(false)
    expect(res.data.reads.find((r) => r.id === 'r1')).toMatchObject({ entryId: 'mine-dune', editionId: 'cat-dune-pb' })
  })
  it('combines shelves with the same name', () => {
    expect(res.data.shelves).toHaveLength(0)
    expect(res.data.entries.find((e) => e.id === 'dev-e2')!.shelfIds).toEqual(['fav'])
  })
})

describe('mergeEntryFields', () => {
  it('keeps everything either record had', () => {
    const base = { id: 'a', workId: 'w', status: 'want', favorite: false, owned: false, tags: ['x'], shelfIds: ['s1'], addedAt: '2024-01-01', updatedAt: '' } as const
    const dup = { ...base, id: 'b', status: 'read', rating: 4.5, review: 'Loved it', favorite: true, tags: ['y'], shelfIds: ['s2'], moods: ['dark'], addedAt: '2023-05-01' } as const
    expect(mergeEntryFields({ ...base, tags: [...base.tags], shelfIds: [...base.shelfIds] }, { ...dup, tags: [...dup.tags], shelfIds: [...dup.shelfIds], moods: [...dup.moods] })).toMatchObject({
      status: 'read', rating: 4.5, review: 'Loved it', favorite: true, tags: ['x', 'y'], shelfIds: ['s1', 's2'], moods: ['dark'], addedAt: '2023-05-01',
    })
  })
})
