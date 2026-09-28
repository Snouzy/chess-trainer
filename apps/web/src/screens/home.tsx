import { exportPgn, type Repertoire } from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation } from 'wouter'
import { db, runner, store } from '../services'
import { exportBackup, importBackup } from '../storage/backup'
import { downloadFile, STATUS_LABELS, slug } from '../ui/format'
import { drillHref, exploreHref } from '../ui/paths'
import { button, card, primaryButton } from '../ui/styles'

function RepertoireCard({ repertoire }: { repertoire: Repertoire }) {
  const { id, name } = repertoire
  const summary = useLiveQuery(() => store.summary(id), [id])

  async function exportJson() {
    downloadFile(`${slug(name)}.json`, await exportBackup(db, id), 'application/json')
  }

  async function exportPgnFile() {
    downloadFile(
      `${slug(name)}.pgn`,
      exportPgn(await store.loadTree(id), name),
      'application/x-chess-pgn',
    )
  }

  async function remove() {
    if (!confirm(`Supprimer « ${name} » ? Cette action est définitive.`)) return
    await runner.pause(id)
    await store.deleteRepertoire(id)
  }

  return (
    <li className={card}>
      <h2 className="font-semibold">{name}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {repertoire.color === 'white' ? 'Avec les Blancs' : 'Avec les Noirs'} ·{' '}
        {STATUS_LABELS[repertoire.status]}
      </p>
      <p className="mt-2 text-sm">
        {summary
          ? `${summary.positions} positions à connaître, ${summary.mastered} réussies au dernier essai`
          : '…'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={drillHref(id, '')} className={primaryButton}>
          Entraîner
        </Link>
        <Link href={exploreHref(id, '')} className={button}>
          Explorer
        </Link>
        <Link href={`/r/${id}/stats`} className={button}>
          Stats
        </Link>
        {repertoire.status !== 'ready' && (
          <Link href={`/r/${id}/generation`} className={button}>
            Génération
          </Link>
        )}
        <button type="button" className={button} onClick={() => void exportJson()}>
          Exporter en JSON
        </button>
        <button type="button" className={button} onClick={() => void exportPgnFile()}>
          Exporter en PGN
        </button>
        <button type="button" className={button} onClick={() => void remove()}>
          Supprimer
        </button>
      </div>
    </li>
  )
}

export function HomeScreen() {
  const repertoires = useLiveQuery(
    () => db.repertoires.orderBy('createdAt').reverse().toArray(),
    [],
  )
  const [, navigate] = useLocation()

  async function onImport(file: File) {
    try {
      navigate(exploreHref(await importBackup(db, await file.text()), ''))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mes répertoires</h1>
        <div className="flex gap-2">
          <label className={`${button} cursor-pointer`}>
            Importer un fichier JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onImport(file)
                event.target.value = ''
              }}
            />
          </label>
          <Link href="/new" className={primaryButton}>
            Nouveau répertoire
          </Link>
        </div>
      </div>
      {repertoires?.length === 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">
          Aucun répertoire pour l’instant. Crée le premier à partir d’une ouverture.
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {repertoires?.map((r) => (
          <RepertoireCard key={r.id} repertoire={r} />
        ))}
      </ul>
    </section>
  )
}
