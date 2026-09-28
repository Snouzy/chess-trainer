import { describe, expect, it } from 'vitest'
import { keyAfter, pathMoves, sanLineToUci } from './chess'
import { DrillSession, pickWeighted } from './drill'
import { generateFrench } from './testing'
import { buildTree } from './tree'
import type { RepNode } from './types'

const key = (path: string) => keyAfter(pathMoves(path))

describe('pickWeighted', () => {
  const replies = [
    { uci: 'd2d4', share: 0.7 },
    { uci: 'd2d3', share: 0.2 },
  ]
  it('picks by cumulative share', () => {
    expect(pickWeighted(replies, () => 0)).toBe('d2d4')
    expect(pickWeighted(replies, () => 0.77)).toBe('d2d4')
    expect(pickWeighted(replies, () => 0.79)).toBe('d2d3')
    expect(pickWeighted(replies, () => 0.9999)).toBe('d2d3')
  })
})

describe('DrillSession', () => {
  it('plays a full line, counts one error per position and reports stats', async () => {
    const { tree } = await generateFrench()
    const session = new DrillSession(tree, '', () => 0)

    expect(session.turn).toBe('theirs')
    expect(session.playOpponent()).toBe('e2e4')
    expect(session.turn).toBe('mine')
    expect(session.expected).toBe('e7e6')
    expect(session.play('e7e6')).toEqual({
      correct: true,
      stat: { positionKey: key('e2e4'), result: 'ok' },
    })

    expect(session.playOpponent()).toBe('d2d4')
    expect(session.play('c7c5')).toEqual({
      correct: false,
      expected: 'd7d5',
      stat: { positionKey: key('e2e4 e7e6 d2d4'), result: 'ko' },
    })
    expect(session.play('c7c5')).toEqual({ correct: false, expected: 'd7d5' })
    expect(session.play('d7d5')).toEqual({ correct: true })

    expect(session.turn).toBe('done')
    expect(session.lineErrors).toBe(1)
  })

  it('replays a failed line once with the same opponent moves', async () => {
    const { tree } = await generateFrench()
    let r = 0
    const session = new DrillSession(tree, '', () => r)
    session.playOpponent()
    session.play('e7e6')
    session.playOpponent()
    session.play('c7c5')
    session.play('d7d5')

    session.nextLine()
    expect(session.isReplay).toBe(true)
    r = 0.99
    session.playOpponent()
    session.play('e7e6')
    expect(session.playOpponent()).toBe('d2d4')
    session.play('d7d5')
    expect(session.lineErrors).toBe(0)

    session.nextLine()
    expect(session.isReplay).toBe(false)
    session.playOpponent()
    session.play('e7e6')
    expect(session.playOpponent()).toBe('d2d3')
  })

  it('does not replay a replayed line twice', async () => {
    const { tree } = await generateFrench()
    const session = new DrillSession(tree, '', () => 0)
    const failLine = () => {
      session.playOpponent()
      session.play('e7e6')
      session.playOpponent()
      session.play('c7c5')
      session.play('d7d5')
    }
    failLine()
    session.nextLine()
    failLine()
    session.nextLine()
    expect(session.isReplay).toBe(false)
  })

  it('starts from a chosen node', async () => {
    const { tree } = await generateFrench()
    const session = new DrillSession(tree, 'e2e4 e7e6 d2d3')
    expect(session.turn).toBe('mine')
    expect(session.expected).toBe('d7d5')
    expect(session.positionKey).toBe(key('e2e4 e7e6 d2d3'))
  })

  it('accepts king-takes-rook castling for a standard castling choice', () => {
    const moves = sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5')
    const path = moves.join(' ')
    const mine: RepNode = {
      repertoireId: 'r',
      path,
      positionKey: keyAfter(moves),
      ply: 6,
      probability: 1,
      side: 'mine',
      expanded: true,
    }
    const leaf: RepNode = {
      ...mine,
      path: `${path} e1g1`,
      positionKey: keyAfter([...moves, 'e1g1']),
      ply: 7,
      side: 'theirs',
      leafReason: 'maxPly',
    }
    const tree = buildTree(
      [mine, leaf],
      [{ repertoireId: 'r', positionKey: mine.positionKey, uci: 'e1g1', source: 'auto' }],
    )
    const session = new DrillSession(tree, path)
    expect(session.play('e1h1')).toMatchObject({ correct: true })
    expect(session.turn).toBe('done')
  })

  it('is done when my move is not generated yet', async () => {
    const { tree } = await generateFrench()
    tree.choices.delete(key('e2e4 e7e6 d2d4'))
    const session = new DrillSession(tree, 'e2e4 e7e6 d2d4')
    expect(session.turn).toBe('done')
  })
})
