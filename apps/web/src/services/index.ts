import { LichessExplorer, RequestQueue } from '@chess-trainer/lichess'
import { CachedEngine } from '../engine/cached-engine'
import { StockfishEngine } from '../engine/stockfish-engine'
import { CachedExplorerSource } from '../storage/cached-explorer'
import { TrainerDb } from '../storage/db'
import { DexieStore } from '../storage/dexie-store'
import { clearToken, getToken } from './auth'
import { GenerationRunner } from './runner'

export const db = new TrainerDb()
export const store = new DexieStore(db)

const queue = new RequestQueue((url, init) => fetch(url, init), {
  onStatus: (status) => runner.setQueueStatus(status),
})
export const explorer = new CachedExplorerSource(db, new LichessExplorer(queue, getToken))

const engine = new CachedEngine(db, () => new StockfishEngine())
export const runner = new GenerationRunner({
  db,
  store,
  explorer,
  engine,
  onAuthError: clearToken,
})
