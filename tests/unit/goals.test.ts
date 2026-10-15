import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, goalFor, withGoal } from '../../src/lib/types'

describe('yearly goals', () => {
  const s = { ...DEFAULT_SETTINGS }
  it('defaults every year to 12', () => {
    expect(goalFor(s, 2019)).toBe(12)
    expect(goalFor(s, new Date().getFullYear())).toBe(12)
  })
  it('keeps each year’s own goal, and 0 means no goal', () => {
    const t = { ...s, ...withGoal(s, 2020, 30) }
    expect(goalFor(t, 2020)).toBe(30)
    expect(goalFor(t, 2021)).toBe(12)
    const u = { ...t, ...withGoal(t, 2020, 0) }
    expect(goalFor(u, 2020)).toBeUndefined()
  })
})
