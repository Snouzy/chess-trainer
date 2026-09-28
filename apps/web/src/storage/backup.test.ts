import 'fake-indexeddb/auto'
import { INITIAL_KEY, initRepertoire, runGeneration } from '@chess-trainer/core'
import { FRENCH, frenchEngine, frenchExplorer } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { TrainerDb } from './db'
import { DexieStore } from './dexie-store'

async function seeded() {
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  const store = new DexieStore(db)
  await db.repertoires.put(FRENCH)
  await initRepertoire(FRENCH, store)
  await runGeneration({
    repertoire: FRENCH,
    store,
    explorer: frenchExplorer(),
    engine: frenchEngine(),
  })
  await store.recordStat('french', { positionKey: INITIAL_KEY, result: 'ok' })
  return { db, store }
}

describe('backup', () => {
  it('round-trips a repertoire under a new id', async () => {
    const { db, store } = await seeded()
    const json = await exportBackup(db, 'french')
    const id = await importBackup(db, json, 'copy')

    expect(id).toBe('copy')
    expect(await db.repertoires.get('copy')).toMatchObject({
      name: 'French Defense',
      status: 'paused',
    })
    const strip = <T extends { repertoireId: string }>(rows: T[]) =>
      rows.map(({ repertoireId: _, ...rest }) => rest)
    expect(strip(await store.nodesOf('copy'))).toEqual(strip(await store.nodesOf('french')))
    expect(strip(await store.choicesOf('copy'))).toEqual(strip(await store.choicesOf('french')))
    expect(await store.statsOf('copy')).toHaveLength(1)
  })

  it('rejects invalid files without writing anything', async () => {
    const { db } = await seeded()
    const before = await db.nodes.count()
    await expect(importBackup(db, 'not json')).rejects.toThrow(/invalide/)
    await expect(importBackup(db, JSON.stringify({ format: 'other' }))).rejects.toThrow(/invalide/)
    const valid = JSON.parse(await exportBackup(db, 'french'))
    valid.nodes[0].ply = 'three'
    await expect(importBackup(db, JSON.stringify(valid))).rejects.toThrow(/invalide/)
    expect(await db.nodes.count()).toBe(before)
    expect(await db.repertoires.count()).toBe(1)
  })

  it('rejects a node whose position does not parse, without writing anything', async () => {
    const { db } = await seeded()
    const before = await db.nodes.count()
    const backup = JSON.parse(await exportBackup(db, 'french'))
    backup.nodes[0].positionKey = 'garbage'
    await expect(importBackup(db, JSON.stringify(backup))).rejects.toThrow(/nœud mal formé/)
    expect(await db.nodes.count()).toBe(before)
    expect(await db.repertoires.count()).toBe(1)
  })
})
