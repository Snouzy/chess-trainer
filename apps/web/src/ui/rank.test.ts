import type { PositionStats, RepNode } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { rankPositions } from './rank'

const node = (
  path: string,
  positionKey: string,
  side: 'mine' | 'theirs' = 'mine',
  ply = path.split(' ').length,
): RepNode => ({
  repertoireId: 'r',
  path,
  positionKey,
  ply,
  probability: 1,
  side,
  expanded: true,
})
const stat = (positionKey: string, attempts: number, errors: number): PositionStats => ({
  repertoireId: 'r',
  positionKey,
  attempts,
  errors,
})

describe('rankPositions', () => {
  it('sorts by error rate, then errors, keeps the shortest path and drops unknown positions', () => {
    const nodes = [node('a b c', 'P'), node('x', 'P'), node('a', 'Q'), node('a b', 'R', 'theirs')]
    const stats = [stat('P', 4, 1), stat('Q', 2, 1), stat('R', 1, 1), stat('gone', 1, 1)]
    expect(rankPositions(nodes, stats).map((r) => [r.positionKey, r.path, r.rate])).toEqual([
      ['Q', 'a', 0.5],
      ['P', 'x', 0.25],
    ])
  })

  it('keeps the path with fewer plies, not the shorter string', () => {
    const nodes = [node('a b c d', 'P', 'mine', 2), node('x', 'P', 'mine', 3)]
    const stats = [stat('P', 1, 1)]
    expect(rankPositions(nodes, stats).map((r) => r.path)).toEqual(['a b c d'])
  })
})
