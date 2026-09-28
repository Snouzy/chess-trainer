import { InvalidResponseError } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { LichessAuthError } from './errors'
import { buildExplorerUrl, LichessExplorer, parseExplorerResponse } from './explorer'
import fixture from './fixtures/french-after-e4-e6.json'
import { RequestQueue } from './queue'

const FEN = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'
const FILTERS = { ratings: [1600, 1800], speeds: ['blitz' as const, 'rapid' as const] }
const instant = { sleep: async () => {}, now: () => 0 }

describe('buildExplorerUrl', () => {
  it('encodes the position and the filters', () => {
    const url = new URL(buildExplorerUrl(FEN, FILTERS))
    expect(url.origin + url.pathname).toBe('https://explorer.lichess.org/lichess')
    expect(url.searchParams.get('fen')).toBe(FEN)
    expect(url.searchParams.get('variant')).toBe('standard')
    expect(url.searchParams.get('speeds')).toBe('blitz,rapid')
    expect(url.searchParams.get('ratings')).toBe('1600,1800')
    expect(url.searchParams.get('topGames')).toBe('0')
  })
})

describe('parseExplorerResponse', () => {
  it('keeps totals and moves', () => {
    const result = parseExplorerResponse(fixture)
    expect(result.white + result.draws + result.black).toBe(3_000_000)
    expect(result.moves.map((m) => m.uci)).toEqual(['d2d4', 'd2d3', 'g1f3'])
    expect(result.moves[0]).toMatchObject({ san: 'd4', white: 1_100_000 })
  })

  it('rejects a response without moves', () => {
    expect(() => parseExplorerResponse({ white: 1 })).toThrow(InvalidResponseError)
    expect(() => parseExplorerResponse(null)).toThrow(InvalidResponseError)
  })

  it('rejects a move with a missing count', () => {
    const bad = { ...fixture, moves: [{ uci: 'd2d4', san: 'd4', white: 1, draws: 1 }] }
    expect(() => parseExplorerResponse(bad)).toThrow(InvalidResponseError)
  })
})

describe('LichessExplorer', () => {
  it('sends the bearer token and parses the answer', async () => {
    const inits: RequestInit[] = []
    const fetch = async (_url: string, init?: RequestInit) => {
      inits.push(init ?? {})
      return new Response(JSON.stringify(fixture), { status: 200 })
    }
    const explorer = new LichessExplorer(new RequestQueue(fetch, instant), () => 'tok')
    const result = await explorer.query(FEN, FILTERS)
    expect(result.moves).toHaveLength(3)
    expect(new Headers(inits[0]?.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('refuses to query without a token', async () => {
    let called = false
    const fetch = async () => {
      called = true
      return new Response('{}')
    }
    const explorer = new LichessExplorer(new RequestQueue(fetch, instant), () => undefined)
    await expect(explorer.query(FEN, FILTERS)).rejects.toBeInstanceOf(LichessAuthError)
    expect(called).toBe(false)
  })

  it('turns a non-JSON body into an InvalidResponseError', async () => {
    const fetch = async () => new Response('<html>oops</html>', { status: 200 })
    const explorer = new LichessExplorer(new RequestQueue(fetch, instant), () => 'tok')
    await expect(explorer.query(FEN, FILTERS)).rejects.toBeInstanceOf(InvalidResponseError)
  })
})
