import {
  type Engine,
  EngineError,
  type ExplorerSource,
  type GenerationProgress,
  type Repertoire,
  type RepertoireStatus,
  runGeneration,
} from '@chess-trainer/core'
import { LichessAuthError, LichessHttpError, type QueueStatus } from '@chess-trainer/lichess'
import { useSyncExternalStore } from 'react'
import type { TrainerDb } from '../storage/db'
import type { DexieStore } from '../storage/dexie-store'

export interface RunnerState {
  activeId?: string
  progress?: GenerationProgress
  queue: QueueStatus
  message?: string
  messageFor?: string
}

export interface RunnerDeps {
  db: TrainerDb
  store: DexieStore
  explorer: ExplorerSource
  engine: Engine
  onAuthError?: () => void
}

function outcomeOf(error: unknown): { status: RepertoireStatus; message: string } {
  if (error instanceof LichessAuthError) {
    return { status: 'generating', message: 'Connecte-toi à Lichess pour continuer la génération.' }
  }
  if (error instanceof EngineError) {
    return {
      status: 'error',
      message: 'Le moteur Stockfish s’est arrêté. Clique sur « Reprendre » pour le relancer.',
    }
  }
  if (error instanceof LichessHttpError) {
    return { status: 'paused', message: `Lichess a répondu ${error.status}. Réessaie plus tard.` }
  }
  if (error instanceof TypeError) {
    return {
      status: 'paused',
      message: 'Réseau indisponible. Reprends la génération une fois en ligne.',
    }
  }
  const detail = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '')
  return { status: 'paused', message: `La génération s’est arrêtée : ${detail}.` }
}

export class GenerationRunner {
  private state: RunnerState = { queue: { kind: 'idle' } }
  private readonly listeners = new Set<() => void>()
  private controller: AbortController | undefined
  private current: Promise<unknown> | undefined
  private loop: Promise<void> | undefined
  private rekick = false

  constructor(private readonly deps: RunnerDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  setQueueStatus(queue: QueueStatus): void {
    this.update({ queue })
  }

  async start(id: string): Promise<void> {
    await this.setStatus(id, 'generating')
    void this.kick()
  }

  /** Resolves once no node of this repertoire can be written anymore and its status is final. */
  async pause(id: string): Promise<void> {
    if (this.state.activeId !== id) return this.setStatus(id, 'paused')
    this.controller?.abort()
    await this.current
  }

  kick(): Promise<void> {
    this.rekick = true
    this.loop ??= this.drain().finally(() => {
      this.loop = undefined
      if (this.rekick) void this.kick()
    })
    return this.loop
  }

  private async drain(): Promise<void> {
    for (;;) {
      this.rekick = false
      const [next] = await this.deps.db.repertoires
        .where('status')
        .equals('generating')
        .sortBy('createdAt')
      if (!next) return
      const controller = new AbortController()
      this.controller = controller
      const run = this.generate(next, controller.signal)
      this.current = run.catch(() => undefined)
      this.update({
        activeId: next.id,
        progress: undefined,
        message: undefined,
        messageFor: undefined,
      })
      try {
        if ((await run) === 'failed') return
      } finally {
        this.controller = undefined
        this.current = undefined
        this.update({ activeId: undefined })
      }
    }
  }

  private async generate(repertoire: Repertoire, signal: AbortSignal): Promise<'ended' | 'failed'> {
    try {
      const outcome = await runGeneration({
        repertoire,
        store: this.deps.store,
        explorer: this.deps.explorer,
        engine: this.deps.engine,
        signal,
        onProgress: (progress) => this.update({ progress }),
      })
      await this.setStatus(repertoire.id, outcome === 'done' ? 'ready' : 'paused')
      return 'ended'
    } catch (error) {
      if (error instanceof LichessAuthError) this.deps.onAuthError?.()
      const { status, message } = outcomeOf(error)
      await this.setStatus(repertoire.id, status)
      this.update({ message, messageFor: repertoire.id })
      return 'failed'
    }
  }

  private async setStatus(id: string, status: RepertoireStatus): Promise<void> {
    await this.deps.db.repertoires.update(id, { status, updatedAt: Date.now() })
  }

  private update(patch: Partial<RunnerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

export function useRunner(runner: GenerationRunner): RunnerState {
  return useSyncExternalStore(runner.subscribe, runner.getState)
}
