import { describe, expect, it } from 'vitest'
import { drillHref, exploreHref, parsePathParam } from './paths'

describe('paths in URLs', () => {
  it('round-trips a move path', () => {
    expect(parsePathParam('e2e4-e7e6')).toBe('e2e4 e7e6')
    expect(parsePathParam(undefined)).toBe('')
  })

  it('rejects an illegal move sequence', () => {
    expect(parsePathParam('e2e4-zzzz')).toBeUndefined()
    expect(parsePathParam('e2e5')).toBeUndefined()
  })

  it('builds links without a trailing slash at the root', () => {
    expect(exploreHref('r1', '')).toBe('/r/r1/explore')
    expect(exploreHref('r1', 'e2e4')).toBe('/r/r1/explore/e2e4')
    expect(drillHref('r1', 'e2e4 e7e6')).toBe('/r/r1/drill/e2e4-e7e6')
  })
})
