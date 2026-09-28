import { MATE_SCORE } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { formatEval, formatLine, pct, ratingLabel, slug } from './format'

describe('format', () => {
  it('shows evaluations from White’s point of view', () => {
    expect(formatEval(30, 'white')).toBe('+0.3')
    expect(formatEval(30, 'black')).toBe('-0.3')
    expect(formatEval(0, 'white')).toBe('0.0')
    expect(formatEval(MATE_SCORE - 3, 'white')).toBe('#3')
    expect(formatEval(MATE_SCORE - 2, 'black')).toBe('#-2')
  })

  it('numbers a SAN line', () => {
    expect(formatLine(['e4', 'e6', 'd4'])).toBe('1. e4 e6 2. d4')
  })

  it('formats percentages, rating buckets and file names', () => {
    expect(pct(0.7)).toBe('70 %')
    expect(pct(0.012)).toBe('1.2 %')
    expect(ratingLabel(1600)).toBe('1600–1799')
    expect(ratingLabel(2500)).toBe('2500+')
    expect(slug('French Defense: Winawer, Réti')).toBe('french-defense-winawer-reti')
  })
})
