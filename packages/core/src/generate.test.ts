import { describe, expect, it } from 'vitest'
import { keyAfter, pathMoves, sanLineToUci } from './chess'
import { addReply, removeReply } from './edit'
import { InvalidResponseError } from './errors'
import { initRepertoire, makeChild, runGeneration } from './generate'
import type { ExplorerSource } from './ports'
import {
  FRENCH,
  fakeEngine,
  fakeExplorer,
  frenchEngine,
  frenchExplorer,
  legalUcis,
  MemoryStore,
} from './testing'
import type { Repertoire } from './types'

const key = (path: string) => keyAfter(pathMoves(path))

async function generate(
  repertoire: Repertoire,
  explorer: ExplorerSource = frenchExplorer(),
  engine = frenchEngine(),
) {
  const store = new MemoryStore()
  await initRepertoire(repertoire, store)
  let expansions = 0
  const outcome = await runGeneration({
    repertoire,
    store,
    explorer,
    engine,
    onProgress: (p) => {
      expansions = p.expanded
    },
  })
  return { store, outcome, expansions, node: (path: string) => store.getNode(repertoire.id, path) }
}

function gatedExplorer(path: string) {
  const inner = frenchExplorer()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reached!: () => void
  const blocked = new Promise<void>((resolve) => {
    reached = resolve
  })
  const explorer: ExplorerSource = {
    query: async (fen, filters) => {
      if (fen === key(path)) {
        reached()
        await gate
      }
      return inner.query(fen, filters)
    },
  }
  return { explorer, blocked, release }
}

describe('initRepertoire', () => {
  it('stores the opening moves as a forced prefix', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    expect(await store.getNode('french', '')).toMatchObject({
      side: 'theirs',
      expanded: true,
      replies: [{ uci: 'e2e4', share: 1 }],
    })
    expect(await store.getChoice('french', key('e2e4'))).toMatchObject({
      uci: 'e7e6',
      source: 'prefix',
    })
    expect(await store.getNode('french', 'e2e4 e7e6')).toMatchObject({
      probability: 1,
      side: 'theirs',
      expanded: false,
      ply: 2,
    })
  })
})

