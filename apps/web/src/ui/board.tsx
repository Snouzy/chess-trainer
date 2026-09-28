import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'
import { type Color, type PositionKey, positionFromFen, type Uci } from '@chess-trainer/core'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Key } from '@lichess-org/chessground/types'
import { chessgroundDests } from 'chessops/compat'
import { parseSquare } from 'chessops/util'
import { useEffect, useRef } from 'react'

export interface Arrow {
  from: string
  to: string
  brush: 'green' | 'blue'
}

interface BoardProps {
  positionKey: PositionKey
  orientation: Color
  lastMove?: Uci
  movable: boolean
  arrows: Arrow[]
  /** Bump to redraw the same position, e.g. to take back a wrong move the user dropped. */
  version: number
  onMove: (uci: Uci) => void
}

export const arrowOf = (uci: Uci, brush: Arrow['brush']): Arrow => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  brush,
})

/** Chessground gives no promotion piece; openings almost never promote, so the board picks a queen. */
function withPromotion(key: PositionKey, uci: Uci): Uci {
  const from = parseSquare(uci.slice(0, 2))
  const to = parseSquare(uci.slice(2, 4))
  if (from === undefined || to === undefined) return uci
  const isPawn = positionFromFen(key).board.get(from)?.role === 'pawn'
  const lastRank = to >> 3 === 0 || to >> 3 === 7
  return isPawn && lastRank ? `${uci}q` : uci
}

function BoardCanvas({
  positionKey,
  orientation,
  lastMove,
  movable,
  arrows,
  version,
  onMove,
  squareNames,
}: BoardProps & { squareNames: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const api = useRef<Api | undefined>(undefined)
  const latest = useRef({ positionKey, onMove })
  latest.current = { positionKey, onMove }

  // biome-ignore lint/correctness/useExhaustiveDependencies: coordinates apply only at creation; the wrapper remounts this canvas via `key` instead
  useEffect(() => {
    if (!element.current) return
    api.current = Chessground(element.current, {
      animation: { duration: 200 },
      coordinates: squareNames,
      coordinatesOnSquares: squareNames,
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const { positionKey: key, onMove: handler } = latest.current
            handler?.(withPromotion(key, `${orig}${dest}`))
          },
        },
      },
    })
    return () => api.current?.destroy()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces a redraw of the same position
  useEffect(() => {
    const pos = positionFromFen(positionKey)
    api.current?.set({
      fen: positionKey,
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
      movable: {
        color: movable ? pos.turn : undefined,
        dests: movable ? chessgroundDests(pos) : new Map(),
      },
      drawable: {
        autoShapes: arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush })),
      },
    })
  }, [positionKey, orientation, lastMove, movable, arrows, version])

  return <div ref={element} className="aspect-square w-full" />
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8']
const GUTTER = 'text-sm font-semibold text-neutral-600 sm:text-base dark:text-neutral-300'

export function Board({ squareNames = false, ...props }: BoardProps & { squareNames?: boolean }) {
  const white = props.orientation === 'white'
  const files = white ? FILES : [...FILES].reverse()
  const ranks = white ? [...RANKS].reverse() : RANKS
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-1">
      <div aria-hidden="true" className={`grid grid-rows-8 ${GUTTER}`}>
        {ranks.map((rank) => (
          <span key={rank} className="flex items-center justify-end">
            {rank}
          </span>
        ))}
      </div>
      <BoardCanvas key={squareNames ? 'names' : 'plain'} {...props} squareNames={squareNames} />
      <span />
      <div aria-hidden="true" className={`grid grid-cols-8 text-center ${GUTTER}`}>
        {files.map((file) => (
          <span key={file}>{file}</span>
        ))}
      </div>
    </div>
  )
}
