import { childPath, positionFromFen, toStandardUci } from './chess'
import { makeChild } from './generate'
import type { RepertoireStore } from './ports'
import type { PositionKey, RepNode, Uci } from './types'

export async function changeChoice(
  store: RepertoireStore,
  repertoireId: string,
  positionKey: PositionKey,
  uci: Uci,
): Promise<void> {
  const move = toStandardUci(positionFromFen(positionKey), uci)
  if (!move) throw new Error(`Illegal move ${uci}`)
  const previous = await store.getChoice(repertoireId, positionKey)
  if (previous?.source === 'prefix') throw new Error('Cannot change a move of the chosen opening')
  if (previous?.uci === move) return

  await store.putChoice({ repertoireId, positionKey, uci: move, source: 'user' })
  for (const node of await store.nodesAt(repertoireId, positionKey)) {
    if (node.side !== 'mine') continue
    if (previous) await store.deleteSubtree(repertoireId, childPath(node.path, previous.uci))
    await store.putNode(makeChild(node, move, node.probability))
    await store.putNode({ ...node, expanded: true })
  }
}

export async function addReply(
  store: RepertoireStore,
  repertoireId: string,
  path: string,
  uci: Uci,
  share: number,
): Promise<void> {
  const node = await store.getNode(repertoireId, path)
  if (node?.side !== 'theirs') throw new Error(`No opponent node at "${path}"`)
  if (!node.expanded) throw new Error('Position not generated yet')
  const move = toStandardUci(positionFromFen(node.positionKey), uci)
  if (!move) throw new Error(`Illegal move ${uci}`)
  if (node.replies?.some((r) => r.uci === move)) return

  const { leafReason: _cleared, ...rest } = node
  const updated: RepNode = {
    ...rest,
    expanded: true,
    replies: [...(node.replies ?? []), { uci: move, share, forced: true }],
  }
  await store.putNode(makeChild(node, move, node.probability))
  await store.putNode(updated)
}

export async function removeReply(
  store: RepertoireStore,
  repertoireId: string,
  path: string,
  uci: Uci,
): Promise<void> {
  const node = await store.getNode(repertoireId, path)
  if (node?.side !== 'theirs' || !node?.replies) {
    throw new Error(`No opponent node at "${path}"`)
  }
  const move = toStandardUci(positionFromFen(node.positionKey), uci)
  if (!move || !node.replies.some((r) => r.uci === move)) return
  if (node.replies.length === 1) throw new Error('Cannot remove the last reply')

  await store.deleteSubtree(repertoireId, childPath(path, move))
  await store.putNode({ ...node, replies: node.replies.filter((r) => r.uci !== move) })
}
