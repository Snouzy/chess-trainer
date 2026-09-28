import { initRepertoire, runGeneration } from '../generate'
import { buildTree, type RepertoireTree } from '../tree'
import { DEFAULT_SETTINGS, type Repertoire } from '../types'
import { fakeEngine, fakeExplorer } from './fakes'
import { MemoryStore } from './memory-store'

/** A tiny French Defense repertoire: 7 nodes, 2 opponent branches, leaves at ply 4. */
export const FRENCH: Repertoire = {
  id: 'french',
  name: 'French Defense',
  color: 'black',
  rootMoves: ['e2e4', 'e7e6'],
  settings: { ...DEFAULT_SETTINGS, minLineProbability: 0.1, maxPly: 4, minGames: 10 },
  status: 'generating',
  createdAt: 0,
  updatedAt: 0,
}

export const frenchExplorer = () =>
  fakeExplorer({
    'e2e4 e7e6': [
      ['d2d4', 700],
      ['d2d3', 200],
      ['g1f3', 80],
      ['b2b3', 20],
    ],
    'e2e4 e7e6 d2d4': [
      ['d7d5', 900],
      ['c7c5', 100],
    ],
    'e2e4 e7e6 d2d3': [
      ['d7d5', 500],
      ['c7c5', 400],
    ],
  })

export const frenchEngine = () =>
  fakeEngine({
    'e2e4 e7e6 d2d4': { d7d5: -30, c7c5: -80 },
    'e2e4 e7e6 d2d3': { c7c5: -10, d7d5: -20 },
  })

export async function generateFrench(): Promise<{ store: MemoryStore; tree: RepertoireTree }> {
  const store = new MemoryStore()
  await initRepertoire(FRENCH, store)
  await runGeneration({
    repertoire: FRENCH,
    store,
    explorer: frenchExplorer(),
    engine: frenchEngine(),
  })
  const tree = buildTree(store.allNodes(FRENCH.id), store.allChoices(FRENCH.id))
  return { store, tree }
}
