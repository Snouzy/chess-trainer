import 'fake-indexeddb/auto'
import { initRepertoire, keyAfter, runGeneration } from '@chess-trainer/core'
import { FRENCH, frenchEngine, frenchExplorer, generateFrench } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { TrainerDb } from './db'
import { DexieStore } from './dexie-store'

function freshStore() {
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  return { db, store: new DexieStore(db) }
}

async function generateInDexie() {
  const { db, store } = freshStore()
  await db.repertoires.put(FRENCH)
  await initRepertoire(FRENCH, store)
  await runGeneration({
    repertoire: FRENCH,
    store,
    explorer: frenchExplorer(),
    engine: frenchEngine(),
  })
  return { db, store }
}

describe('DexieStore', () => {
  it('generates the same tree as the in-memory store', async () => {
    const { store } = await generateInDexie()
    const expected = await generateFrench()
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
    expect((await store.nodesOf('french')).sort(byPath)).toEqual(expected.store.allNodes('french'))
    expect((await store.loadTree('french')).choices).toEqual(expected.tree.choices)
  })

  it('lists unexpanded nodes and nodes at a position', async () => {
    const { store } = freshStore()
    await initRepertoire(FRENCH, store)
    expect((await store.unexpandedNodes('french')).map((n) => n.path)).toEqual(['e2e4 e7e6'])
    expect((await store.nodesAt('french', keyAfter(['e2e4']))).map((n) => n.path)).toEqual(['e2e4'])
  })

  it('deletes a subtree without touching siblings that share a string prefix', async () => {
    const { store } = freshStore()
    const node = (path: string) => ({
      repertoireId: 'r',
      path,
      positionKey: path,
      ply: path.split(' ').length,
      probability: 1,
      side: 'mine' as const,
      expanded: true,
    })
    for (const path of ['a', 'a e7e8', 'a e7e8 b', 'a e7e8q', 'a e7e8q c'])
      await store.putNode(node(path))
    await store.putNode({ ...node('a e7e8'), repertoireId: 'other' })

    await store.deleteSubtree('r', 'a e7e8')

    expect((await store.nodesOf('r')).map((n) => n.path).sort()).toEqual([
      'a',
      'a e7e8q',
      'a e7e8q c',
    ])
    expect(await store.getNode('other', 'a e7e8')).toBeDefined()
  })

  it('records stats and summarizes mastery over current positions', async () => {
    const { store } = await generateInDexie()
    const k = keyAfter(['e2e4', 'e7e6', 'd2d4'])
    await store.recordStat('french', { positionKey: k, result: 'ko' })
    await store.recordStat('french', { positionKey: k, result: 'ok' })
    await store.recordStat('french', { positionKey: 'not-in-tree', result: 'ok' })

    expect((await store.statsOf('french')).find((s) => s.positionKey === k)).toMatchObject({
      attempts: 2,
      errors: 1,
      lastResult: 'ok',
    })
    expect(await store.summary('french')).toEqual({ positions: 3, mastered: 1 })
  })

  it('deletes a repertoire and all its rows', async () => {
    const { db, store } = await generateInDexie()
    await store.recordStat('french', { positionKey: keyAfter(['e2e4']), result: 'ok' })
    await store.deleteRepertoire('french')
    expect(await db.repertoires.count()).toBe(0)
    expect(await db.nodes.count()).toBe(0)
    expect(await db.choices.count()).toBe(0)
    expect(await db.stats.count()).toBe(0)
  })
})
