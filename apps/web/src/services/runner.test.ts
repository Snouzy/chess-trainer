import 'fake-indexeddb/auto'
import {
  changeChoice,
  EngineError,
  type ExplorerSource,
  initRepertoire,
  keyAfter,
  pathMoves,
} from '@chess-trainer/core'
import { FRENCH, frenchEngine, frenchExplorer } from '@chess-trainer/core/testing'
import { LichessAuthError } from '@chess-trainer/lichess'
import { describe, expect, it } from 'vitest'
import { TrainerDb } from '../storage/db'
import { DexieStore } from '../storage/dexie-store'
import { GenerationRunner, type RunnerDeps } from './runner'

async function setup(explorer: ExplorerSource = frenchExplorer(), deps: Partial<RunnerDeps> = {}) {
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  const store = new DexieStore(db)
  await db.repertoires.put(FRENCH)
  await initRepertoire(FRENCH, store)
  const runner = new GenerationRunner({ db, store, explorer, engine: frenchEngine(), ...deps })
  return { db, store, runner }
}

const failing = (error: unknown): ExplorerSource => ({ query: () => Promise.reject(error) })

describe('GenerationRunner', () => {
  it('generates pending repertoires and marks them ready', async () => {
    const { db, store, runner } = await setup()
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('ready')
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 d7d5')).toBeDefined()
    expect(runner.getState().activeId).toBeUndefined()
  })

  it('keeps the status on auth errors so the run resumes after login', async () => {
    let authErrors = 0
    const { db, runner } = await setup(failing(new LichessAuthError('no token')), {
      onAuthError: () => authErrors++,
    })
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('generating')
    expect(runner.getState()).toMatchObject({ messageFor: 'french' })
    expect(runner.getState().message).toMatch(/Lichess/)
    expect(authErrors).toBe(1)
  })

  it('pauses on network errors', async () => {
    const { db, runner } = await setup(failing(new TypeError('offline')))
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('paused')
    expect(runner.getState().message).toMatch(/Réseau indisponible/)
  })

  it('pauses on an unknown error and shows its message', async () => {
    const { db, runner } = await setup(failing(new Error('boom')))
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('paused')
    expect(runner.getState().message).toBe('La génération s’est arrêtée : boom.')
  })

  it('marks the repertoire in error when Stockfish fails', async () => {
    const { db, runner } = await setup(frenchExplorer(), {
      engine: { evaluate: () => Promise.reject(new EngineError('crashed')) },
    })
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('error')
    expect(runner.getState().message).toMatch(/Reprendre/)
  })

  it('pauses the active run on request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = frenchExplorer()
    const slow: ExplorerSource = {
      query: async (fen, filters) => {
        await gate
        return inner.query(fen, filters)
      },
    }
    const { db, runner } = await setup(slow)
    const active = new Promise<void>((resolve) => {
      const off = runner.subscribe(() => {
        if (runner.getState().activeId !== 'french') return
        off()
        resolve()
      })
    })
    const done = runner.kick()
    await active
    const paused = runner.pause('french')
    release()
    await paused
    expect(runner.getState().activeId).toBeUndefined()
    expect((await db.repertoires.get('french'))?.status).toBe('paused')
    await done
  })

  it('generates an edit made while paused before it marks the repertoire ready', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const blocked = new Promise<void>((resolve) => {
      reached = resolve
    })
    const inner = frenchExplorer()
    const d2d3 = keyAfter(pathMoves('e2e4 e7e6 d2d3'))
    const gated: ExplorerSource = {
      query: async (fen, filters) => {
        if (fen === d2d3) {
          reached()
          await gate
        }
        return inner.query(fen, filters)
      },
    }
    const { db, store, runner } = await setup(gated)
    void runner.kick()
    await blocked
    const paused = runner.pause('french')
    release()
    await paused

    await changeChoice(store, 'french', keyAfter(pathMoves('e2e4 e7e6 d2d4')), 'c7c5')
    await runner.start('french')
    await runner.kick()

    expect((await db.repertoires.get('french'))?.status).toBe('ready')
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toMatchObject({ expanded: true })
  })

  it('runs queued repertoires one after the other', async () => {
    const { db, runner } = await setup()
    const second = { ...FRENCH, id: 'second', createdAt: 1 }
    await db.repertoires.put(second)
    await initRepertoire(second, new DexieStore(db))
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('ready')
    expect((await db.repertoires.get('second'))?.status).toBe('ready')
  })
})
