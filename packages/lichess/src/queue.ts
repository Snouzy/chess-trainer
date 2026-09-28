import { LichessAuthError, LichessHttpError } from './errors'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type QueueStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; reason: 'rateLimit' | 'retry'; until: number }

export interface QueueOptions {
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onStatus?: (status: QueueStatus) => void
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const MIN_INTERVAL_MS = 2_400
const RATE_LIMIT_WAIT_MS = 60_000
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]

/** Runs requests one at a time, at most 25 per minute, as the Lichess explorer requires. */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private lastStart = Number.NEGATIVE_INFINITY
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly options: QueueOptions = {},
  ) {
    this.sleep = options.sleep ?? wait
    this.now = options.now ?? Date.now
  }

  run(url: string, init?: RequestInit): Promise<Response> {
    const task = this.tail.then(() => this.execute(url, init))
    this.tail = task.catch(() => undefined)
    return task
  }

  private async execute(url: string, init?: RequestInit): Promise<Response> {
    let retries = 0
    for (;;) {
      await this.waitForSlot()
      let response: Response | undefined
      let failure: unknown
      try {
        const fetchFn = this.fetchFn
        response = await fetchFn(url, init)
      } catch (error) {
        failure = error
      }

      if (response?.status === 401) throw new LichessAuthError('Lichess rejected the token')
      if (response?.status === 429) {
        await this.pause('rateLimit', RATE_LIMIT_WAIT_MS)
        continue
      }
      if (response && response.status < 500) {
        if (!response.ok)
          throw new LichessHttpError(response.status, `Lichess answered ${response.status}`)
        return response
      }

      const delay = RETRY_DELAYS_MS[retries++]
      if (delay === undefined) {
        throw response
          ? new LichessHttpError(response.status, `Lichess answered ${response.status}`)
          : failure
      }
      await this.pause('retry', delay)
    }
  }

  private async waitForSlot(): Promise<void> {
    const delay = this.lastStart + MIN_INTERVAL_MS - this.now()
    if (delay > 0) await this.sleep(delay)
    this.lastStart = this.now()
  }

  private async pause(reason: 'rateLimit' | 'retry', ms: number): Promise<void> {
    this.options.onStatus?.({ kind: 'waiting', reason, until: this.now() + ms })
    await this.sleep(ms)
    this.options.onStatus?.({ kind: 'idle' })
  }
}
