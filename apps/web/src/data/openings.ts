import type { Opening } from '@chess-trainer/core'
import raw from './openings.json'

export const OPENINGS: Opening[] = (raw as Array<{ eco: string; name: string; moves: string }>).map(
  (o) => ({ eco: o.eco, name: o.name, moves: o.moves.split(' ') }),
)
