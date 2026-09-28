import { LichessAuthError } from './errors'
import type { FetchFn } from './queue'

export const LICHESS_HOST = 'https://lichess.org'
export const CLIENT_ID = 'chess-trainer'
const VERIFIER_KEY = 'chess-trainer.pkce-verifier'
const STATE_KEY = 'chess-trainer.pkce-state'

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export async function buildAuthorizeUrl(
  redirectUri: string,
  storage: KeyValueStorage = sessionStorage,
): Promise<string> {
  const verifier = randomString(32)
  const state = randomString(16)
  storage.setItem(VERIFIER_KEY, verifier)
  storage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state,
  })
  return `${LICHESS_HOST}/oauth?${params}`
}

export async function exchangeCode(
  callbackUrl: string,
  redirectUri: string,
  fetchFn: FetchFn = fetch,
  storage: KeyValueStorage = sessionStorage,
): Promise<string> {
  const params = new URL(callbackUrl).searchParams
  const verifier = storage.getItem(VERIFIER_KEY)
  const expectedState = storage.getItem(STATE_KEY)
  storage.removeItem(VERIFIER_KEY)
  storage.removeItem(STATE_KEY)

  const refusal = params.get('error')
  if (refusal) throw new LichessAuthError(`Lichess refused the login: ${refusal}`)

  const code = params.get('code')
  if (!code || !verifier || !expectedState || params.get('state') !== expectedState) {
    throw new LichessAuthError('Invalid OAuth callback')
  }

  const response = await fetchFn(`${LICHESS_HOST}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) throw new LichessAuthError(`Token exchange failed (${response.status})`)
  const token = ((await response.json()) as { access_token?: unknown } | null)?.access_token
  if (typeof token !== 'string') throw new LichessAuthError('No access token in the response')
  return token
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${LICHESS_HOST}/api/token`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}
