import { INITIAL_KEY, keyAfter, positionKey } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { describeMove } from './describe-move'

const text = (fen: string, uci: string) => describeMove(positionKey(fen), uci)?.text

describe('describeMove', () => {
  it('describes quiet pawn and piece moves with both squares', () => {
    expect(describeMove(INITIAL_KEY, 'e2e4')).toEqual({ san: 'e4', text: 'Le pion e2 va en e4' })
    expect(describeMove(INITIAL_KEY, 'g1f3')?.text).toBe('Le cavalier g1 va en f3')
  })

  it('names the captured piece', () => {
    expect(describeMove(keyAfter(['e2e4', 'd7d5']), 'e4d5')?.text).toBe(
      'Le pion e4 prend le pion en d5',
    )
    expect(text('3qk3/8/8/8/8/8/8/3QK3 w - - 0 1', 'd1d8')).toBe(
      'La dame d1 prend la dame en d8, échec',
    )
  })

  it('describes both castlings, also from king-takes-rook input and for Black', () => {
    const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
    expect(text(castle, 'e1g1')).toBe('Petit roque')
    expect(text(castle, 'e1h1')).toBe('Petit roque')
    expect(text(castle, 'e1c1')).toBe('Grand roque')
    expect(text('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8c8')).toBe('Grand roque')
    expect(text('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8g8')).toBe('Petit roque')
    expect(text('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8h8')).toBe('Petit roque')
  })

  it('describes en passant', () => {
    expect(text('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 'e5f6')).toBe(
      'Le pion e5 prend le pion en passant en f6',
    )
  })

  it('describes promotions, underpromotions and capture-promotions', () => {
    expect(text('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7e8q')).toBe(
      'Le pion e7 va en e8 et devient une dame',
    )
    expect(text('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7e8n')).toBe(
      'Le pion e7 va en e8 et devient un cavalier',
    )
    expect(text('3r4/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7d8q')).toBe(
      'Le pion e7 prend la tour en d8 et devient une dame',
    )
  })

  it('adds check and mate', () => {
    expect(text('rnbqkbnr/ppp2ppp/8/3pp3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'f1b5')).toBe(
      'Le fou f1 va en b5, échec',
    )
    expect(describeMove(keyAfter(['f2f3', 'e7e5', 'g2g4']), 'd8h4')).toEqual({
      san: 'Qh4#',
      text: 'La dame d8 va en h4, échec et mat',
    })
  })

  it('keeps the origin square when SAN needs disambiguation', () => {
    expect(text('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1', 'b1d2')).toBe('Le cavalier b1 va en d2')
  })

  it('returns undefined for an illegal or malformed move', () => {
    expect(describeMove(INITIAL_KEY, 'e2e5')).toBeUndefined()
    expect(describeMove(INITIAL_KEY, 'zz')).toBeUndefined()
  })
})
