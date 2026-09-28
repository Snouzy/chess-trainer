import { buildAuthorizeUrl, exchangeCode, revokeToken } from '@chess-trainer/lichess'
import { localValue } from '../storage/local-value'

const token = localValue('chess-trainer.lichess-token')

export const getToken = token.get
export const useToken = token.use

export function clearToken(): void {
  token.set(undefined)
}

/** Must be identical in the authorize request and the token exchange. */
const redirectUri = () => `${location.origin}${location.pathname}`

export async function login(): Promise<void> {
  location.assign(await buildAuthorizeUrl(redirectUri()))
}

export async function logout(): Promise<void> {
  const value = getToken()
  token.set(undefined)
  if (value) await revokeToken(value).catch(() => undefined)
}

export async function completeLoginIfCallback(): Promise<void> {
  const params = new URLSearchParams(location.search)
  if (!params.has('code') && !params.has('error')) return
  try {
    token.set(await exchangeCode(location.href, redirectUri()))
  } finally {
    history.replaceState(null, '', `${location.pathname}#/`)
  }
}
