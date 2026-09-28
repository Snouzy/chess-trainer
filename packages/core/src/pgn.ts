import { ChildNode, defaultGame, makePgn, type Node, type PgnNodeData } from 'chessops/pgn'
import { childPath, uciToSan } from './chess'
import { childMoves, type RepertoireTree } from './tree'

export function exportPgn(tree: RepertoireTree, event: string): string {
  const game = defaultGame<PgnNodeData>(() => new Map([['Event', event]]))
  const walk = (path: string, parent: Node<PgnNodeData>) => {
    const node = tree.nodes.get(path)
    if (!node) return
    for (const uci of childMoves(tree, node)) {
      const child = new ChildNode<PgnNodeData>({ san: uciToSan(node.positionKey, uci) })
      parent.children.push(child)
      walk(childPath(path, uci), child)
    }
  }
  walk('', game.moves)
  return makePgn(game)
}
