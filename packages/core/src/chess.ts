import { isNormal } from 'chessops'
import { Chess, castlingSide } from 'chessops/chess'
import { makeFen, parseFen } from 'chessops/fen'
import { makeSan, parseSan } from 'chessops/san'
import { kingCastlesTo, makeUci, parseUci } from 'chessops/util'
import type { Color, PositionKey, Uci } from './types'

export function positionFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

export function keyOf(pos: Chess): PositionKey {
  return makeFen(pos.toSetup(), { epd: true })
}

export const INITIAL_KEY: PositionKey = keyOf(Chess.default())

export function positionKey(fen: string): PositionKey {
  return keyOf(positionFromFen(fen))
}

export function sideAt(key: PositionKey, color: Color): 'mine' | 'theirs' {
  return positionFromFen(key).turn === color ? 'mine' : 'theirs'
}

/** Lichess and chessground write castling as king-takes-rook (e1h1); the app stores e1g1. */
export function toStandardUci(pos: Chess, uci: Uci): Uci | undefined {
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) return undefined
  const side = castlingSide(pos, move)
  if (side && isNormal(move)) return makeUci({ ...move, to: kingCastlesTo(pos.turn, side) })
  return makeUci(move)
}

export function playUci(key: PositionKey, uci: Uci): PositionKey {
  const pos = positionFromFen(key)
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) throw new Error(`Illegal move ${uci} in ${key}`)
  pos.play(move)
  return keyOf(pos)
}

export function keyAfter(moves: readonly Uci[]): PositionKey {
  return moves.reduce(playUci, INITIAL_KEY)
}

export function pathMoves(path: string): Uci[] {
  return path ? path.split(' ') : []
}

export function childPath(path: string, uci: Uci): string {
  return path ? `${path} ${uci}` : uci
}

export function parentPath(path: string): string {
  return pathMoves(path).slice(0, -1).join(' ')
}

export function uciToSan(key: PositionKey, uci: Uci): string {
  const move = parseUci(uci)
  if (!move) throw new Error(`Invalid UCI ${uci}`)
  return makeSan(positionFromFen(key), move)
}

export function sanLine(moves: readonly Uci[]): string[] {
  const sans: string[] = []
  let key = INITIAL_KEY
  for (const uci of moves) {
    sans.push(uciToSan(key, uci))
    key = playUci(key, uci)
  }
  return sans
}

export function sanLineToUci(line: string): Uci[] {
  const pos = Chess.default()
  const moves: Uci[] = []
  for (const token of line.split(/\s+/)) {
    const san = token.replace(/^\d+\.+/, '')
    if (!san) continue
    const move = parseSan(pos, san)
    const uci = move && toStandardUci(pos, makeUci(move))
    if (!move || !uci) throw new Error(`Invalid SAN ${san} in "${line}"`)
    moves.push(uci)
    pos.play(move)
  }
  return moves
}
