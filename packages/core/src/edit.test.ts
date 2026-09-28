import { describe, expect, it } from 'vitest'
import { keyAfter, pathMoves, sanLineToUci } from './chess'
import { addReply, changeChoice, removeReply } from './edit'
import { initRepertoire, makeChild, runGeneration } from './generate'
import {
  FRENCH,
  fakeEngine,
  fakeExplorer,
  frenchEngine,
  frenchExplorer,
  generateFrench,
  MemoryStore,
} from './testing'
import type { RepNode } from './types'

const key = (path: string) => keyAfter(pathMoves(path))
const regenerate = (store: Awaited<ReturnType<typeof generateFrench>>['store']) =>
  runGeneration({ repertoire: FRENCH, store, explorer: frenchExplorer(), engine: frenchEngine() })

describe('changeChoice', () => {
  it('replaces my move and regenerates the subtree below it', async () => {
    const { store } = await generateFrench()
    await changeChoice(store, 'french', key('e2e4 e7e6 d2d4'), 'c7c5')

    expect(await store.getChoice('french', key('e2e4 e7e6 d2d4'))).toMatchObject({
      uci: 'c7c5',
      source: 'user',
    })
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 d7d5')).toBeUndefined()
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toMatchObject({ expanded: false })

    await regenerate(store)
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toMatchObject({
      expanded: true,
      leafReason: 'maxPly',
    })
  })

  it('refuses to change a move of the chosen opening', async () => {
    const { store } = await generateFrench()
    await expect(changeChoice(store, 'french', key('e2e4'), 'c7c5')).rejects.toThrow(/opening/)
  })

  it('refuses an illegal move', async () => {
    const { store } = await generateFrench()
    await expect(changeChoice(store, 'french', key('e2e4 e7e6 d2d4'), 'e8e6')).rejects.toThrow()
  })

  it('replaces my move under every node that reaches the position by transposition', async () => {
    const paths = ['g1f3 d7d5 d2d4', 'd2d4 d7d5 g1f3']
    const target = key(paths[0]!)
    expect(key(paths[1]!)).toBe(target)
    const store = new MemoryStore()
    await store.putChoice({ repertoireId: 'r', positionKey: target, uci: 'g8f6', source: 'auto' })
    for (const path of paths) {
      const node: RepNode = {
        repertoireId: 'r',
        path,
        positionKey: target,
        ply: 3,
        probability: 0.5,
        side: 'mine',
        expanded: true,
      }
      const child = { ...makeChild(node, 'g8f6', 0.5), expanded: true }
      await store.putNode(node)
      await store.putNode(child)
      await store.putNode(makeChild(child, 'c2c4', 0.5))
    }

    await changeChoice(store, 'r', target, 'c7c5')

    expect(store.allNodes('r').map((n) => n.path)).toEqual([
      'd2d4 d7d5 g1f3',
      'd2d4 d7d5 g1f3 c7c5',
      'g1f3 d7d5 d2d4',
      'g1f3 d7d5 d2d4 c7c5',
    ])
    for (const path of paths) {
      expect(await store.getNode('r', `${path} c7c5`)).toMatchObject({
        probability: 0.5,
        expanded: false,
      })
    }
  })

  it('does nothing when the move is unchanged', async () => {
    const { store } = await generateFrench()
    const before = store.allNodes('french')
    await changeChoice(store, 'french', key('e2e4 e7e6 d2d4'), 'd7d5')
    expect(store.allNodes('french')).toEqual(before)
  })
})

describe('addReply', () => {
  it('adds a forced opponent branch generated with the parent probability', async () => {
    const { store } = await generateFrench()
    await addReply(store, 'french', 'e2e4 e7e6', 'g1f3', 0.08)

    expect((await store.getNode('french', 'e2e4 e7e6'))?.replies).toContainEqual({
      uci: 'g1f3',
      share: 0.08,
      forced: true,
    })
    expect(await store.getNode('french', 'e2e4 e7e6 g1f3')).toMatchObject({
      probability: 1,
      side: 'mine',
      expanded: false,
    })

    await regenerate(store)
    expect(await store.getNode('french', 'e2e4 e7e6 g1f3')).toMatchObject({ expanded: true })
  })

  it('clears the leaf reason of a leaf that gets a reply', async () => {
    const { store } = await generateFrench()
    await addReply(store, 'french', 'e2e4 e7e6 d2d4 d7d5', 'b1c3', 0.3)
    const node = await store.getNode('french', 'e2e4 e7e6 d2d4 d7d5')
    expect(node?.leafReason).toBeUndefined()
    expect(node?.replies).toHaveLength(1)
  })

  it('refuses to add a reply to a node that is not generated yet', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    await expect(addReply(store, 'french', 'e2e4 e7e6', 'g1f3', 0.08)).rejects.toThrow(
      /not generated/,
    )
  })
})

describe('removeReply', () => {
  it('removes an opponent branch and its subtree', async () => {
    const { store } = await generateFrench()
    await removeReply(store, 'french', 'e2e4 e7e6', 'd2d3')
    expect((await store.getNode('french', 'e2e4 e7e6'))?.replies?.map((r) => r.uci)).toEqual([
      'd2d4',
    ])
    expect(await store.getNode('french', 'e2e4 e7e6 d2d3')).toBeUndefined()
    expect(await store.getNode('french', 'e2e4 e7e6 d2d3 d7d5')).toBeUndefined()
  })

  it('refuses to remove the last reply', async () => {
    const { store } = await generateFrench()
    await expect(removeReply(store, 'french', '', 'e2e4')).rejects.toThrow(/last reply/)
  })

  it('normalizes king-takes-rook castling before removing', async () => {
    const rootMoves = sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5')
    const repertoire = { ...FRENCH, rootMoves, settings: { ...FRENCH.settings, maxPly: 8 } }
    const explorer = fakeExplorer({
      [rootMoves.join(' ')]: [
        ['e1h1', 600],
        ['c2c3', 400],
      ],
    })
    const store = new MemoryStore()
    await initRepertoire(repertoire, store)
    await runGeneration({ repertoire, store, explorer, engine: fakeEngine() })

    await removeReply(store, 'french', rootMoves.join(' '), 'e1h1')
    expect(
      (await store.getNode('french', rootMoves.join(' ')))?.replies?.map((r) => r.uci),
    ).toEqual(['c2c3'])
    expect(await store.getNode('french', `${rootMoves.join(' ')} e1g1`)).toBeUndefined()
  })
})
