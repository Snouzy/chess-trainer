import { pathMoves, sanLine } from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'wouter'
import { store } from '../services'
import { formatLine, pct } from '../ui/format'
import { useRepertoire } from '../ui/hooks'
import { exploreHref } from '../ui/paths'
import { rankPositions } from '../ui/rank'
import { card } from '../ui/styles'

export function StatsScreen() {
  const { id } = useParams<{ id: string }>()
  const repertoire = useRepertoire(id)
  const rows = useLiveQuery(
    async () => rankPositions(await store.nodesOf(id), await store.statsOf(id)),
    [id],
  )

  if (repertoire === undefined || rows === undefined) return <p>Chargement…</p>
  if (repertoire === null) return <p>Répertoire introuvable.</p>

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Stats · {repertoire.name}</h1>
      {rows.length === 0 ? (
        <p className="text-neutral-600 dark:text-neutral-400">
          Pas encore d’essai. Lance une séance d’entraînement.
        </p>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="py-1 font-medium">Position (ton coup ensuite)</th>
                <th className="py-1 font-medium">Essais</th>
                <th className="py-1 font-medium">Erreurs</th>
                <th className="py-1 font-medium">Taux d’erreur</th>
                <th className="py-1 font-medium">Dernier essai</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.positionKey}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className="py-1.5">
                    <Link
                      href={exploreHref(id, r.path)}
                      className="underline-offset-2 hover:underline"
                    >
                      {formatLine(sanLine(pathMoves(r.path))) || 'Position de départ'}
                    </Link>
                  </td>
                  <td className="py-1.5 tabular-nums">{r.attempts}</td>
                  <td className="py-1.5 tabular-nums">{r.errors}</td>
                  <td className="py-1.5 tabular-nums">{pct(r.rate)}</td>
                  <td className="py-1.5">{r.lastResult === 'ok' ? 'Réussi' : 'Raté'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
