import type { Repertoire } from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../services'

export function useRepertoire(id: string): Repertoire | null | undefined {
  return useLiveQuery(async () => (await db.repertoires.get(id)) ?? null, [id])
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
