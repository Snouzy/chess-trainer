import type { Uci } from './types'

export interface Opening {
  eco: string
  name: string
  moves: Uci[]
}

export function findOpening(
  openings: readonly Opening[],
  line: readonly Uci[],
): Opening | undefined {
  let best: Opening | undefined
  for (const opening of openings) {
    if (opening.moves.length > line.length) continue
    if (best && opening.moves.length <= best.moves.length) continue
    if (opening.moves.every((move, i) => move === line[i])) best = opening
  }
  return best
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function searchOpenings(openings: readonly Opening[], query: string, limit = 20): Opening[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return openings
    .filter((o) => {
      const haystack = normalize(`${o.eco} ${o.name}`)
      return words.every((w) => haystack.includes(w))
    })
    .sort((a, b) => a.moves.length - b.moves.length)
    .slice(0, limit)
}
