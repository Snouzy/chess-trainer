import type {
  Choice,
  EngineResult,
  ExplorerResult,
  PositionKey,
  PositionStats,
  Repertoire,
  RepNode,
} from '@chess-trainer/core'
import Dexie, { type EntityTable, type Table } from 'dexie'

export interface ExplorerCacheEntry {
  key: string
  result: ExplorerResult
  fetchedAt: number
}

export interface EngineCacheEntry {
  positionKey: PositionKey
  result: EngineResult
}

export class TrainerDb extends Dexie {
  repertoires!: EntityTable<Repertoire, 'id'>
  nodes!: Table<RepNode, [string, string]>
  choices!: Table<Choice, [string, string]>
  stats!: Table<PositionStats, [string, string]>
  explorerCache!: EntityTable<ExplorerCacheEntry, 'key'>
  engineCache!: EntityTable<EngineCacheEntry, 'positionKey'>

  constructor(name = 'chess-trainer') {
    super(name)
    // IndexedDB cannot index booleans: never add an index on nodes.expanded.
    this.version(1).stores({
      repertoires: 'id, status, createdAt',
      nodes: '[repertoireId+path], [repertoireId+positionKey]',
      choices: '[repertoireId+positionKey]',
      stats: '[repertoireId+positionKey]',
      explorerCache: 'key',
      engineCache: 'positionKey',
    })
  }
}
