import {
  type Color,
  DEFAULT_SETTINGS,
  initRepertoire,
  type Opening,
  type Repertoire,
  type Settings,
  type Speed,
  sanLine,
  searchOpenings,
} from '@chess-trainer/core'
import { useId, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { OPENINGS } from '../data/openings'
import { db, runner, store } from '../services'
import { login, useToken } from '../services/auth'
import { formatLine, RATING_BUCKETS, ratingLabel, SPEED_LABELS } from '../ui/format'
import { button, card, primaryButton } from '../ui/styles'

const SPEEDS = Object.keys(SPEED_LABELS) as Speed[]

const toggle = <T,>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

function NumberField(props: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<string>()
  const commit = () => {
    if (draft === undefined) return
    const value = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(value)) {
      props.onChange(Math.min(props.max, Math.max(props.min, value)))
    }
    setDraft(undefined)
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        className="w-32 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        value={draft ?? props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
      {props.hint && <p className="text-xs text-neutral-500">{props.hint}</p>}
    </div>
  )
}

export function NewRepertoireScreen() {
  const token = useToken()
  const [, navigate] = useLocation()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<Opening>()
  const [color, setColor] = useState<Color>('black')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(false)
  const results = useMemo(() => searchOpenings(OPENINGS, query), [query])
  const valid = !!opening && settings.ratings.length > 0 && settings.speeds.length > 0
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  function choose(o: Opening) {
    setOpening(o)
    setColor(o.moves.length % 2 === 1 ? 'white' : 'black')
    set({ maxPly: Math.max(DEFAULT_SETTINGS.maxPly, o.moves.length + 2) })
  }

  async function create() {
    if (!opening || !valid) return
    setBusy(true)
    const now = Date.now()
    const repertoire: Repertoire = {
      id: crypto.randomUUID(),
      name: opening.name,
      color,
      rootMoves: opening.moves,
      settings,
      status: 'paused',
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.repertoires.add(repertoire)
      await initRepertoire(repertoire, store)
      await runner.start(repertoire.id)
      navigate(`/r/${repertoire.id}/generation`)
    } catch (error) {
      alert(
        `La création du répertoire a échoué : ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Nouveau répertoire</h1>

      <div className={`${card} space-y-3`}>
        <label htmlFor={searchId} className="block font-medium">
          Ouverture
        </label>
        <input
          id={searchId}
          type="search"
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          placeholder="ex. French Defense, Sicilian, C00"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {results.length > 0 && (
          <ul className="max-h-72 divide-y divide-neutral-200 overflow-y-auto dark:divide-neutral-800">
            {results.map((o) => (
              <li key={`${o.eco}-${o.name}-${o.moves.join('')}`}>
                <button
                  type="button"
                  className="w-full px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onClick={() => choose(o)}
                >
                  <span className="font-medium">
                    {o.eco} · {o.name}
                  </span>
                  <span className="block text-sm text-neutral-500">
                    {formatLine(sanLine(o.moves))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {opening && (
        <div className={`${card} space-y-5`}>
          <div>
            <h2 className="font-semibold">{opening.name}</h2>
            <p className="text-sm text-neutral-500">{formatLine(sanLine(opening.moves))}</p>
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Je joue avec</legend>
            {(['white', 'black'] as const).map((c) => (
              <label key={c} className="mr-4 inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="color"
                  checked={color === c}
                  onChange={() => setColor(c)}
                />
                {c === 'white' ? 'les Blancs' : 'les Noirs'}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Niveau des parties (Elo Lichess)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {RATING_BUCKETS.map((r) => (
                <label key={r} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.ratings.includes(r)}
                    onChange={() => set({ ratings: toggle(settings.ratings, r) })}
                  />
                  {ratingLabel(r)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Cadences</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {SPEEDS.map((s) => (
                <label key={s} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.speeds.includes(s)}
                    onChange={() => set({ speeds: toggle(settings.speeds, s) })}
                  />
                  {SPEED_LABELS[s]}
                </label>
              ))}
            </div>
          </fieldset>

          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">Réglages avancés</summary>
            <div className="grid gap-4 pt-3 sm:grid-cols-2">
              <NumberField
                label="Probabilité minimale d’une ligne (%)"
                hint="1 % donne environ 100 lignes. Plus bas : répertoire plus complet, génération plus longue."
                value={Math.round(settings.minLineProbability * 1000) / 10}
                min={0.1}
                max={20}
                step={0.1}
                onChange={(v) => set({ minLineProbability: v / 100 })}
              />
              <NumberField
                label="Tolérance du moteur (centipions)"
                hint="Écart accepté avec le meilleur coup pour garder le coup le plus joué."
                value={settings.engineToleranceCp}
                min={0}
                max={200}
                onChange={(v) => set({ engineToleranceCp: v })}
              />
              <NumberField
                label="Parties minimum par position"
                value={settings.minGames}
                min={1}
                max={10_000}
                onChange={(v) => set({ minGames: v })}
              />
              <NumberField
                label="Profondeur maximale (demi-coups)"
                hint="L’explorateur Lichess s’arrête à 50."
                value={settings.maxPly}
                min={opening.moves.length + 2}
                max={50}
                onChange={(v) => set({ maxPly: v })}
              />
            </div>
          </details>

          {token ? (
            <button
              type="button"
              className={primaryButton}
              disabled={!valid || busy}
              onClick={() => void create()}
            >
              Générer le répertoire
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                La génération lit les statistiques de Lichess : connecte-toi d’abord.
              </p>
              <button type="button" className={button} onClick={() => void login()}>
                Se connecter avec Lichess
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
