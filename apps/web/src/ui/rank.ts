import type { PositionKey, PositionStats, RepNode } from '@chess-trainer/core'

export type RankedPosition = PositionStats & { path: string; rate: number }

export function rankPositions(
  nodes: readonly RepNode[],
  stats: readonly PositionStats[],
): RankedPosition[] {
  const shortest = new Map<PositionKey, { path: string; ply: number }>()
  for (const n of nodes) {
    if (n.side !== 'mine') continue
    const known = shortest.get(n.positionKey)
    if (
      known === undefined ||
      n.ply < known.ply ||
      (n.ply === known.ply && n.path.length < known.path.length)
    ) {
      shortest.set(n.positionKey, { path: n.path, ply: n.ply })
    }
  }
  return stats
    .flatMap((s) => {
      const path = shortest.get(s.positionKey)?.path
      return path === undefined || s.attempts === 0
        ? []
        : [{ ...s, path, rate: s.errors / s.attempts }]
    })
    .sort((a, b) => b.rate - a.rate || b.errors - a.errors)
}
