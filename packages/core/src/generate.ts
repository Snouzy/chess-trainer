import { childPath, INITIAL_KEY, playUci, positionFromFen, sideAt, toStandardUci } from './chess'
import { InvalidResponseError } from './errors'
import type { Engine, ExplorerSource, RepertoireStore } from './ports'
import type { ExplorerResult, LeafReason, Repertoire, Reply, RepNode, Uci } from './types'

export const MAX_CANDIDATES = 5

export interface GenerationProgress {
  expanded: number
  pending: number
}

export interface GenerationContext {
  repertoire: Repertoire
  store: RepertoireStore
  explorer: ExplorerSource
  engine: Engine
  signal?: AbortSignal
  onProgress?: (progress: GenerationProgress) => void
}

export function makeChild(parent: RepNode, uci: Uci, probability: number): RepNode {
  return {
    repertoireId: parent.repertoireId,
    path: childPath(parent.path, uci),
    positionKey: playUci(parent.positionKey, uci),
    ply: parent.ply + 1,
    probability,
    side: parent.side === 'mine' ? 'theirs' : 'mine',
    expanded: false,
  }
}

export async function initRepertoire(
  repertoire: Repertoire,
  store: RepertoireStore,
): Promise<void> {
  const { id: repertoireId, color } = repertoire
  let key = INITIAL_KEY
  let path = ''
  for (const [ply, uci] of repertoire.rootMoves.entries()) {
    const side = sideAt(key, color)
    const node: RepNode = {
      repertoireId,
      path,
      positionKey: key,
      ply,
      probability: 1,
      side,
      expanded: true,
    }
    if (side === 'mine') {
      await store.putChoice({ repertoireId, positionKey: key, uci, source: 'prefix' })
    } else {
      node.replies = [{ uci, share: 1 }]
    }
    await store.putNode(node)
    key = playUci(key, uci)
    path = childPath(path, uci)
  }
  await store.putNode({
    repertoireId,
    path,
    positionKey: key,
    ply: repertoire.rootMoves.length,
    probability: 1,
    side: sideAt(key, color),
    expanded: false,
  })
}

export async function runGeneration(ctx: GenerationContext): Promise<'done' | 'aborted'> {
  const { store, repertoire } = ctx
  let expanded = 0
  for (;;) {
    const queue = await store.unexpandedNodes(repertoire.id)
    if (queue.length === 0) return 'done'
    while (queue.length > 0) {
      if (ctx.signal?.aborted) return 'aborted'
      queue.sort((a, b) => b.probability - a.probability || a.path.localeCompare(b.path))
      const entry = queue.shift()!
      // Entries go stale: an edit can delete or expand a node mid-run; a node can be queued twice.
      const node = await store.getNode(repertoire.id, entry.path)
      if (!node || node.expanded) continue
      queue.push(...(await expandNode(node, ctx)))
      expanded++
      ctx.onProgress?.({ expanded, pending: queue.length })
    }
  }
}

async function expandNode(node: RepNode, ctx: GenerationContext): Promise<RepNode[]> {
  const pos = positionFromFen(node.positionKey)
  if (pos.isEnd()) return markLeaf(node, 'noMoves', ctx)
  if (node.side === 'mine') {
    const uci = await chooseMove(node, ctx)
    const child = makeChild(node, uci, node.probability)
    await ctx.store.putNode(child)
    await ctx.store.putNode({ ...node, expanded: true })
    return [child]
  }

  const { settings } = ctx.repertoire
  if (node.ply >= settings.maxPly) return markLeaf(node, 'maxPly', ctx)
  const stats = await queryExplorer(node, ctx)
  if (!stats) return markLeaf(node, 'noMoves', ctx)
  const total = stats.white + stats.draws + stats.black
  if (total < settings.minGames) return markLeaf(node, 'minGames', ctx)

  const replies: Reply[] = []
  for (const move of stats.moves) {
    const uci = toStandardUci(pos, move.uci)
    const share = (move.white + move.draws + move.black) / total
    if (uci && node.probability * share >= settings.minLineProbability) replies.push({ uci, share })
  }
  if (replies.length === 0) return markLeaf(node, 'threshold', ctx)

  const children = replies.map((r) => makeChild(node, r.uci, node.probability * r.share))
  for (const child of children) await ctx.store.putNode(child)
  await ctx.store.putNode({ ...node, expanded: true, replies })
  return children
}

async function chooseMove(node: RepNode, ctx: GenerationContext): Promise<Uci> {
  const existing = await ctx.store.getChoice(node.repertoireId, node.positionKey)
  if (existing) return existing.uci

  const pos = positionFromFen(node.positionKey)
  const stats = await queryExplorer(node, ctx)
  const candidates = (stats?.moves ?? [])
    .map((m) => ({ uci: toStandardUci(pos, m.uci), games: m.white + m.draws + m.black }))
    .filter((m): m is { uci: Uci; games: number } => m.uci !== undefined)
    .sort((a, b) => b.games - a.games)
    .slice(0, MAX_CANDIDATES)
    .map((m) => m.uci)
  const evaluation = await ctx.engine.evaluate(node.positionKey, candidates)
  const floor = evaluation.best.cp - ctx.repertoire.settings.engineToleranceCp
  const uci =
    candidates.find((c) => (evaluation.candidates[c] ?? Number.NEGATIVE_INFINITY) >= floor) ??
    evaluation.best.uci
  await ctx.store.putChoice({
    repertoireId: node.repertoireId,
    positionKey: node.positionKey,
    uci,
    source: 'auto',
  })
  return uci
}

async function queryExplorer(
  node: RepNode,
  ctx: GenerationContext,
): Promise<ExplorerResult | undefined> {
  try {
    return await ctx.explorer.query(node.positionKey, ctx.repertoire.settings)
  } catch (error) {
    if (!(error instanceof InvalidResponseError)) throw error
    console.warn(`Explorer response ignored at "${node.path}":`, error.message)
    return undefined
  }
}

async function markLeaf(
  node: RepNode,
  leafReason: LeafReason,
  ctx: GenerationContext,
): Promise<RepNode[]> {
  await ctx.store.putNode({ ...node, expanded: true, leafReason })
  return []
}
