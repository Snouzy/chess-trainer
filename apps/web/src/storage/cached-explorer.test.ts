import 'fake-indexeddb/auto'
import { INITIAL_KEY } from '@chess-trainer/core'
import { fakeExplorer } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { CachedExplorerSource } from './cached-explorer'
import { TrainerDb } from './db'

const FILTERS = { ratings: [1800, 1600], speeds: ['rapid' as const, 'blitz' as const] }

function setup() {
  const inner = fakeExplorer({ '': [['e2e4', 10]] })
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  return { inner, explorer: new CachedExplorerSource(db, inner) }
}

describe('CachedExplorerSource', () => {
  it('queries once per position and filters', async () => {
    const { inner, explorer } = setup()
    const first = await explorer.query(`${INITIAL_KEY} 0 1`, FILTERS)
    const second = await explorer.query(INITIAL_KEY, {
      ratings: [1600, 1800],
      speeds: ['blitz', 'rapid'],
    })
    expect(second).toEqual(first)
    expect(inner.calls).toHaveLength(1)
  })

  it('misses when the filters differ', async () => {
    const { inner, explorer } = setup()
    await explorer.query(INITIAL_KEY, FILTERS)
    await explorer.query(INITIAL_KEY, { ...FILTERS, ratings: [2000] })
    expect(inner.calls).toHaveLength(2)
  })

  it('peeks without querying', async () => {
    const { inner, explorer } = setup()
    expect(await explorer.peek(INITIAL_KEY, FILTERS)).toBeUndefined()
    await explorer.query(INITIAL_KEY, FILTERS)
    expect(await explorer.peek(INITIAL_KEY, FILTERS)).toBeDefined()
    expect(inner.calls).toHaveLength(1)
  })

  it('finds an entry cached under the existing key format', async () => {
    const db = new TrainerDb(`test-${crypto.randomUUID()}`)
    const explorer = new CachedExplorerSource(db, fakeExplorer({}))
    const result = { white: 1, draws: 0, black: 0, moves: [] }
    const key = `lichess|blitz,rapid|1600,1800|${INITIAL_KEY}`
    await db.explorerCache.put({ key, result, fetchedAt: Date.now() })
    expect(await explorer.peek(INITIAL_KEY, FILTERS)).toEqual(result)
  })
})
