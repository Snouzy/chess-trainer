import type {
  Choice,
  EngineResult,
  ExplorerFilters,
  ExplorerResult,
  PositionKey,
  RepNode,
  Uci,
} from './types'

export interface ExplorerSource {
  query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult>
}

export interface Engine {
  evaluate(fen: string, candidates: Uci[]): Promise<EngineResult>
}

export interface RepertoireStore {
  putNode(node: RepNode): Promise<void>
  getNode(repertoireId: string, path: string): Promise<RepNode | undefined>
  unexpandedNodes(repertoireId: string): Promise<RepNode[]>
  nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]>
  deleteSubtree(repertoireId: string, path: string): Promise<void>
  getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined>
  putChoice(choice: Choice): Promise<void>
}
