import type { RepertoireStore } from '../ports'
import type { Choice, PositionKey, RepNode } from '../types'

export class MemoryStore implements RepertoireStore {
  readonly nodes = new Map<string, RepNode>()
  readonly choices = new Map<string, Choice>()

  async putNode(node: RepNode): Promise<void> {
    this.nodes.set(`${node.repertoireId}|${node.path}`, structuredClone(node))
  }

  async getNode(repertoireId: string, path: string): Promise<RepNode | undefined> {
    const node = this.nodes.get(`${repertoireId}|${path}`)
    return node && structuredClone(node)
  }

  async unexpandedNodes(repertoireId: string): Promise<RepNode[]> {
    return this.allNodes(repertoireId).filter((n) => !n.expanded)
  }

  async nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]> {
    return this.allNodes(repertoireId).filter((n) => n.positionKey === positionKey)
  }

  async deleteSubtree(repertoireId: string, path: string): Promise<void> {
    const prefix = path ? `${path} ` : ''
    for (const [key, node] of this.nodes) {
      if (node.repertoireId !== repertoireId) continue
      if (node.path === path || node.path.startsWith(prefix)) this.nodes.delete(key)
    }
  }

  async getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined> {
    const choice = this.choices.get(`${repertoireId}|${positionKey}`)
    return choice && structuredClone(choice)
  }

  async putChoice(choice: Choice): Promise<void> {
    this.choices.set(`${choice.repertoireId}|${choice.positionKey}`, structuredClone(choice))
  }

  allNodes(repertoireId: string): RepNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.repertoireId === repertoireId)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((n) => structuredClone(n))
  }

  allChoices(repertoireId: string): Choice[] {
    return [...this.choices.values()]
      .filter((c) => c.repertoireId === repertoireId)
      .sort((a, b) => a.positionKey.localeCompare(b.positionKey))
      .map((c) => structuredClone(c))
  }
}
