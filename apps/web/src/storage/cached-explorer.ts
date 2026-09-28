import {
  type ExplorerFilters,
  type ExplorerResult,
  type ExplorerSource,
  positionKey,
} from '@chess-trainer/core'
import type { TrainerDb } from './db'

function cacheKey(fen: string, filters: ExplorerFilters): string {
  const speeds = [...filters.speeds].sort().join(',')
  const ratings = [...filters.ratings].sort((a, b) => a - b).join(',')
  return `lichess|${speeds}|${ratings}|${positionKey(fen)}`
}

export class CachedExplorerSource implements ExplorerSource {
  constructor(
    private readonly db: TrainerDb,
    private readonly inner: ExplorerSource,
  ) {}

  async query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult> {
    const key = cacheKey(fen, filters)
    const hit = await this.db.explorerCache.get(key)
    if (hit) return hit.result
    const result = await this.inner.query(fen, filters)
    await this.db.explorerCache.put({ key, result, fetchedAt: Date.now() })
    return result
  }

  async peek(fen: string, filters: ExplorerFilters): Promise<ExplorerResult | undefined> {
    return (await this.db.explorerCache.get(cacheKey(fen, filters)))?.result
  }
}
