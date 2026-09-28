import { type PositionKey, positionFromFen, toStandardUci, type Uci } from '@chess-trainer/core'
import { castlingSide } from 'chessops/chess'
import { makeSan } from 'chessops/san'
import type { Role } from 'chessops/types'
import { makeSquare, parseUci } from 'chessops/util'

const PIECES: Record<Role, { subject: string; object: string; promoted: string }> = {
  pawn: { subject: 'Le pion', object: 'le pion', promoted: 'un pion' },
  knight: { subject: 'Le cavalier', object: 'le cavalier', promoted: 'un cavalier' },
  bishop: { subject: 'Le fou', object: 'le fou', promoted: 'un fou' },
  rook: { subject: 'La tour', object: 'la tour', promoted: 'une tour' },
  queen: { subject: 'La dame', object: 'la dame', promoted: 'une dame' },
  king: { subject: 'Le roi', object: 'le roi', promoted: 'un roi' },
}

export function describeMove(
  key: PositionKey,
  uci: Uci,
): { san: string; text: string } | undefined {
  const pos = positionFromFen(key)
  const standard = toStandardUci(pos, uci)
  const move = standard ? parseUci(standard) : undefined
  if (!move || !('from' in move)) return undefined
  const piece = pos.board.get(move.from)
  if (!piece) return undefined

  const san = makeSan(pos, move)
  const suffix = san.endsWith('#') ? ', échec et mat' : san.endsWith('+') ? ', échec' : ''
  const side = castlingSide(pos, move)
  if (side) return { san, text: `${side === 'h' ? 'Petit roque' : 'Grand roque'}${suffix}` }

  const to = makeSquare(move.to)
  const captured = pos.board.get(move.to)
  const enPassant = piece.role === 'pawn' && !captured && (move.from & 7) !== (move.to & 7)
  const action = captured
    ? `prend ${PIECES[captured.role].object} en ${to}`
    : enPassant
      ? `prend le pion en passant en ${to}`
      : `va en ${to}`
  const promotion = move.promotion ? ` et devient ${PIECES[move.promotion].promoted}` : ''
  return {
    san,
    text: `${PIECES[piece.role].subject} ${makeSquare(move.from)} ${action}${promotion}${suffix}`,
  }
}
