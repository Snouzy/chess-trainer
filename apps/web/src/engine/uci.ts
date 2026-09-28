import { MATE_SCORE, type Uci } from '@chess-trainer/core'

export interface InfoLine {
  multipv: number
  cp: number
  move: Uci
}

function numberAfter(tokens: string[], name: string): number | undefined {
  const i = tokens.indexOf(name)
  const value = i >= 0 ? Number(tokens[i + 1]) : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

/** Scores are from the side to move. Bound lines are skipped: their score is not exact. */
export function parseInfo(line: string): InfoLine | undefined {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'info' || tokens.includes('lowerbound') || tokens.includes('upperbound')) return
  const scoreAt = tokens.indexOf('score')
  const move = tokens[tokens.indexOf('pv') + 1]
  if (scoreAt < 0 || !tokens.includes('pv') || !move) return
  const value = Number(tokens[scoreAt + 2])
  if (!Number.isFinite(value)) return
  const kind = tokens[scoreAt + 1]
  const cp =
    kind === 'cp'
      ? value
      : kind === 'mate'
        ? Math.sign(value) * (MATE_SCORE - Math.abs(value))
        : undefined
  if (cp === undefined) return
  return { multipv: numberAfter(tokens, 'multipv') ?? 1, cp, move }
}
