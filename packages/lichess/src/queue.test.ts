import { describe, expect, it } from 'vitest'
import { LichessAuthError, LichessHttpError } from './errors'
import { type QueueStatus, RequestQueue } from './queue'

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
  }
}

function fakeFetch(...outcomes: Array<number | Error>) {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    const next = outcomes.shift() ?? 200
    if (next instanceof Error) throw next
    return new Response('{}', { status: next })
  }
  return Object.assign(fn, { calls })
}

describe('RequestQueue', () => {
  it('spaces request starts by 2400 ms', async () => {
    const clock = fakeClock()
    const queue = new RequestQueue(fakeFetch(), clock)
    await Promise.all([queue.run('a'), queue.run('b'), queue.run('c')])
    expect(clock.sleeps).toEqual([2400, 2400])
  })

  it('waits 60 s after a 429 and retries', async () => {
    const clock = fakeClock()
    const statuses: QueueStatus[] = []
    const fetch = fakeFetch(429, 200)
    const queue = new RequestQueue(fetch, { ...clock, onStatus: (s) => statuses.push(s) })
    const response = await queue.run('a')
    expect(response.status).toBe(200)
    expect(clock.sleeps).toEqual([60_000])
    expect(statuses).toEqual([
      { kind: 'waiting', reason: 'rateLimit', until: 60_000 },
      { kind: 'idle' },
    ])
    expect(fetch.calls).toEqual(['a', 'a'])
  })

  it('retries 5xx and network errors with backoff', async () => {
    const clock = fakeClock()
    const queue = new RequestQueue(fakeFetch(500, new TypeError('offline'), 200), clock)
    expect((await queue.run('a')).status).toBe(200)
    expect(clock.sleeps).toEqual([5_000, 15_000])
  })

  it('gives up after three retries', async () => {
    const clock = fakeClock()
    const queue = new RequestQueue(fakeFetch(500, 502, 503, 504), clock)
    await expect(queue.run('a')).rejects.toBeInstanceOf(LichessHttpError)
    expect(clock.sleeps).toEqual([5_000, 15_000, 45_000])
  })

  it('rethrows the network error after three retries', async () => {
    const clock = fakeClock()
    const offline = new TypeError('offline')
    const queue = new RequestQueue(fakeFetch(offline, offline, offline, offline), clock)
    await expect(queue.run('a')).rejects.toBe(offline)
  })

  it('fails at once on 401 and on other 4xx', async () => {
    const fetch = fakeFetch(401, 404)
    const queue = new RequestQueue(fetch, fakeClock())
    await expect(queue.run('a')).rejects.toBeInstanceOf(LichessAuthError)
    await expect(queue.run('b')).rejects.toMatchObject({ status: 404 })
    expect(fetch.calls).toEqual(['a', 'b'])
  })

  it('keeps serving after a failed request', async () => {
    const queue = new RequestQueue(fakeFetch(404, 200), fakeClock())
    const failed = queue.run('a')
    const ok = queue.run('b')
    await expect(failed).rejects.toThrow()
    expect((await ok).status).toBe(200)
  })
})
