import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'wouter'
import { db, runner } from '../services'
import { login, useToken } from '../services/auth'
import { useRunner } from '../services/runner'
import { STATUS_LABELS } from '../ui/format'
import { useNow, useRepertoire } from '../ui/hooks'
import { drillHref, exploreHref } from '../ui/paths'
import { button, card, primaryButton } from '../ui/styles'

const SECONDS_PER_REQUEST = 2.4

export function GenerationScreen() {
  const { id } = useParams<{ id: string }>()
  const repertoire = useRepertoire(id)
  const nodeCount = useLiveQuery(
    () =>
      db.nodes.where('[repertoireId+path]').between([id, Dexie.minKey], [id, Dexie.maxKey]).count(),
    [id],
  )
  const state = useRunner(runner)
  const token = useToken()
  const now = useNow(1000)

  if (repertoire === undefined) return <p>Chargement…</p>
  if (repertoire === null) return <p>Répertoire introuvable.</p>

  const active = state.activeId === id
  const progress = active ? state.progress : undefined
  const message = state.messageFor === id ? state.message : undefined
  const waitSeconds =
    active && state.queue.kind === 'waiting'
      ? Math.max(0, Math.ceil((state.queue.until - now) / 1000))
      : 0
  const done = progress ? progress.expanded / (progress.expanded + progress.pending) : 0

  return (
    <section className={`${card} max-w-2xl space-y-4`}>
      <h1 className="text-2xl font-semibold">{repertoire.name}</h1>
      <p>
        Statut : {STATUS_LABELS[repertoire.status]}
        {repertoire.status === 'generating' && !active && ' (en file d’attente)'}
      </p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {nodeCount ?? 0} positions dans l’arbre.
      </p>

      {progress && (
        <div className="space-y-2">
          <div
            className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-valuenow={Math.round(done * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progression de la génération"
          >
            <div className="h-full bg-emerald-600" style={{ width: `${done * 100}%` }} />
          </div>
          <p className="text-sm">
            {progress.expanded} positions traitées, {progress.pending} en attente. Encore{' '}
            {Math.ceil((progress.pending * SECONDS_PER_REQUEST) / 60)} min au plus : les positions
            déjà en cache vont plus vite.
          </p>
        </div>
      )}

      {waitSeconds > 0 && state.queue.kind === 'waiting' && (
        <p className="text-sm">
          {state.queue.reason === 'rateLimit'
            ? 'Limite de Lichess atteinte'
            : 'Lichess ne répond pas'}
          , reprise dans {waitSeconds} s.
        </p>
      )}
      {message && (
        <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!token && (
          <button type="button" className={primaryButton} onClick={() => void login()}>
            Se connecter avec Lichess
          </button>
        )}
        {repertoire.status === 'generating' && (
          <button type="button" className={button} onClick={() => void runner.pause(id)}>
            Mettre en pause
          </button>
        )}
        {(repertoire.status === 'paused' || repertoire.status === 'error') && (
          <button type="button" className={primaryButton} onClick={() => void runner.start(id)}>
            Reprendre
          </button>
        )}
        {repertoire.status === 'ready' && (
          <Link href={drillHref(id, '')} className={primaryButton}>
            S’entraîner
          </Link>
        )}
        <Link href={exploreHref(id, '')} className={button}>
          Explorer l’arbre
        </Link>
      </div>
    </section>
  )
}
