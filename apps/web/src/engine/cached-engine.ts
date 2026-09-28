import {
  type Engine,
  EngineError,
  type EngineResult,
  positionKey,
  type Uci,
} from '@chess-trainer/core'
import type { TrainerDb } from '../storage/db'

export async function cachedEvals(db: TrainerDb, fen: string): Promise<EngineResult | undefined> {
  return (await db.engineCache.get(positionKey(fen)))?.result
}

export class CachedEngine implements Engine {
  private engine: Engine | undefined

  constructor(
    private readonly db: TrainerDb,
    private readonly inner: () => Engine,
  ) {}

  async evaluate(fen: string, candidates: Uci[]): Promise<EngineResult> {
    const key = positionKey(fen)
    const hit = await cachedEvals(this.db, key)
    if (hit && candidates.every((c) => c in hit.candidates)) return hit
    this.engine ??= this.inner()
    let fresh: EngineResult
    try {
      fresh = await this.engine.evaluate(key, candidates)
    } catch (error) {
      if (error instanceof EngineError) this.engine = undefined
      throw error
    }
    const merged = { ...fresh, candidates: { ...hit?.candidates, ...fresh.candidates } }
    await this.db.engineCache.put({ positionKey: key, result: merged })
    return merged
  }
}
