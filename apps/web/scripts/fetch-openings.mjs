import { mkdirSync, writeFileSync } from 'node:fs'
import { Chess, castlingSide } from 'chessops/chess'
import { parseSan } from 'chessops/san'
import { kingCastlesTo, makeUci } from 'chessops/util'

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master'

function toUci(pgn) {
  const pos = Chess.default()
  const moves = []
  for (const token of pgn.split(/\s+/)) {
    const san = token.replace(/^\d+\.+/, '')
    if (!san) continue
    const move = parseSan(pos, san)
    if (!move) throw new Error(`Invalid SAN ${san} in ${pgn}`)
    const side = castlingSide(pos, move)
    moves.push(makeUci(side ? { ...move, to: kingCastlesTo(pos.turn, side) } : move))
    pos.play(move)
  }
  return moves
}

const openings = []
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const response = await fetch(`${BASE}/${file}.tsv`)
  if (!response.ok) throw new Error(`${file}.tsv: HTTP ${response.status}`)
  const [header, ...rows] = (await response.text()).trim().split('\n')
  if (header !== 'eco\tname\tpgn') throw new Error(`Unexpected header in ${file}.tsv: ${header}`)
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    openings.push({ eco, name, moves: toUci(pgn).join(' ') })
  }
}

mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true })
writeFileSync(new URL('../src/data/openings.json', import.meta.url), JSON.stringify(openings))
console.log(`Wrote ${openings.length} openings`)
