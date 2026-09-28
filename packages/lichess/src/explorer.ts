import {
  type ExplorerFilters,
  type ExplorerMove,
  type ExplorerResult,
  type ExplorerSource,
  InvalidResponseError,
} from '@chess-trainer/core'
import { LichessAuthError } from './errors'
import type { RequestQueue } from './queue'

export const EXPLORER_BASE = 'https://explorer.lichess.org'

export function buildExplorerUrl(fen: string, filters: ExplorerFilters): string {
  const params = new URLSearchParams({
    variant: 'standard',
    fen,
    moves: '12',
    topGames: '0',
    recentGames: '0',
  })
  if (filters.speeds.length > 0) params.set('speeds', filters.speeds.join(','))
  if (filters.ratings.length > 0) params.set('ratings', filters.ratings.join(','))
  return `${EXPLORER_BASE}/lichess?${params}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidResponseError(`Expected a game count, got ${JSON.stringify(value)}`)
  }
  return value
}

function parseMove(value: unknown): ExplorerMove {
  if (!isRecord(value) || typeof value.uci !== 'string' || typeof value.san !== 'string') {
    throw new InvalidResponseError('Explorer move without uci or san')
  }
  return {
    uci: value.uci,
    san: value.san,
    white: count(value.white),
    draws: count(value.draws),
    black: count(value.black),
  }
}

export function parseExplorerResponse(json: unknown): ExplorerResult {
  if (!isRecord(json) || !Array.isArray(json.moves)) {
    throw new InvalidResponseError('Explorer response without moves')
  }
  return {
    white: count(json.white),
    draws: count(json.draws),
    black: count(json.black),
    moves: json.moves.map(parseMove),
  }
}

export class LichessExplorer implements ExplorerSource {
  constructor(
    private readonly queue: RequestQueue,
    private readonly getToken: () => string | undefined,
  ) {}

  async query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult> {
    const token = this.getToken()
    if (!token) throw new LichessAuthError('Not logged in to Lichess')
    const response = await this.queue.run(buildExplorerUrl(fen, filters), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    const json: unknown = await response.json().catch(() => {
      throw new InvalidResponseError('Explorer response is not JSON')
    })
    return parseExplorerResponse(json)
  }
}
