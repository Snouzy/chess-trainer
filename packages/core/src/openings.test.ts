import { describe, expect, it } from 'vitest'
import { findOpening, type Opening, searchOpenings } from './openings'

const OPENINGS: Opening[] = [
  { eco: 'B00', name: "King's Pawn Game", moves: ['e2e4'] },
  { eco: 'C00', name: 'French Defense', moves: ['e2e4', 'e7e6'] },
  {
    eco: 'C01',
    name: 'French Defense: Exchange Variation',
    moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4d5'],
  },
  { eco: 'A04', name: 'Réti Opening', moves: ['g1f3'] },
]

describe('findOpening', () => {
  it('returns the longest opening that prefixes the line', () => {
    expect(findOpening(OPENINGS, ['e2e4', 'e7e6', 'd2d4'])?.eco).toBe('C00')
    expect(findOpening(OPENINGS, ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4d5', 'e6d5'])?.eco).toBe('C01')
    expect(findOpening(OPENINGS, [])).toBeUndefined()
  })
})

describe('searchOpenings', () => {
  it('matches every word, case and accent insensitive, shortest line first', () => {
    expect(searchOpenings(OPENINGS, 'french').map((o) => o.eco)).toEqual(['C00', 'C01'])
    expect(searchOpenings(OPENINGS, 'FRENCH exch').map((o) => o.eco)).toEqual(['C01'])
    expect(searchOpenings(OPENINGS, 'reti').map((o) => o.eco)).toEqual(['A04'])
    expect(searchOpenings(OPENINGS, 'c00').map((o) => o.eco)).toEqual(['C00'])
  })

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchOpenings(OPENINGS, '  ')).toEqual([])
    expect(searchOpenings(OPENINGS, 'e', 2)).toHaveLength(2)
  })
})
