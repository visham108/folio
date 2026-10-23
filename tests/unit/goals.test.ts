import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, goalFor, pageGoalFor, withGoal, withPageGoal } from '../../src/lib/types'

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
  it('gives every year a 3,600-page goal until you set one, separately from books', () => {
    expect(pageGoalFor(s, 2025)).toBe(3600)
    const t = { ...s, ...withPageGoal(s, 2026, 3500) }
    expect(pageGoalFor(t, 2026)).toBe(3500)
    expect(goalFor(t, 2026)).toBe(12)
    expect(pageGoalFor({ ...t, ...withPageGoal(t, 2026, 0) }, 2026)).toBeUndefined()
  })
  it('counts an hour of listening as 20 pages by default', () => {
    expect(DEFAULT_SETTINGS.audioPagesPerHour).toBe(20)
  })
})
