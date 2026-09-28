import {
  type ExplorerResult,
  type PositionKey,
  positionFromFen,
  toStandardUci,
  type Uci,
} from '@chess-trainer/core'
import { useId } from 'react'
import { describeMove } from './describe-move'
import { formatEval, pct } from './format'

interface StatsPanelProps {
  positionKey: PositionKey
  stats?: ExplorerResult
  evals?: Record<Uci, number>
  highlight: ReadonlySet<Uci>
  onSelect?: (uci: Uci) => void
  onHover?: (uci: Uci | undefined) => void
}

function ResultBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-sm border border-neutral-300 dark:border-neutral-700"
      title={`Blancs ${pct(white / total)}, nulles ${pct(draws / total)}, Noirs ${pct(black / total)}`}
    >
      <div className="bg-neutral-100" style={{ width: `${(white / total) * 100}%` }} />
      <div className="bg-neutral-400" style={{ width: `${(draws / total) * 100}%` }} />
      <div className="bg-neutral-800" style={{ width: `${(black / total) * 100}%` }} />
    </div>
  )
}

export function StatsPanel({
  positionKey,
  stats,
  evals,
  highlight,
  onSelect,
  onHover,
}: StatsPanelProps) {
  const tipBase = useId()
  if (!stats) {
    return (
      <p className="text-sm text-neutral-500">Pas de statistiques en cache pour cette position.</p>
    )
  }
  const pos = positionFromFen(positionKey)
  const total = stats.white + stats.draws + stats.black
  const rows = stats.moves.map((m) => ({
    ...m,
    uci: toStandardUci(pos, m.uci) ?? m.uci,
    games: m.white + m.draws + m.black,
  }))

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-neutral-500">
        <tr>
          <th className="py-1 font-medium">Coup</th>
          <th className="py-1 font-medium">Parties</th>
          <th className="w-1/3 py-1 font-medium">Résultats</th>
          <th className="py-1 text-right font-medium">Éval</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const cp = evals?.[m.uci]
          const mine = highlight.has(m.uci)
          const tip = describeMove(positionKey, m.uci)
          return (
            <tr
              key={m.uci}
              className={`group ${mine ? 'bg-emerald-50 dark:bg-emerald-950' : ''}`}
              onMouseEnter={() => onHover?.(m.uci)}
              onMouseLeave={() => onHover?.(undefined)}
            >
              <td className="relative py-1">
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => onSelect?.(m.uci)}
                  aria-disabled={onSelect ? undefined : true}
                  onFocus={() => onHover?.(m.uci)}
                  onBlur={() => onHover?.(undefined)}
                  aria-describedby={tip ? `${tipBase}-${m.uci}` : undefined}
                >
                  {m.san}
                  {mine && <span className="sr-only"> (dans le répertoire)</span>}
                  {mine && <span aria-hidden="true"> ★</span>}
                </button>
                {tip && (
                  <span
                    id={`${tipBase}-${m.uci}`}
                    role="tooltip"
                    className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-64 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-md group-hover:block group-focus-within:block dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    {tip.text}
                  </span>
                )}
              </td>
              <td className="py-1 tabular-nums">{pct(total ? m.games / total : 0)}</td>
              <td className="py-1">
                <ResultBar white={m.white} draws={m.draws} black={m.black} />
              </td>
              <td className="py-1 text-right tabular-nums">
                {cp === undefined ? '' : formatEval(cp, pos.turn)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
