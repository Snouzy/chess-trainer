import {
  type Choice,
  type PositionStats,
  positionKey,
  type Repertoire,
  type RepNode,
} from '@chess-trainer/core'
import type { TrainerDb } from './db'
import { DexieStore } from './dexie-store'

interface Backup {
  format: 'chess-trainer'
  version: 1
  repertoire: Repertoire
  nodes: RepNode[]
  choices: Choice[]
  stats: PositionStats[]
}

export async function exportBackup(db: TrainerDb, repertoireId: string): Promise<string> {
  const store = new DexieStore(db)
  const repertoire = await db.repertoires.get(repertoireId)
  if (!repertoire) throw new Error(`Unknown repertoire ${repertoireId}`)
  const backup: Backup = {
    format: 'chess-trainer',
    version: 1,
    repertoire,
    nodes: await store.nodesOf(repertoireId),
    choices: await store.choicesOf(repertoireId),
    stats: await store.statsOf(repertoireId),
  }
  return JSON.stringify(backup)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isString = (v: unknown) => typeof v === 'string'
const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

function isPositionKey(v: unknown): boolean {
  if (!isString(v)) return false
  try {
    positionKey(v)
    return true
  } catch {
    return false
  }
}

function isSettings(v: unknown): boolean {
  return (
    isObject(v) &&
    Array.isArray(v.ratings) &&
    v.ratings.every(isNumber) &&
    Array.isArray(v.speeds) &&
    v.speeds.every(isString) &&
    isNumber(v.minLineProbability) &&
    isNumber(v.engineToleranceCp) &&
    isNumber(v.minGames) &&
    isNumber(v.maxPly)
  )
}

function invalid(reason: string): never {
  throw new Error(`Fichier invalide : ${reason}`)
}

function assertBackup(value: unknown): asserts value is Backup {
  if (!isObject(value) || value.format !== 'chess-trainer' || value.version !== 1) {
    invalid('ce n’est pas une sauvegarde Chess Trainer')
  }
  const { repertoire, nodes, choices, stats } = value
  if (
    !isObject(repertoire) ||
    !isString(repertoire.name) ||
    (repertoire.color !== 'white' && repertoire.color !== 'black') ||
    !Array.isArray(repertoire.rootMoves) ||
    !repertoire.rootMoves.every(isString) ||
    !isSettings(repertoire.settings)
  ) {
    invalid('répertoire incomplet')
  }
  if (!Array.isArray(nodes) || !Array.isArray(choices) || !Array.isArray(stats))
    invalid('données manquantes')
  for (const n of nodes) {
    if (
      !isObject(n) ||
      !isString(n.path) ||
      !isPositionKey(n.positionKey) ||
      !isNumber(n.ply) ||
      !isNumber(n.probability) ||
      (n.side !== 'mine' && n.side !== 'theirs') ||
      typeof n.expanded !== 'boolean'
    ) {
      invalid('nœud mal formé')
    }
  }
  for (const c of choices) {
    if (!isObject(c) || !isPositionKey(c.positionKey) || !isString(c.uci)) invalid('coup mal formé')
  }
  for (const s of stats) {
    if (
      !isObject(s) ||
      !isPositionKey(s.positionKey) ||
      !isNumber(s.attempts) ||
      !isNumber(s.errors)
    ) {
      invalid('statistique mal formée')
    }
  }
}

export async function importBackup(
  db: TrainerDb,
  json: string,
  newId: string = crypto.randomUUID(),
): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    invalid('JSON illisible')
  }
  assertBackup(parsed)
  const retag = <T extends { repertoireId: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, repertoireId: newId }))
  const status = parsed.repertoire.status === 'generating' ? 'paused' : parsed.repertoire.status
  const now = Date.now()

  await db.transaction('rw', [db.repertoires, db.nodes, db.choices, db.stats], async () => {
    await db.repertoires.add({
      ...parsed.repertoire,
      id: newId,
      status,
      createdAt: now,
      updatedAt: now,
    })
    await db.nodes.bulkPut(retag(parsed.nodes))
    await db.choices.bulkPut(retag(parsed.choices))
    await db.stats.bulkPut(retag(parsed.stats))
  })
  return newId
}
