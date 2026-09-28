import {
  type Color,
  type LeafReason,
  MATE_SCORE,
  type RepertoireStatus,
  type Speed,
} from '@chess-trainer/core'

export function pct(x: number): string {
  const value = x * 100
  return `${x < 0.1 ? value.toFixed(1) : Math.round(value)} %`
}

export function formatEval(cp: number, turn: Color): string {
  const white = turn === 'white' ? cp : -cp
  if (Math.abs(white) > MATE_SCORE - 1000) {
    return `#${white < 0 ? '-' : ''}${MATE_SCORE - Math.abs(white)}`
  }
  return `${white > 0 ? '+' : ''}${(white / 100).toFixed(1)}`
}

export function formatLine(sans: readonly string[]): string {
  return sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ')
}

export const RATING_BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]

export function ratingLabel(rating: number): string {
  const next = RATING_BUCKETS[RATING_BUCKETS.indexOf(rating) + 1]
  return next === undefined ? `${rating}+` : `${rating}–${next - 1}`
}

export const SPEED_LABELS: Record<Speed, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapide',
  classical: 'Classique',
}

export const STATUS_LABELS: Record<RepertoireStatus, string> = {
  generating: 'Génération en cours',
  paused: 'En pause',
  ready: 'Prêt',
  error: 'Erreur',
}

export const LEAF_LABELS: Record<LeafReason, string> = {
  threshold: 'Fin de ligne : les réponses adverses sont trop rares.',
  minGames: 'Fin de ligne : trop peu de parties dans la base.',
  maxPly: 'Fin de ligne : profondeur maximale atteinte.',
  noMoves: 'Fin de ligne : partie terminée ou données indisponibles.',
}

export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
