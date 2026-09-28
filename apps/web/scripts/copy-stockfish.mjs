import { copyFileSync, mkdirSync } from 'node:fs'

const source = new URL('../node_modules/stockfish/bin/', import.meta.url)
const target = new URL('../public/stockfish/', import.meta.url)
mkdirSync(target, { recursive: true })
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(new URL(file, source), new URL(file, target))
}
console.log('Stockfish copied to public/stockfish')
