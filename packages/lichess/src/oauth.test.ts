import { describe, expect, it } from 'vitest'
import { LichessAuthError } from './errors'
import {
  base64Url,
  buildAuthorizeUrl,
  codeChallenge,
  exchangeCode,
  type KeyValueStorage,
} from './oauth'

function memoryStorage(): KeyValueStorage & { size: () => number } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    size: () => map.size,
  }
}

const REDIRECT = 'http://localhost:5173/'

describe('PKCE helpers', () => {
  it('encodes base64url without padding', () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_')
    expect(base64Url(new Uint8Array([1]))).toBe('AQ')
  })

  it('computes the RFC 7636 S256 challenge', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('buildAuthorizeUrl', () => {
  it('builds the Lichess authorize URL and stores the verifier and state', async () => {
    const storage = memoryStorage()
    const url = new URL(await buildAuthorizeUrl(REDIRECT, storage))
    expect(url.origin + url.pathname).toBe('https://lichess.org/oauth')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('chess-trainer')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(storage.size()).toBe(2)
  })
})

describe('exchangeCode', () => {
  async function authorize() {
    const storage = memoryStorage()
    const url = new URL(await buildAuthorizeUrl(REDIRECT, storage))
    return {
      storage,
      state: url.searchParams.get('state')!,
      challenge: url.searchParams.get('code_challenge')!,
    }
  }

  it('posts the code with the verifier and returns the token', async () => {
    const { storage, state, challenge } = await authorize()
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      return Response.json({ token_type: 'Bearer', access_token: 'tok', expires_in: 31536000 })
    }

    const token = await exchangeCode(
      `${REDIRECT}?code=abc&state=${state}`,
      REDIRECT,
      fetch,
      storage,
    )

    expect(token).toBe('tok')
    expect(requests[0]?.url).toBe('https://lichess.org/api/token')
    expect(requests[0]?.init?.method).toBe('POST')
    const body = new URLSearchParams(String(requests[0]?.init?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('abc')
    expect(body.get('client_id')).toBe('chess-trainer')
    expect(body.get('redirect_uri')).toBe(REDIRECT)
    expect(await codeChallenge(body.get('code_verifier')!)).toBe(challenge)
    expect(storage.size()).toBe(0)
  })

  it('rejects a state mismatch', async () => {
    const { storage } = await authorize()
    const fetch = async () => Response.json({ access_token: 'tok' })
    await expect(
      exchangeCode(`${REDIRECT}?code=abc&state=forged`, REDIRECT, fetch, storage),
    ).rejects.toBeInstanceOf(LichessAuthError)
  })

  it('reports a refusal from Lichess', async () => {
    const { storage } = await authorize()
    const fetch = async () => Response.json({})
    await expect(
      exchangeCode(`${REDIRECT}?error=access_denied`, REDIRECT, fetch, storage),
    ).rejects.toThrow(/access_denied/)
    expect(storage.size()).toBe(0)
  })

  it('rejects a failed token exchange', async () => {
    const { storage, state } = await authorize()
    const fetch = async () => new Response('{}', { status: 400 })
    await expect(
      exchangeCode(`${REDIRECT}?code=abc&state=${state}`, REDIRECT, fetch, storage),
    ).rejects.toBeInstanceOf(LichessAuthError)
  })
})
