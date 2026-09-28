import { keyAfter, pathMoves } from '@chess-trainer/core'

export function parsePathParam(param: string | undefined): string | undefined {
  const path = param ? param.replaceAll('-', ' ') : ''
  try {
    keyAfter(pathMoves(path))
    return path
  } catch {
    return undefined
  }
}

export const exploreHref = (id: string, path: string) =>
  path ? `/r/${id}/explore/${path.replaceAll(' ', '-')}` : `/r/${id}/explore`

export const drillHref = (id: string, path: string) =>
  path ? `/r/${id}/drill/${path.replaceAll(' ', '-')}` : `/r/${id}/drill`
