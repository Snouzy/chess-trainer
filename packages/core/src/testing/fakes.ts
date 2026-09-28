import { makeUci } from 'chessops/util'
import { keyAfter, pathMoves, positionFromFen, positionKey, toStandardUci } from '../chess'
import type { Engine, ExplorerSource } from '../ports'
import type { PositionKey, Uci } from '../types'

type MoveCounts = Array<[Uci, number]>

/** Legal moves in standard UCI, promotions to queen only. */
export function legalUcis(key: PositionKey): Uci[] {
  const pos = positionFromFen(key)
  const moves = new Set<Uci>()
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from)
      const lastRank = to >> 3 === 0 || to >> 3 === 7
      const promotion = piece?.role === 'pawn' && lastRank ? 'queen' : undefined
      const uci = toStandardUci(pos, makeUci({ from, to, promotion }))
      if (uci) moves.add(uci)
    }
  }
  return [...moves]
}

/**
 * Explorer backed by a table keyed by move path ('e2e4 e7e6'), or by a function of the position.
 * Each count goes to `white`, so the total equals the sum of counts.
 */
export function fakeExplorer(
  source: Record<string, MoveCounts> | ((key: PositionKey) => MoveCounts),
): ExplorerSource & { calls: PositionKey[] } {
  const byKey =
    typeof source === 'function'
      ? undefined
      : new Map(Object.entries(source).map(([path, moves]) => [keyAfter(pathMoves(path)), moves]))
  const calls: PositionKey[] = []
  return {
    calls,
    async query(fen) {
      const key = positionKey(fen)
      calls.push(key)
      const counts = typeof source === 'function' ? source(key) : (byKey?.get(key) ?? [])
      const moves = counts.map(([uci, games]) => ({
        uci,
        san: '',
        white: games,
        draws: 0,
        black: 0,
      }))
      return { white: moves.reduce((sum, m) => sum + m.white, 0), draws: 0, black: 0, moves }
    },
  }
}

/**
 * Engine backed by a table keyed by move path. Without an entry, every candidate scores 0 and the
 * best move is the first candidate, or the first legal move when there is no candidate.
 */
export function fakeEngine(
  table: Record<string, Record<Uci, number>> = {},
): Engine & { calls: PositionKey[] } {
  const byKey = new Map(
    Object.entries(table).map(([path, evals]) => [keyAfter(pathMoves(path)), evals]),
  )
  const calls: PositionKey[] = []
  return {
    calls,
    async evaluate(fen, candidates) {
      const key = positionKey(fen)
      calls.push(key)
      const evals = byKey.get(key) ?? Object.fromEntries(candidates.map((c) => [c, 0]))
      const ranked = Object.entries(evals).sort((a, b) => b[1] - a[1])
      const [bestUci, bestCp]: [Uci, number] = ranked[0] ?? [legalUcis(key)[0]!, 0]
      return {
        best: { uci: bestUci, cp: bestCp },
        candidates: Object.fromEntries(candidates.map((c) => [c, evals[c] ?? -Infinity])),
      }
    },
  }
}
