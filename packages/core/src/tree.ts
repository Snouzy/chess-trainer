import type { Choice, PositionKey, RepNode, Uci } from './types'

export interface RepertoireTree {
  nodes: Map<string, RepNode>
  choices: Map<PositionKey, Uci>
}

export function buildTree(nodes: readonly RepNode[], choices: readonly Choice[]): RepertoireTree {
  return {
    nodes: new Map(nodes.map((n) => [n.path, n])),
    choices: new Map(choices.map((c) => [c.positionKey, c.uci])),
  }
}

export function childMoves(tree: RepertoireTree, node: RepNode): Uci[] {
  if (node.side === 'mine') {
    const choice = tree.choices.get(node.positionKey)
    return choice ? [choice] : []
  }
  return [...(node.replies ?? [])].sort((a, b) => b.share - a.share).map((r) => r.uci)
}
