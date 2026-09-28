import {
  DrillSession,
  findOpening,
  type PositionKey,
  pathMoves,
  type Repertoire,
  type RepertoireTree,
  type Uci,
} from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'wouter'
import { OPENINGS } from '../data/openings'
import { cachedEvals } from '../engine/cached-engine'
import { db, explorer, store } from '../services'
import { type Arrow, arrowOf, Board } from '../ui/board'
import { useRepertoire } from '../ui/hooks'
import { exploreHref, parsePathParam } from '../ui/paths'
import { SquareNamesToggle, useSquareNames } from '../ui/preferences'
import { StatsPanel } from '../ui/stats-panel'
import { card, primaryButton } from '../ui/styles'

const OPPONENT_DELAY_MS = 400

function RevealedStats({
  repertoire,
  tree,
  positionKey,
  onHover,
}: {
  repertoire: Repertoire
  tree: RepertoireTree
  positionKey: PositionKey
  onHover?: (uci: Uci | undefined) => void
}) {
  const stats = useLiveQuery(
    () => explorer.peek(positionKey, repertoire.settings),
    [positionKey, repertoire.id],
  )
  const evals = useLiveQuery(() => cachedEvals(db, positionKey), [positionKey])
  const choice = tree.choices.get(positionKey)
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Statistiques de ton dernier coup
      </h2>
      <StatsPanel
        positionKey={positionKey}
        stats={stats}
        evals={evals?.candidates}
        highlight={new Set(choice ? [choice] : [])}
        onHover={onHover}
      />
    </div>
  )
}

function Drill({
  repertoire,
  tree,
  startPath,
}: {
  repertoire: Repertoire
  tree: RepertoireTree
  startPath: string
}) {
  const [session] = useState(() => new DrillSession(tree, startPath))
  const [lastMove, setLastMove] = useState<Uci | undefined>(pathMoves(startPath).at(-1))
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [revealed, setRevealed] = useState<PositionKey>()
  const [version, setVersion] = useState(0)
  const [totals, setTotals] = useState({ lines: 0, errors: 0 })
  const [hovered, setHovered] = useState<Uci>()
  const [squareNames] = useSquareNames()
  const nextButton = useRef<HTMLButtonElement>(null)
  const turn = session.turn
  const preview = hovered ? revealed : undefined
  const previewArrows = useMemo(() => (hovered ? [arrowOf(hovered, 'blue')] : []), [hovered])

  useEffect(() => {
    if (turn !== 'theirs') return
    const timer = setTimeout(() => {
      setLastMove(session.playOpponent())
      setVersion((v) => v + 1)
    }, OPPONENT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [session, turn])

  useEffect(() => {
    if (turn === 'done') nextButton.current?.focus()
  }, [turn])

  function onMove(uci: Uci) {
    if (session.turn !== 'mine') return
    setHovered(undefined)
    const before = session.positionKey
    const result = session.play(uci)
    if (result.stat) {
      store
        .recordStat(repertoire.id, result.stat)
        .catch((error) => console.error('Stat not saved', error))
    }
    if (result.correct) {
      setLastMove(pathMoves(session.path).at(-1))
      setArrows([])
      setRevealed(before)
    } else {
      setArrows([arrowOf(result.expected, 'green')])
    }
    setVersion((v) => v + 1)
  }

  function nextLine() {
    const errors = session.lineErrors
    setTotals((t) => ({ lines: t.lines + 1, errors: t.errors + errors }))
    session.nextLine()
    setLastMove(pathMoves(startPath).at(-1))
    setArrows([])
    setRevealed(undefined)
    setHovered(undefined)
    setVersion((v) => v + 1)
  }

  const opening = findOpening(OPENINGS, pathMoves(session.path))
  const errors = session.lineErrors
  const empty = turn === 'done' && session.path === startPath

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-3">
        <Board
          positionKey={preview ?? session.positionKey}
          orientation={repertoire.color}
          lastMove={preview ? undefined : lastMove}
          movable={!preview && turn === 'mine'}
          arrows={preview ? previewArrows : arrows}
          squareNames={squareNames}
          version={version}
          onMove={onMove}
        />
        <SquareNamesToggle />
      </div>
      <aside className="space-y-4">
        <div className={`${card} space-y-2`}>
          <h1 className="font-semibold">{repertoire.name}</h1>
          {opening && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{opening.name}</p>
          )}
          <div aria-live="polite" className="space-y-2">
            {turn === 'mine' && arrows.length === 0 && <p>À toi de jouer.</p>}
            {turn === 'mine' && arrows.length > 0 && (
              <p className="text-red-700 dark:text-red-400">
                Pas ce coup-là. Joue le coup indiqué par la flèche.
              </p>
            )}
            {turn === 'theirs' && <p>L’adversaire joue…</p>}
            {empty && (
              <p>
                Rien à entraîner ici pour l’instant. Attends la fin de la génération ou{' '}
                <Link href={exploreHref(repertoire.id, startPath)} className="underline">
                  explore l’arbre
                </Link>
                .
              </p>
            )}
            {turn === 'done' && !empty && (
              <>
                <p>
                  Ligne terminée
                  {errors ? ` avec ${errors} erreur${errors > 1 ? 's' : ''}.` : ' sans erreur.'}
                  {errors > 0 && !session.isReplay && ' Elle va être rejouée.'}
                </p>
                <button ref={nextButton} type="button" className={primaryButton} onClick={nextLine}>
                  Ligne suivante
                </button>
              </>
            )}
          </div>
        </div>
        {revealed && (
          <RevealedStats
            repertoire={repertoire}
            tree={tree}
            positionKey={revealed}
            onHover={setHovered}
          />
        )}
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Session : {totals.lines} ligne{totals.lines > 1 ? 's' : ''}, {totals.errors} erreur
          {totals.errors > 1 ? 's' : ''}.
        </p>
      </aside>
    </div>
  )
}

export function DrillScreen() {
  const params = useParams<{ id: string; moves?: string }>()
  const startPath = parsePathParam(params.moves)
  const repertoire = useRepertoire(params.id)
  const [tree, setTree] = useState<RepertoireTree | null>()

  useEffect(() => {
    let alive = true
    setTree(undefined)
    store
      .loadTree(params.id)
      .then((t) => alive && setTree(t))
      .catch(() => alive && setTree(null))
    return () => {
      alive = false
    }
  }, [params.id])

  if (repertoire === undefined || tree === undefined) return <p>Chargement…</p>
  if (repertoire === null || tree === null) return <p>Répertoire introuvable.</p>
  if (startPath === undefined) return <p>Position introuvable.</p>
  return (
    <Drill
      key={`${repertoire.id}|${startPath}`}
      repertoire={repertoire}
      tree={tree}
      startPath={startPath}
    />
  )
}
