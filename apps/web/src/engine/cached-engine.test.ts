import 'fake-indexeddb/auto'
import { type Engine, EngineError, INITIAL_KEY } from '@chess-trainer/core'
import { fakeEngine } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { TrainerDb } from '../storage/db'
import { CachedEngine, cachedEvals } from './cached-engine'

describe('CachedEngine', () => {
  it('evaluates once and merges new candidates into the cache', async () => {
    const db = new TrainerDb(`test-${crypto.randomUUID()}`)
    const inner = fakeEngine({ '': { e2e4: 30, d2d4: 25, g1f3: 20 } })
    let created = 0
    const engine = new CachedEngine(db, () => {
      created++
      return inner
    })

    await engine.evaluate(INITIAL_KEY, ['e2e4', 'd2d4'])
    await engine.evaluate(`${INITIAL_KEY} 0 1`, ['d2d4'])
    expect(inner.calls).toHaveLength(1)

    await engine.evaluate(INITIAL_KEY, ['g1f3'])
    expect(inner.calls).toHaveLength(2)
    expect((await cachedEvals(db, INITIAL_KEY))?.candidates).toEqual({
      e2e4: 30,
      d2d4: 25,
      g1f3: 20,
    })
    expect(created).toBe(1)
  })

  it('creates a fresh engine after an engine failure', async () => {
    const db = new TrainerDb(`test-${crypto.randomUUID()}`)
    const crashed: Engine = { evaluate: () => Promise.reject(new EngineError('crashed')) }
    let created = 0
    const engine = new CachedEngine(db, () => (++created === 1 ? crashed : fakeEngine()))

    await expect(engine.evaluate(INITIAL_KEY, ['e2e4'])).rejects.toBeInstanceOf(EngineError)
    await expect(engine.evaluate(INITIAL_KEY, ['e2e4'])).resolves.toMatchObject({
      candidates: { e2e4: 0 },
    })
    expect(created).toBe(2)
  })
})
