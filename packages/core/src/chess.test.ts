import { describe, expect, it } from 'vitest'
import {
  childPath,
  INITIAL_KEY,
  keyAfter,
  parentPath,
  pathMoves,
  playUci,
  positionFromFen,
  positionKey,
  sanLine,
  sanLineToUci,
  sideAt,
  toStandardUci,
  uciToSan,
} from './chess'

const CASTLE_READY = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'

describe('positionKey', () => {
  it('is the 4-field EPD of the initial position', () => {
    expect(INITIAL_KEY).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
  })

  it('strips move counters', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 20')).toBe(
      INITIAL_KEY,
    )
  })

  it('drops an en-passant square when no capture is legal', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    )
  })

  it('keeps an en-passant square when a capture is legal', () => {
    expect(positionKey('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3')).toBe(
      'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3',
    )
  })

  it('is equal for transpositions', () => {
    expect(keyAfter(['g1f3', 'd7d5', 'd2d4'])).toBe(keyAfter(['d2d4', 'd7d5', 'g1f3']))
  })
})

describe('toStandardUci', () => {
  const pos = () => positionFromFen(CASTLE_READY)

  it('converts king-takes-rook castling to king-two-squares', () => {
    expect(toStandardUci(pos(), 'e1h1')).toBe('e1g1')
    expect(toStandardUci(pos(), 'e1a1')).toBe('e1c1')
  })

  it('keeps standard castling and ordinary moves', () => {
    expect(toStandardUci(pos(), 'e1g1')).toBe('e1g1')
    expect(toStandardUci(pos(), 'h1g1')).toBe('h1g1')
  })

  it('returns undefined for illegal or malformed moves', () => {
    expect(toStandardUci(pos(), 'e1e3')).toBeUndefined()
    expect(toStandardUci(pos(), 'zz')).toBeUndefined()
  })

  it('needs the promotion piece', () => {
    const promo = positionFromFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
    expect(toStandardUci(promo, 'e7e8q')).toBe('e7e8q')
    expect(toStandardUci(promo, 'e7e8')).toBeUndefined()
  })
})

describe('moves and paths', () => {
  it('plays a move and rejects an illegal one', () => {
    expect(playUci(INITIAL_KEY, 'e2e4')).toBe(keyAfter(['e2e4']))
    expect(() => playUci(INITIAL_KEY, 'e2e5')).toThrow()
  })

  it('builds and splits paths', () => {
    expect(childPath('', 'e2e4')).toBe('e2e4')
    expect(childPath('e2e4', 'e7e6')).toBe('e2e4 e7e6')
    expect(pathMoves('')).toEqual([])
    expect(pathMoves('e2e4 e7e6')).toEqual(['e2e4', 'e7e6'])
    expect(parentPath('e2e4 e7e6')).toBe('e2e4')
    expect(parentPath('e2e4')).toBe('')
  })

  it('knows whose move it is for the repertoire color', () => {
    expect(sideAt(INITIAL_KEY, 'white')).toBe('mine')
    expect(sideAt(INITIAL_KEY, 'black')).toBe('theirs')
  })

  it('converts between SAN and UCI', () => {
    expect(uciToSan(INITIAL_KEY, 'g1f3')).toBe('Nf3')
    expect(sanLine(['e2e4', 'e7e6', 'd2d4'])).toEqual(['e4', 'e6', 'd4'])
    expect(sanLineToUci('1. e4 e6 2. d4 d5')).toEqual(['e2e4', 'e7e6', 'd2d4', 'd7d5'])
    expect(sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O').at(-1)).toBe('e1g1')
  })

  it('rejects an invalid SAN line', () => {
    expect(() => sanLineToUci('1. e4 Ke3')).toThrow()
  })
})
