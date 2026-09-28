export type Uci = string
export type PositionKey = string
export type Color = 'white' | 'black'
export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical'

export interface Settings {
  ratings: number[]
  speeds: Speed[]
  minLineProbability: number
  engineToleranceCp: number
  minGames: number
  maxPly: number
}

export const DEFAULT_SETTINGS: Settings = {
  ratings: [1200, 1400],
  speeds: ['rapid'],
  minLineProbability: 0.01,
  engineToleranceCp: 30,
  minGames: 50,
  maxPly: 30,
}

export type RepertoireStatus = 'generating' | 'paused' | 'ready' | 'error'

export interface Repertoire {
  id: string
  name: string
  color: Color
  rootMoves: Uci[]
  settings: Settings
  status: RepertoireStatus
  createdAt: number
  updatedAt: number
}

export interface Reply {
  uci: Uci
  share: number
  forced?: boolean
}

export type LeafReason = 'threshold' | 'minGames' | 'maxPly' | 'noMoves'

export interface RepNode {
  repertoireId: string
  path: string
  positionKey: PositionKey
  ply: number
  probability: number
  side: 'mine' | 'theirs'
  expanded: boolean
  replies?: Reply[]
  leafReason?: LeafReason
}

export interface Choice {
  repertoireId: string
  positionKey: PositionKey
  uci: Uci
  source: 'auto' | 'user' | 'prefix'
}

export interface PositionStats {
  repertoireId: string
  positionKey: PositionKey
  attempts: number
  errors: number
  lastResult?: 'ok' | 'ko'
  lastSeenAt?: number
}

export interface StatUpdate {
  positionKey: PositionKey
  result: 'ok' | 'ko'
}

export interface ExplorerFilters {
  ratings: number[]
  speeds: Speed[]
}

export interface ExplorerMove {
  uci: Uci
  san: string
  white: number
  draws: number
  black: number
}

export interface ExplorerResult {
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
}

/** Centipawns from the side to move. Mate in N is MATE_SCORE - N, mated in N is -(MATE_SCORE - N). */
export interface EngineResult {
  best: { uci: Uci; cp: number }
  candidates: Record<Uci, number>
}

export const MATE_SCORE = 100_000