describe('runGeneration', () => {
  it('builds the French fixture tree', async () => {
    const { store, outcome } = await generate(FRENCH)
    expect(outcome).toBe('done')
    expect(store.allNodes('french').map((n) => n.path)).toEqual([
      '',
      'e2e4',
      'e2e4 e7e6',
      'e2e4 e7e6 d2d3',
      'e2e4 e7e6 d2d3 d7d5',
      'e2e4 e7e6 d2d4',
      'e2e4 e7e6 d2d4 d7d5',
    ])
  })

  it('keeps opponent replies above the line probability threshold', async () => {
    const { node } = await generate(FRENCH)
    expect((await node('e2e4 e7e6'))?.replies).toEqual([
      { uci: 'd2d4', share: 0.7 },
      { uci: 'd2d3', share: 0.2 },
    ])
    expect((await node('e2e4 e7e6 d2d4'))?.probability).toBeCloseTo(0.7)
  })

  it('picks the most played move within the engine tolerance', async () => {
    const { store } = await generate(FRENCH)
    expect((await store.getChoice('french', key('e2e4 e7e6 d2d3')))?.uci).toBe('d7d5')
  })

  it('skips a popular move the engine rejects', async () => {
    const engine = fakeEngine({ 'e2e4 e7e6 d2d4': { d7d5: -200, c7c5: -20 } })
    const { store } = await generate(FRENCH, frenchExplorer(), engine)
    expect((await store.getChoice('french', key('e2e4 e7e6 d2d4')))?.uci).toBe('c7c5')
  })

  it('falls back to the engine best move when no candidate is close enough', async () => {
    const engine = fakeEngine({ 'e2e4 e7e6 d2d4': { d7d5: -200, c7c5: -150, b7b6: -20 } })
    const { store } = await generate(FRENCH, frenchExplorer(), engine)
    expect((await store.getChoice('french', key('e2e4 e7e6 d2d4')))?.uci).toBe('b7b6')
  })

  it('reuses an existing choice for the same position without querying', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    await store.putChoice({
      repertoireId: 'french',
      positionKey: key('e2e4 e7e6 d2d4'),
      uci: 'c7c5',
      source: 'user',
    })
    const explorer = frenchExplorer()
    await runGeneration({ repertoire: FRENCH, store, explorer, engine: frenchEngine() })
    expect(explorer.calls).not.toContain(key('e2e4 e7e6 d2d4'))
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toBeDefined()
  })

  it('marks leaves with their reason', async () => {
    const { node } = await generate(FRENCH)
    expect((await node('e2e4 e7e6 d2d4 d7d5'))?.leafReason).toBe('maxPly')

    const few = await generate({ ...FRENCH, settings: { ...FRENCH.settings, minGames: 5000 } })
    expect((await few.node('e2e4 e7e6'))?.leafReason).toBe('minGames')

    const rare = await generate({
      ...FRENCH,
      settings: { ...FRENCH.settings, minLineProbability: 0.9 },
    })
    expect((await rare.node('e2e4 e7e6'))?.leafReason).toBe('threshold')
  })

  it('stores king-takes-rook castling from the explorer as standard UCI', async () => {
    const rootMoves = sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5')
    const repertoire = { ...FRENCH, rootMoves, settings: { ...FRENCH.settings, maxPly: 8 } }
    const explorer = fakeExplorer({
      [rootMoves.join(' ')]: [
        ['e1h1', 600],
        ['c2c3', 400],
      ],
    })
    const { node } = await generate(repertoire, explorer, fakeEngine())
    expect((await node(rootMoves.join(' ')))?.replies?.map((r) => r.uci)).toEqual(['e1g1', 'c2c3'])
  })

  it('turns an invalid explorer response into a leaf and continues', async () => {
    const inner = frenchExplorer()
    const explorer: ExplorerSource = {
      query: async (fen, filters) =>
        fen === key('e2e4 e7e6')
          ? Promise.reject(new InvalidResponseError('garbled'))
          : inner.query(fen, filters),
    }
    const { node, outcome } = await generate(FRENCH, explorer)
    expect(outcome).toBe('done')
    expect((await node('e2e4 e7e6'))?.leafReason).toBe('noMoves')
  })

  it('resumes after an abort and ends with the same tree as a single run', async () => {
    const single = await generate(FRENCH)

    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    const controller = new AbortController()
    const expansions = [0, 0]
    const first = await runGeneration({
      repertoire: FRENCH,
      store,
      explorer: frenchExplorer(),
      engine: frenchEngine(),
      signal: controller.signal,
      onProgress: (p) => {
        expansions[0] = p.expanded
        if (p.expanded === 2) controller.abort()
      },
    })
    expect(first).toBe('aborted')
    const second = await runGeneration({
      repertoire: FRENCH,
      store,
      explorer: frenchExplorer(),
      engine: frenchEngine(),
      onProgress: (p) => {
        expansions[1] = p.expanded
      },
    })
    expect(second).toBe('done')
    expect(store.allNodes('french')).toEqual(single.store.allNodes('french'))
    expect(store.allChoices('french')).toEqual(single.store.allChoices('french'))
    expect(expansions[0]! + expansions[1]!).toBe(single.expansions)
  })

  it('resumes after a stop between the child writes and the parent write without expanding twice', async () => {
    const single = await generate(FRENCH)

    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    const parent = (await store.getNode('french', 'e2e4 e7e6'))!
    await store.putNode(makeChild(parent, 'd2d4', 0.7))
    await store.putNode(makeChild(parent, 'd2d3', 0.2))
    let expansions = 0
    const outcome = await runGeneration({
      repertoire: FRENCH,
      store,
      explorer: frenchExplorer(),
      engine: frenchEngine(),
      onProgress: (p) => {
        expansions = p.expanded
      },
    })

    expect(outcome).toBe('done')
    expect(store.allNodes('french')).toEqual(single.store.allNodes('french'))
    expect(expansions).toBe(single.expansions)
  })

  it('skips a queued node that an edit deleted while the run waited', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    const gated = gatedExplorer('e2e4 e7e6 d2d4')
    const run = runGeneration({
      repertoire: FRENCH,
      store,
      explorer: gated.explorer,
      engine: frenchEngine(),
    })
    await gated.blocked
    await removeReply(store, 'french', 'e2e4 e7e6', 'd2d3')
    gated.release()

    expect(await run).toBe('done')
    expect(store.allNodes('french').filter((n) => n.path.startsWith('e2e4 e7e6 d2d3'))).toEqual([])
  })

  it('expands a node that an edit added while the run waited', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    const gated = gatedExplorer('e2e4 e7e6 d2d4')
    const run = runGeneration({
      repertoire: FRENCH,
      store,
      explorer: gated.explorer,
      engine: frenchEngine(),
    })
    await gated.blocked
    await addReply(store, 'french', 'e2e4 e7e6', 'g1f3', 0.08)
    gated.release()

    expect(await run).toBe('done')
    expect(await store.getNode('french', 'e2e4 e7e6 g1f3')).toMatchObject({ expanded: true })
  })

  it('bounds the number of lines by the probability threshold', async () => {
    const explorer = fakeExplorer((k) =>
      legalUcis(k)
        .slice(0, 4)
        .map((uci) => [uci, 100]),
    )
    const repertoire = {
      ...FRENCH,
      rootMoves: [],
      color: 'white' as const,
      settings: { ...FRENCH.settings, minLineProbability: 0.05, maxPly: 30 },
    }
    const { store, outcome } = await generate(repertoire, explorer, fakeEngine())
    expect(outcome).toBe('done')
    const leaves = store.allNodes('french').filter((n) => n.leafReason)
    expect(leaves.length).toBeGreaterThan(0)
    expect(leaves.length).toBeLessThanOrEqual(20)
  })
})
