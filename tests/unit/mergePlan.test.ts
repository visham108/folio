import { describe, expect, it } from 'vitest'
import { planMerge } from '../../src/lib/mergePlan'
import type { Edition, Work } from '../../src/lib/types'

const work = (id: string, p: Partial<Work> = {}): Work => ({ id, title: 'Sri Brhad-bhagavatamrta', authors: ['Sanatana Gosvami'], genres: [], createdAt: '2026-01-01', ...p })
const ed = (id: string, workId: string, p: Partial<Edition> = {}): Edition => ({ id, workId, format: 'hardcover', narrators: [], translators: [], createdAt: '2026-01-01', ...p })

describe('merge plan', () => {
  const keep = work('k', { subtitle: 'Part Two', genres: ['Hinduism'] })
  const dup = work('d', { subtitle: 'Volume 3', description: 'Gopa-kumara reaches Goloka.', genres: ['Spirituality'], series: 'Sri Brhad-bhagavatamrta', seriesIndex: 3 })
  const keepEd = ed('ke', 'k', { publisher: 'Ras Bihari Lal and Sons', isbn13: '9788192674384' })
  const dupEd = ed('de', 'd', { publisher: 'The Bhaktivedanta Book Trust', isbn13: '9789171497895', pages: 926 })

  it('fills the kept book’s blank details, never overwriting', () => {
    const p = planMerge({ dup, keep, dupEditions: [dupEd], keepEditions: [keepEd] })
    expect(p.work.subtitle).toBe('Part Two')
    expect(p.work.genres).toEqual(['Hinduism'])
    expect(p.work.description).toBe('Gopa-kumara reaches Goloka.')
    expect(p.work.series).toBe('Sri Brhad-bhagavatamrta')
    expect(p.work.seriesIndex).toBe(3)
    expect(p.workFilled).toEqual(['series', 'description', 'seriesIndex'])
  })

  it('combines the duplicate’s edition into your copy: blanks filled, the rest reported as dropped', () => {
    const p = planMerge({ dup, keep, dupEditions: [dupEd], keepEditions: [keepEd], myKeepEditionId: 'ke' })
    expect(p.groups).toHaveLength(1)
    const g = p.groups[0]
    expect(g.into.id).toBe('ke')
    expect(g.result.pages).toBe(926)
    expect(g.result.publisher).toBe('Ras Bihari Lal and Sons')
    expect(g.filled).toEqual(['pages'])
    expect(g.discarded.map((d) => d.field)).toEqual(['publisher', 'isbn13'])
    expect(p.target.get('de')).toBe('ke')
    expect(p.moved).toEqual([])
  })

  it('pairs copies by format, preferring yours, and moves a format the kept book lacks', () => {
    const keepPaper = ed('kp', 'k', { format: 'paperback', createdAt: '2020-01-01' })
    const keepAudio = ed('ka', 'k', { format: 'audiobook' })
    const dupAudio = ed('da', 'd', { format: 'audiobook', durationMin: 512 })
    const dupEbook = ed('dx', 'd', { format: 'ebook', pages: 300 })
    const dupEbook2 = ed('dy', 'd', { format: 'ebook', publisher: 'Ace', createdAt: '2027-01-01' })
    const p = planMerge({ dup, keep, dupEditions: [dupAudio, dupEbook, dupEbook2], keepEditions: [keepPaper, keepAudio], myKeepEditionId: 'kp' })
    expect(p.target.get('da')).toBe('ka')
    expect(p.groups.find((g) => g.into.id === 'ka')?.result.durationMin).toBe(512)
    // No ebook to combine with: the first moves across, the second folds into it.
    expect(p.moved.map((e) => e.id)).toEqual(['dx'])
    expect(p.target.get('dy')).toBe('dx')
    expect(p.groups.find((g) => g.into.id === 'dx')?.result.publisher).toBe('Ace')
  })

  it('takes your copy of the kept book when the format matches, else the oldest of that format; your duplicate copy goes first', () => {
    const older = ed('old', 'k', { createdAt: '2020-01-01' })
    const dupMine = ed('dm', 'd', { pages: 500, createdAt: '2026-05-01' })
    const dupOther = ed('do', 'd', { pages: 400, createdAt: '2019-01-01' })
    const p = planMerge({ dup, keep, dupEditions: [dupOther, dupMine], keepEditions: [keepEd, older], myDupEditionId: 'dm' })
    expect(p.groups[0].into.id).toBe('old')
    expect(p.groups[0].result.pages).toBe(500)
    expect(p.dupEditions.map((e) => e.id)).toEqual(['dm', 'do'])
    const mineKept = planMerge({ dup, keep, dupEditions: [dupMine], keepEditions: [keepEd, older], myKeepEditionId: 'ke' })
    expect(mineKept.groups[0].into.id).toBe('ke')
  })
})
