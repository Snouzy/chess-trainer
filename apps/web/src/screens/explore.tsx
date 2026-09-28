import {
  addReply,
  changeChoice,
  childMoves,
  childPath,
  type ExplorerResult,
  findOpening,
  keyAfter,
  parentPath,
  pathMoves,
  positionFromFen,
  type Repertoire,
  type RepertoireTree,
  removeReply,
  sanLine,
  toStandardUci,
  type Uci,
  uciToSan,
} from '@chess-trainer/core'
import { LichessAuthError } from '@chess-trainer/lichess'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'wouter'
import { OPENINGS } from '../data/openings'
import { cachedEvals } from '../engine/cached-engine'
import { db, explorer, runner, store } from '../services'
import { clearToken } from '../services/auth'
import { arrowOf, Board } from '../ui/board'
import { describeMove } from '../ui/describe-move'
import { LEAF_LABELS, pct } from '../ui/format'
import { useRepertoire } from '../ui/hooks'
import { drillHref, exploreHref, parsePathParam } from '../ui/paths'
import { SquareNamesToggle, useSquareNames } from '../ui/preferences'
import { StatsPanel } from '../ui/stats-panel'
import { button, card, primaryButton } from '../ui/styles'

function Explorer({
  repertoire,
  tree,
  path,
}: {
  repertoire: Repertoire
  tree: RepertoireTree
  path: string
}) {
  const [, navigate] = useLocation()
  const [loading, setLoading] = useState(false)
  const [hovered, setHovered] = useState<Uci>()
  const [version, setVersion] = useState(0)
  const [squareNames] = useSquareNames()
  const { id } = repertoire
  const moves = pathMoves(path)
  const node = tree.nodes.get(path)
  const positionKey = node?.positionKey ?? keyAfter(moves)
  const stats = useLiveQuery(
    () => explorer.peek(positionKey, repertoire.settings),
    [positionKey, id],
  )
  const evals = useLiveQuery(() => cachedEvals(db, positionKey), [positionKey])
  const children = node ? childMoves(tree, node) : []
  const parent = moves.length > 0 ? tree.nodes.get(parentPath(path)) : undefined
  const lastMove = moves.at(-1)
  const inPrefix = moves.length < repertoire.rootMoves.length
  const canRemove =
    !!parent &&
    !!lastMove &&
    parent.side === 'theirs' &&
    (parent.replies?.length ?? 0) > 1 &&
    parent.ply >= repertoire.rootMoves.length
  const opening = findOpening(OPENINGS, moves)
  const sans = sanLine(moves)
  const arrows = useMemo(() => (hovered ? [arrowOf(hovered, 'blue')] : []), [hovered])
  const go = (target: string) => {
    setHovered(undefined)
    navigate(exploreHref(id, target))
  }

  async function select(uci: Uci) {
    const target = await play(uci)
    if (target === undefined) setVersion((v) => v + 1)
    else go(target)
  }

  async function play(uci: Uci): Promise<string | undefined> {
    const move = toStandardUci(positionFromFen(positionKey), uci)
    if (!move) return
    const target = childPath(path, move)
    if (!node || children.includes(move)) return target
    if (inPrefix) {
      alert('Cette position fait partie de l’ouverture choisie : elle ne peut pas changer.')
      return
    }
    const san = uciToSan(positionKey, move)
    try {
      if (node.side === 'mine') {
        const current = tree.choices.get(positionKey)
        const was = current ? uciToSan(positionKey, current) : 'aucun coup'
        if (!confirm(`Jouer ${san} ici au lieu de ${was} ? La suite de la ligne sera régénérée.`))
          return
        await edit(() => changeChoice(store, id, positionKey, move), true)
        return target
      }
      if (!node.expanded) {
        alert('Cette position n’est pas encore générée. Réessaie une fois la génération terminée.')
        return
      }
      if (!confirm(`Ajouter la réponse adverse ${san} au répertoire ?`)) return
      const share = await shareOf(move)
      if (share === undefined) return
      await edit(() => addReply(store, id, path, move, share), true)
      return target
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function edit(change: () => Promise<void>, restart: boolean): Promise<void> {
    const active = runner.getState().activeId === id
    // Otherwise the run writes the node it is expanding after the edit, and undoes it.
    if (active) await runner.pause(id)
    try {
      await change()
    } catch (error) {
      if (active) await runner.start(id)
      throw error
    }
    if (active || restart) await runner.start(id)
  }

  async function shareOf(move: Uci): Promise<number | undefined> {
    const result = stats ?? (await fetchStats())
    if (!result) return
    const pos = positionFromFen(positionKey)
    const stat = result.moves.find((m) => toStandardUci(pos, m.uci) === move)
    const total = result.white + result.draws + result.black
    return stat && total ? (stat.white + stat.draws + stat.black) / total : 0
  }

  async function fetchStats(): Promise<ExplorerResult | undefined> {
    setLoading(true)
    try {
      return await explorer.query(positionKey, repertoire.settings)
    } catch (error) {
      if (error instanceof LichessAuthError) clearToken()
      alert(
        error instanceof LichessAuthError
          ? 'Connecte-toi à Lichess pour charger les statistiques.'
          : 'Impossible de charger les statistiques pour le moment.',
      )
      return undefined
    } finally {
      setLoading(false)
    }
  }

  async function removeBranch() {
    if (!lastMove || !confirm('Retirer cette réponse adverse et toute la suite de la ligne ?'))
      return
    const target = parentPath(path)
    await edit(() => removeReply(store, id, target, lastMove), repertoire.status === 'generating')
    go(target)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-3">
        <Board
          positionKey={positionKey}
          orientation={repertoire.color}
          lastMove={lastMove}
          movable
          arrows={arrows}
          squareNames={squareNames}
          version={version}
          onMove={(uci) => void select(uci)}
        />
        <nav aria-label="Coups de la ligne" className="flex flex-wrap gap-1 text-sm">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            onClick={() => go('')}
          >
            Début
          </button>
          {sans.map((san, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: a ply index is the identity of a move in the line
              key={i}
              type="button"
              aria-current={i === sans.length - 1 ? 'step' : undefined}
              className="rounded px-1.5 py-0.5 hover:bg-neutral-200 aria-[current=step]:font-semibold dark:hover:bg-neutral-800"
              title={describeMove(keyAfter(moves.slice(0, i)), moves[i]!)?.text}
              onClick={() => go(moves.slice(0, i + 1).join(' '))}
            >
              {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
              {san}
            </button>
          ))}
        </nav>
        <SquareNamesToggle />
      </div>

      <aside className="space-y-4">
        <div className={`${card} space-y-1`}>
          <h1 className="font-semibold">{repertoire.name}</h1>
          {opening && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {opening.eco} · {opening.name}
            </p>
          )}
          <p className="text-sm">
            {!node ? 'Hors répertoire' : node.side === 'mine' ? 'À toi de jouer' : 'Coup adverse'}
            {node && ` · probabilité de la ligne : ${pct(node.probability)}`}
          </p>
          {node?.leafReason && <p className="text-sm">{LEAF_LABELS[node.leafReason]}</p>}
          {inPrefix && <p className="text-sm">Coup imposé par l’ouverture choisie.</p>}
        </div>

        <StatsPanel
          positionKey={positionKey}
          stats={stats}
          evals={evals?.candidates}
          highlight={new Set(children)}
          onSelect={(uci) => void select(uci)}
          onHover={setHovered}
        />
        {!stats && (
          <button
            type="button"
            className={button}
            disabled={loading}
            onClick={() => void fetchStats()}
          >
            {loading ? 'Chargement…' : 'Charger les statistiques'}
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          {moves.length > 0 && (
            <button type="button" className={button} onClick={() => go(parentPath(path))}>
              Coup précédent
            </button>
          )}
          <Link href={drillHref(id, path)} className={primaryButton}>
            S’entraîner depuis ici
          </Link>
          {canRemove && (
            <button type="button" className={button} onClick={() => void removeBranch()}>
              Retirer cette branche
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          Clique un coup pour avancer. À ton tour, un autre coup remplace le tien. Au tour adverse,
          il ajoute une branche.
        </p>
      </aside>
    </div>
  )
}

export function ExploreScreen() {
  const params = useParams<{ id: string; moves?: string }>()
  const path = parsePathParam(params.moves)
  const repertoire = useRepertoire(params.id)
  const tree = useLiveQuery(() => store.loadTree(params.id).catch(() => null), [params.id])

  if (repertoire === undefined || tree === undefined) return <p>Chargement…</p>
  if (repertoire === null || tree === null) return <p>Répertoire introuvable.</p>
  if (path === undefined) {
    return (
      <p>
        Position introuvable.{' '}
        <Link href={exploreHref(params.id, '')} className="underline">
          Revenir au début
        </Link>
      </p>
    )
  }
  return <Explorer repertoire={repertoire} tree={tree} path={path} />
}
