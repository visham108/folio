import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completions, goalPace, goalRace, monthPeriods, niceMax, readingSpeed, streak, summarize, undated, yearsWithData, type Completion,
} from '../../src/lib/stats'
import type { Edition, Entry, LogPoint, Read, Work } from '../../src/lib/types'
import { addDays, fmtDuration, fmtNumber, localIso, today } from '../../src/lib/util'

// These run under any TZ (the suite is also run with TZ=Asia/Kolkata and TZ=America/Los_Angeles).
// Instants are built from local clock times, the way the reader experiences them.
afterEach(() => { vi.useRealTimers() })
const at = (y: number, m: number, d: number, h = 12, min = 0) => vi.setSystemTime(new Date(y, m - 1, d, h, min))

const t = '2026-01-01T00:00:00Z'
const log = (on: string, amount = 20): LogPoint => ({ id: on, readId: 'r', on, amount, medium: 'print' })

describe('local dates', () => {
  it('today() and localIso() use the local calendar', () => {
    at(2026, 10, 15, 0, 30)
    expect(today()).toBe('2026-10-15')
    expect(localIso(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('streak', () => {
  it('counts today just after local midnight (UTC is still yesterday east of Greenwich)', () => {
    at(2026, 10, 15, 0, 30)
    expect(streak([log('2026-10-13'), log('2026-10-14'), log('2026-10-15')])).toEqual({ current: 3, best: 3 })
  })
  it('counts yesterday late in the evening (UTC is already tomorrow west of Greenwich)', () => {
    at(2026, 10, 15, 21, 0)
    expect(streak([log('2026-10-13'), log('2026-10-14')]).current).toBe(2)
  })
  it('lapses after a missed day', () => {
    at(2026, 10, 15, 12)
    expect(streak([log('2026-10-12'), log('2026-10-13')])).toEqual({ current: 0, best: 2 })
  })
})

const work: Work = { id: 'w', title: 'Dune', authors: ['Frank Herbert'], genres: [], createdAt: t }
const print: Edition = { id: 'p', workId: 'w', format: 'paperback', pages: 300, narrators: [], translators: [], createdAt: t }
const entry: Entry = { id: 'e', workId: 'w', editionId: 'p', status: 'read', favorite: false, owned: false, tags: [], shelfIds: [], addedAt: t, updatedAt: t }
const lk = { works: new Map([['w', work]]), editions: new Map([['p', print]]), entries: new Map([['e', entry]]) }
const fin = (id: string, finishedOn?: string): Read => ({ id, entryId: 'e', editionId: 'p', state: 'finished', finishedOn })

describe('goal race and pace', () => {
  it('starts on local January 1 and ends on local December 31', () => {
    at(2026, 1, 1, 0, 30)
    expect(goalRace([], 2026, 24).you).toHaveLength(1)
    at(2026, 12, 31, 23, 30)
    expect(goalRace([], 2026, 24).you).toHaveLength(365)
  })
  it('knows about leap years', () => {
    at(2024, 7, 1)
    const race = goalRace([], 2024, 24)
    expect(race.days).toBe(366)
    expect(race.monthStarts.slice(0, 4)).toEqual([0, 31, 60, 91])
    expect(goalRace([], 2025, 24).monthStarts.slice(0, 4)).toEqual([0, 31, 59, 90])
  })
  it('gives Today and Stats the same whole number of books ahead or behind', () => {
    at(2026, 10, 15)
    // Day 288 of 365 with a goal of 52: 41.03 books expected.
    const p = goalPace(31, 52, 2026)
    expect(p.ahead).toBe(-10)
    expect(p.text).toBe('10 books behind pace')
    expect(goalPace(42, 52, 2026).text).toBe('1 book ahead of pace')
    expect(goalPace(41, 52, 2026).text).toBe('Right on pace')
    expect(goalPace(52, 52, 2026).text).toBe('Goal reached ✦')
    const items = completions(Array.from({ length: 31 }, (_, i) => fin(`r${i}`, `2026-0${1 + (i % 9)}-10`)), lk)
    const race = goalRace(items, 2026, 52)
    expect(race.done).toBe(31)
    expect(race.ahead).toBe(p.ahead)
    expect(race.paceText).toBe(p.text)
  })
  it('counts books finished in a month without a day by today at the latest', () => {
    at(2026, 10, 15)
    const race = goalRace(completions([fin('a', '2026-10')], lk), 2026, 12)
    expect(race.done).toBe(1)
  })
})

describe('pages per day', () => {
  it('divides by whole days so far, at least one', () => {
    at(2026, 10, 1, 1, 0)
    const speed = readingSpeed([], [log('2026-10-01', 30)], monthPeriods(2026))
    expect(speed.at(-1)).toMatchObject({ label: 'Oct', pagesPerDay: 30 })
    at(2026, 10, 15, 23, 0)
    expect(readingSpeed([], [log('2026-10-01', 30)], monthPeriods(2026)).at(-1)!.pagesPerDay).toBe(2)
  })
  it('uses the whole month once it’s over', () => {
    at(2026, 10, 15)
    const speed = readingSpeed([], [log('2026-09-03', 300)], monthPeriods(2026))
    expect(speed.find((s) => s.label === 'Sep')!.pagesPerDay).toBe(10)
    expect(monthPeriods(2026)).toHaveLength(10)
  })
})

describe('books finished without a date', () => {
  const items: Completion[] = completions([fin('a', '2025-03-01'), fin('b'), fin('c')], lk)
  it('count in all-time totals but in no year', () => {
    expect(items).toHaveLength(3)
    expect(undated(items)).toHaveLength(2)
    expect(yearsWithData(items)).toEqual([2025])
    expect(summarize(items, 2025).books).toBe(1)
  })
})

describe('chart axes', () => {
  it.each([[0, 2], [1, 2], [2, 2], [3, 4], [5, 6], [7, 8], [9, 10], [10, 10], [11, 20], [25, 30], [45, 50], [150, 200], [0.4, 2]])(
    'niceMax(%s) is %s', (v, want) => expect(niceMax(v)).toBe(want))
  it('puts the half-way line on a whole number for counts', () => {
    for (let v = 1; v <= 100; v++) expect(Number.isInteger(niceMax(v) / 2)).toBe(true)
  })
})

describe('formatting', () => {
  it('shows listening time without 60-minute remainders', () => {
    expect(fmtDuration(Math.round(90))).toBe('1h 30m')
    expect(fmtDuration(Math.round(119.6))).toBe('2h')
  })
  it('shows exact numbers for tables', () => {
    expect(fmtNumber(1084)).toBe((1084).toLocaleString())
    expect(fmtNumber(2.25, 1)).toBe((2.3).toLocaleString())
  })
})
