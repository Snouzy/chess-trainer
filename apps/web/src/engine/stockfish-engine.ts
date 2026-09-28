import { type Engine, EngineError, type EngineResult, type Uci } from '@chess-trainer/core'
import { type InfoLine, parseInfo } from './uci'

const DEFAULT_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`
const INIT_TIMEOUT_MS = 15_000
const SEARCH_TIMEOUT_MS = 60_000

/** Method shorthand keeps parameter checks bivariant, so a real `Worker` is assignable below. */
interface WorkerHandlers {
  onmessage(event: { data: unknown }): void
  onerror(event: unknown): void
}

export interface WorkerLike {
  postMessage(message: string): void
  terminate(): void
  onmessage: WorkerHandlers['onmessage'] | null
  onerror: WorkerHandlers['onerror'] | null
}

export class StockfishEngine implements Engine {
  private readonly worker: WorkerLike
  private readonly listeners = new Set<(line: string) => void>()
  private readonly pending = new Set<(error: EngineError) => void>()
  private readonly ready: Promise<void>
  private chain: Promise<unknown> = Promise.resolve()
  private failure: EngineError | undefined

  constructor(
    private readonly depth = 16,
    createWorker: () => WorkerLike = () => new Worker(DEFAULT_URL),
  ) {
    this.worker = createWorker()
    this.worker.onmessage = (event) => {
      for (const listener of [...this.listeners]) listener(String(event.data))
    }
    this.worker.onerror = () => this.fail(new EngineError('Stockfish crashed or failed to load'))
    this.ready = this.send('uci', (l) => l === 'uciok', undefined, INIT_TIMEOUT_MS).then(() =>
      this.send('isready', (l) => l === 'readyok', undefined, INIT_TIMEOUT_MS),
    )
    this.ready.catch(() => undefined)
  }

  evaluate(fen: string, candidates: Uci[]): Promise<EngineResult> {
    const run = this.chain.then(() => this.run(fen, candidates))
    this.chain = run.catch(() => undefined)
    return run
  }

  private fail(error: EngineError): void {
    if (this.failure) return
    this.failure = error
    this.worker.terminate()
    for (const reject of [...this.pending]) reject(error)
  }

  private async run(fen: string, candidates: Uci[]): Promise<EngineResult> {
    await this.ready
    const full = fen.trim().split(/\s+/).length === 4 ? `${fen} 0 1` : fen
    const top = (await this.search(full, [], 1)).get(1)
    if (!top) throw new EngineError(`No legal move in ${fen}`)
    const scores: Record<Uci, number> = {}
    if (candidates.length > 0) {
      for (const info of (await this.search(full, candidates, candidates.length)).values()) {
        scores[info.move] = info.cp
      }
    }
    return { best: { uci: top.move, cp: top.cp }, candidates: scores }
  }

  /** With MultiPV 1, `searchmoves` returns only the best move of the subset; MultiPV must equal the subset size. */
  private async search(fen: string, moves: Uci[], multipv: number): Promise<Map<number, InfoLine>> {
    const lines = new Map<number, InfoLine>()
    this.worker.postMessage(`setoption name MultiPV value ${multipv}`)
    this.worker.postMessage(`position fen ${fen}`)
    const go = `go depth ${this.depth}${moves.length ? ` searchmoves ${moves.join(' ')}` : ''}`
    await this.send(
      go,
      (line) => line.startsWith('bestmove'),
      (line) => {
        const info = parseInfo(line)
        if (info) lines.set(info.multipv, info)
      },
    )
    return lines
  }

  private send(
    command: string,
    isDone: (line: string) => boolean,
    onLine?: (line: string) => void,
    timeoutMs = SEARCH_TIMEOUT_MS,
  ): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        this.listeners.delete(listener)
        this.pending.delete(rejecter)
      }
      const listener = (line: string) => {
        onLine?.(line)
        if (!isDone(line)) return
        finish()
        resolve()
      }
      const rejecter = (error: EngineError) => {
        finish()
        reject(error)
      }
      const timer = setTimeout(
        () => this.fail(new EngineError(`Stockfish did not answer "${command}"`)),
        timeoutMs,
      )
      this.listeners.add(listener)
      this.pending.add(rejecter)
      this.worker.postMessage(command)
    })
  }
}
