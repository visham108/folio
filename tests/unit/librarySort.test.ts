import { describe, expect, it } from 'vitest'
import { compareKeys, surnameKey, titleKey } from '../../src/lib/librarySort'

describe('library sorting', () => {
  it('files titles without leading articles or accents', () => {
    expect(titleKey('The Silmarillion')).toBe(titleKey('Silmarillion'))
    expect(titleKey('A Friend To All')).toBe(titleKey('Friend to All'))
    const sorted = ['Śrī Vaṁsīdāsa Bābājī', 'Srimad-Bhagavatam', 'Sri Caitanya Bhagavat'].sort((a, b) => compareKeys([titleKey(a)], [titleKey(b)], 1))
    expect(sorted).toEqual(['Sri Caitanya Bhagavat', 'Śrī Vaṁsīdāsa Bābājī', 'Srimad-Bhagavatam'])
  })

  it('sorts western authors by surname, spiritual names as written', () => {
    expect(surnameKey('Ursula K. Le Guin')).toMatch(/^le guin/)
    expect(surnameKey('Martin Luther King Jr.')).toMatch(/^king/)
    expect(surnameKey('Bhakti Vikasa Swami')).toBe('bhakti vikasa swami')
    expect(surnameKey('Gopiparanadhana Dasa')).toBe('gopiparanadhana dasa')
    expect(surnameKey('A.C. Bhaktivedanta Swami Srila Prabhupada')).toMatch(/^a ?c bhaktivedanta/)
  })

  it('puts books with no value last whichever way round, and orders series numbers numerically', () => {
    const keys = [undefined, ['b'], ['a']]
    expect([...keys].sort((x, y) => compareKeys(x, y, 1))).toEqual([['a'], ['b'], undefined])
    expect([...keys].sort((x, y) => compareKeys(x, y, -1))).toEqual([['b'], ['a'], undefined])
    const vols = [['dune', 10], ['dune', 2], ['dune', 3.2], ['dune', 3.1]]
    expect(vols.sort((x, y) => compareKeys(x, y, 1)).map((v) => v[1])).toEqual([2, 3.1, 3.2, 10])
  })
})
