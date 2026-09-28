import {
  buildTree,
  type Choice,
  type PositionKey,
  type PositionStats,
  type RepertoireStore,
  type RepertoireTree,
  type RepNode,
  type StatUpdate,
} from '@chess-trainer/core'
import Dexie from 'dexie'
import type { TrainerDb } from './db'

const all = (repertoireId: string) =>
  [
    [repertoireId, Dexie.minKey],
    [repertoireId, Dexie.maxKey],
  ] as const

export class DexieStore implements RepertoireStore {
  constructor(private readonly db: TrainerDb) {}

  async putNode(node: RepNode): Promise<void> {
    await this.db.nodes.put(node)
  }

  getNode(repertoireId: string, path: string): Promise<RepNode | undefined> {
    return this.db.nodes.get([repertoireId, path])
  }

  async unexpandedNodes(repertoireId: string): Promise<RepNode[]> {
    return (await this.nodesOf(repertoireId)).filter((n) => !n.expanded)
  }

  nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]> {
    return this.db.nodes
      .where('[repertoireId+positionKey]')
      .equals([repertoireId, positionKey])
      .toArray()
  }

  async deleteSubtree(repertoireId: string, path: string): Promise<void> {
    const prefix = path ? `${path} ` : ''
    await this.db.nodes
      .where('[repertoireId+path]')
      .between([repertoireId, path], [repertoireId, `${prefix}￿`], true, true)
      .filter((n) => n.path === path || n.path.startsWith(prefix))
      .delete()
  }

  getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined> {
    return this.db.choices.get([repertoireId, positionKey])
  }

  async putChoice(choice: Choice): Promise<void> {
    await this.db.choices.put(choice)
  }

  nodesOf(repertoireId: string): Promise<RepNode[]> {
    return this.db.nodes
      .where('[repertoireId+path]')
      .between(...all(repertoireId))
      .toArray()
  }

  choicesOf(repertoireId: string): Promise<Choice[]> {
    return this.db.choices
      .where('[repertoireId+positionKey]')
      .between(...all(repertoireId))
      .toArray()
  }

  statsOf(repertoireId: string): Promise<PositionStats[]> {
    return this.db.stats
      .where('[repertoireId+positionKey]')
      .between(...all(repertoireId))
      .toArray()
  }

  async loadTree(repertoireId: string): Promise<RepertoireTree> {
    const [nodes, choices] = await Promise.all([
      this.nodesOf(repertoireId),
      this.choicesOf(repertoireId),
    ])
    return buildTree(nodes, choices)
  }

  async recordStat(repertoireId: string, update: StatUpdate): Promise<void> {
    await this.db.transaction('rw', this.db.stats, async () => {
      const current = await this.db.stats.get([repertoireId, update.positionKey])
      await this.db.stats.put({
        repertoireId,
        positionKey: update.positionKey,
        attempts: (current?.attempts ?? 0) + 1,
        errors: (current?.errors ?? 0) + (update.result === 'ko' ? 1 : 0),
        lastResult: update.result,
        lastSeenAt: Date.now(),
      })
    })
  }

  async summary(repertoireId: string): Promise<{ positions: number; mastered: number }> {
    const [nodes, stats] = await Promise.all([
      this.nodesOf(repertoireId),
      this.statsOf(repertoireId),
    ])
    const mine = new Set(nodes.filter((n) => n.side === 'mine').map((n) => n.positionKey))
    const mastered = stats.filter((s) => mine.has(s.positionKey) && s.lastResult === 'ok').length
    return { positions: mine.size, mastered }
  }

  async deleteRepertoire(repertoireId: string): Promise<void> {
    const { db } = this
    await db.transaction('rw', [db.repertoires, db.nodes, db.choices, db.stats], async () => {
      await db.nodes
        .where('[repertoireId+path]')
        .between(...all(repertoireId))
        .delete()
      await db.choices
        .where('[repertoireId+positionKey]')
        .between(...all(repertoireId))
        .delete()
      await db.stats
        .where('[repertoireId+positionKey]')
        .between(...all(repertoireId))
        .delete()
      await db.repertoires.delete(repertoireId)
    })
  }
}
