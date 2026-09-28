import { MATE_SCORE } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { parseInfo } from './uci'

describe('parseInfo', () => {
  it('reads multipv, centipawns and the first pv move', () => {
    expect(
      parseInfo(
        'info depth 16 seldepth 20 multipv 2 score cp -32 nodes 1 nps 1 time 1 pv e7e6 d2d4',
      ),
    ).toEqual({ multipv: 2, cp: -32, move: 'e7e6' })
  })

  it('defaults multipv to 1', () => {
    expect(parseInfo('info score cp 15 pv e2e4')?.multipv).toBe(1)
  })

  it('maps mate scores', () => {
    expect(parseInfo('info score mate 3 pv d1h5')?.cp).toBe(MATE_SCORE - 3)
    expect(parseInfo('info score mate -2 pv g8f6')?.cp).toBe(-(MATE_SCORE - 2))
  })

  it('ignores bounds, lines without score or pv, and other output', () => {
    expect(parseInfo('info depth 12 score cp 20 lowerbound pv e2e4')).toBeUndefined()
    expect(parseInfo('info depth 12 currmove e2e4 currmovenumber 1')).toBeUndefined()
    expect(parseInfo('info score mate 0')).toBeUndefined()
    expect(parseInfo('info string NNUE evaluation enabled')).toBeUndefined()
    expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeUndefined()
  })
})
