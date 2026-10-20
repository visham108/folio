import { describe, expect, it } from 'vitest'
import { fmtRefreshed } from '../../src/components/Refresh'

describe('last refreshed label', () => {
  const now = new Date(2026, 9, 20, 15, 0).getTime()
  it('says today or yesterday for recent refreshes', () => {
    expect(fmtRefreshed(new Date(2026, 9, 20, 10, 42).getTime(), now)).toMatch(/^Today, 10:42/)
    expect(fmtRefreshed(new Date(2026, 9, 19, 21, 5).getTime(), now)).toMatch(/^Yesterday, 9:05/)
  })
  it('gives the date for older ones, with the year only when it differs', () => {
    const older = fmtRefreshed(new Date(2026, 9, 2, 8, 0).getTime(), now)
    expect(older).toMatch(/2/)
    expect(older).not.toMatch(/2026/)
    expect(fmtRefreshed(new Date(2025, 11, 31, 8, 0).getTime(), now)).toMatch(/2025/)
  })
})
