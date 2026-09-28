import { childPath, keyAfter, pathMoves, positionFromFen, toStandardUci } from './chess'
import type { RepertoireTree } from './tree'
import type { PositionKey, Reply, RepNode, StatUpdate, Uci } from './types'

export type DrillTurn = 'mine' | 'theirs' | 'done'

export type PlayResult =
  | { correct: true; stat?: StatUpdate }
  | { correct: false; expected: Uci; stat?: StatUpdate }

export function pickWeighted(replies: readonly Reply[], rng: () => number): Uci {
  const total = replies.reduce((sum, r) => sum + r.share, 0)
  let x = rng() * total
  for (const reply of replies) {
    x -= reply.share
    if (x < 0) return reply.uci
  }
  return replies.at(-1)!.uci
}

export class DrillSession {
  private currentPath: string
  private plan = new Map<string, Uci>()
  private judged = new Set<string>()
  private errors = 0
  private replaying = false

  constructor(
    private readonly tree: RepertoireTree,
    private readonly startPath = '',
    private readonly rng: () => number = Math.random,
  ) {
    this.currentPath = startPath
  }

  get path(): string {
    return this.currentPath
  }

  get positionKey(): PositionKey {
    return this.node?.positionKey ?? keyAfter(pathMoves(this.currentPath))
  }

  get lineErrors(): number {
    return this.errors
  }

  get isReplay(): boolean {
    return this.replaying
  }

  get turn(): DrillTurn {
    const node = this.node
    if (!node) return 'done'
    if (node.side === 'theirs') return node.replies?.length ? 'theirs' : 'done'
    return this.tree.choices.has(node.positionKey) ? 'mine' : 'done'
  }

  get expected(): Uci | undefined {
    const node = this.node
    return node?.side === 'mine' ? this.tree.choices.get(node.positionKey) : undefined
  }

  playOpponent(): Uci {
    const node = this.node
    if (node?.side !== 'theirs' || !node?.replies?.length) {
      throw new Error('Not the opponent turn')
    }
    const uci = this.plan.get(node.path) ?? pickWeighted(node.replies, this.rng)
    this.plan.set(node.path, uci)
    this.currentPath = childPath(node.path, uci)
    return uci
  }

  play(uci: Uci): PlayResult {
    const node = this.node
    const expected = this.expected
    if (!node || !expected) throw new Error('Not your turn')
    const played = toStandardUci(positionFromFen(node.positionKey), uci)
    const first = !this.judged.has(node.path)
    this.judged.add(node.path)

    if (played === expected) {
      this.currentPath = childPath(node.path, expected)
      return first
        ? { correct: true, stat: { positionKey: node.positionKey, result: 'ok' } }
        : { correct: true }
    }
    if (!first) return { correct: false, expected }
    this.errors++
    return { correct: false, expected, stat: { positionKey: node.positionKey, result: 'ko' } }
  }

  nextLine(): void {
    const replay = this.errors > 0 && !this.replaying
    if (!replay) this.plan = new Map()
    this.replaying = replay
    this.judged = new Set()
    this.errors = 0
    this.currentPath = this.startPath
  }

  private get node(): RepNode | undefined {
    return this.tree.nodes.get(this.currentPath)
  }
}
