import { parsePgn } from 'chessops/pgn'
import { describe, expect, it } from 'vitest'
import { exportPgn } from './pgn'
import { generateFrench } from './testing'

describe('exportPgn', () => {
  it('writes the tree with the most frequent reply as the main line', async () => {
    const { tree } = await generateFrench()
    const pgn = exportPgn(tree, 'French Defense')
    const [game] = parsePgn(pgn)

    expect(game?.headers.get('Event')).toBe('French Defense')
    expect([...game!.moves.mainline()].map((d) => d.san)).toEqual(['e4', 'e6', 'd4', 'd5'])
    const afterE6 = game!.moves.children[0]!.children[0]!
    expect(afterE6.children.map((c) => c.data.san)).toEqual(['d4', 'd3'])
    expect(afterE6.children[1]!.children[0]!.data.san).toBe('d5')
  })
})
