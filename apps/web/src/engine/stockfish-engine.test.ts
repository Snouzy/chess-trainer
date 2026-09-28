import { EngineError, INITIAL_KEY } from '@chess-trainer/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StockfishEngine, type WorkerLike } from './stockfish-engine'

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly posted: string[] = []
  terminated = false

  constructor(private readonly script: (command: string) => string[] | 'crash') {}

  postMessage(message: string): void {
    this.posted.push(message)
    const lines = this.script(message)
    if (lines === 'crash') {
      queueMicrotask(() => this.onerror?.(new Error('crash')))
      return
    }
    for (const line of lines) {
      queueMicrotask(() => this.onmessage?.({ data: line }))
    }
  }

  terminate(): void {
    this.terminated = true
  }
}

function handshake(command: string): string[] | undefined {
  if (command === 'uci') return ['uciok']
  if (command === 'isready') return ['readyok']
  return undefined
}

describe('StockfishEngine', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('handshakes and evaluates a position with candidates', async () => {
    const worker = new FakeWorker((command) => {
      const shake = handshake(command)
      if (shake) return shake
      if (command.startsWith('go') && command.includes('searchmoves')) {
        return [
          'info depth 16 multipv 1 score cp 20 pv d2d4',
          'info depth 16 multipv 2 score cp 10 pv g1f3',
          'bestmove d2d4',
        ]
      }
      if (command.startsWith('go')) {
        return ['info depth 16 multipv 1 score cp 25 pv e2e4', 'bestmove e2e4']
      }
      return []
    })
    const engine = new StockfishEngine(16, () => worker)

    const result = await engine.evaluate(INITIAL_KEY, ['d2d4', 'g1f3'])

    expect(result).toEqual({
      best: { uci: 'e2e4', cp: 25 },
      candidates: { d2d4: 20, g1f3: 10 },
    })
    expect(worker.posted).toContain(`position fen ${INITIAL_KEY} 0 1`)
    expect(worker.posted).toContain('setoption name MultiPV value 2')
  })

  it('rejects a search that never answers and terminates the worker', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker((command) => handshake(command) ?? [])
    const engine = new StockfishEngine(16, () => worker)

    const first = engine.evaluate(INITIAL_KEY, [])
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(first).rejects.toBeInstanceOf(EngineError)
    expect(worker.terminated).toBe(true)

    await expect(engine.evaluate(INITIAL_KEY, [])).rejects.toBeInstanceOf(EngineError)
  })

  it('rejects the pending and a queued evaluate when Stockfish crashes mid-search', async () => {
    const worker = new FakeWorker((command) => {
      const shake = handshake(command)
      if (shake) return shake
      if (command.startsWith('go')) return 'crash'
      return []
    })
    const engine = new StockfishEngine(16, () => worker)

    const first = engine.evaluate(INITIAL_KEY, [])
    const second = engine.evaluate(INITIAL_KEY, [])

    await expect(first).rejects.toBeInstanceOf(EngineError)
    await expect(second).rejects.toBeInstanceOf(EngineError)
  })

  it('rejects when init never answers, and later lines do not throw', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker(() => [])
    const engine = new StockfishEngine(16, () => worker)

    const evaluated = engine.evaluate(INITIAL_KEY, [])
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(evaluated).rejects.toBeInstanceOf(Error)

    expect(() => worker.onmessage?.({ data: 'uciok' })).not.toThrow()
  })
})
