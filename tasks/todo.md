# Chess Trainer V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-only app that generates a chess opening repertoire from Lichess explorer statistics plus Stockfish, then drills it line by line.

**Architecture:** pnpm + Turborepo monorepo:
- `packages/core`: pure TypeScript domain logic (generation, editing, drill) behind ports (`ExplorerSource`, `Engine`, `RepertoireStore`).
- `packages/lichess`: explorer client, rate-limited queue, OAuth PKCE.
- `apps/web`: Vite + React app. It wires IndexedDB (Dexie), Stockfish WASM in a Web Worker and chessground.

**Tech Stack:**

| Area | Packages |
|---|---|
| Tooling | Node 22.14, pnpm 12.4, turbo 2.11, TypeScript 7.0, Vitest 5.0, Biome 2.5 |
| App | Vite 8.3, React 19.3, @vitejs/plugin-react 6.1, Tailwind 4.3 (`@tailwindcss/vite`), wouter 3.11 |
| Storage | Dexie 4.4, dexie-react-hooks 4.4, fake-indexeddb 6.2 (tests) |
| Chess | chessops 0.15.1, @lichess-org/chessground 10.4.0, stockfish 19.0.0 (lite single-thread build) |

**Spec:** `docs/superpowers/specs/2026-09-27-chess-trainer-design.md`. Read it before any task.

## Global Constraints

**License and git**
- GPL-3.0-or-later for every package. Set `"license": "GPL-3.0-or-later"` in each `package.json`.
- **Never run `git commit` or `git push`.** The user must approve each commit. At the end of a task, run `git add -N <new files>` so `git diff` shows them. The controller stages all files after the review passes.

**Chess notation**
- Every UCI move stored or compared by the app uses standard castling: `e1g1`, `e1c1`, `e8g8`, `e8c8`.
- Moves from the Lichess explorer and from chessground can arrive as king-takes-rook (`e1h1`). Normalize them with `toStandardUci` before you store or compare them.
- Position identity is `positionKey`: 4-field EPD from `makeFen(pos.toSetup(), { epd: true })` after `Chess.fromSetup`. Never build it with `makeFen(parseFen(x))`: that keeps a bogus en-passant square.

**Lichess API**
- Explorer: `https://explorer.lichess.org/lichess`, `Authorization: Bearer <token>`, one request at a time, at least 2 400 ms between request starts (25/min).
- On 429, wait 60 000 ms. On 5xx or network error, retry after 5 000, 15 000 and 45 000 ms, then fail.
- Never embed a token in source code.

**Browser gotchas**
- Never store `fetch` on an object and call it as a method: that throws "Illegal invocation". Pass `(url, init) => fetch(url, init)`.
- Stockfish: use the `stockfish-19-lite-single` build. Copy it to `apps/web/public/stockfish/` and load it with `new Worker(url)`. Never import the npm `main` (it is a Node wrapper that uses `fs`).
- IndexedDB cannot index booleans. Never add an index on `expanded`.

**Code and copy**
- UI copy is in French, sentence case. Opening names stay in English (Lichess dataset).
- Code, identifiers and comments are in English. Default to zero comments. Comment only a why or a gotcha.

**Formatting (Biome):** 2 spaces, single quotes, no semicolons, line width 100.

## Review Focus

1. **Castling written king-takes-rook.** When the explorer or the board gives `e1h1`, the app must store it as `e1g1`, and the drill must accept both. Tests: Task 1 (`toStandardUci`), Task 2 (explorer castling reply), Task 4 (drill accepts `e1h1`).
2. **Interrupted generation.** If the tab closes or the run aborts after any node, the next run must finish with the same tree, and no duplicate or orphan nodes. Test: Task 2 (abort then resume equals a single run).
3. **Subtree deletion.** It must not delete a sibling whose path shares a string prefix (`… e7e8` versus `… e7e8q`). Tests: Task 2 (MemoryStore), Task 8 (DexieStore).
4. **Malformed explorer response or network loss mid-generation.** A malformed response must end the node as a leaf. Network loss must pause the repertoire. Neither may crash or loop. Tests: Task 2 (InvalidResponseError), Task 10 (runner statuses).
5. **Stale or hand-edited URL.** A URL such as `#/r/<id>/explore/e2e4-zzzz` must show "Position introuvable", not a blank screen. Test: Task 11 (`parsePathParam`).

---

### Task 1: Monorepo scaffold, core types and chess helpers

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `LICENSE`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`, `packages/core/src/types.ts`, `packages/core/src/ports.ts`, `packages/core/src/errors.ts`, `packages/core/src/chess.ts`
- Test: `packages/core/src/chess.test.ts`

**Interfaces:**
- Produces:
  - Types: `Uci`, `PositionKey`, `Color`, `Speed`, `Settings`, `DEFAULT_SETTINGS`, `Repertoire`, `RepertoireStatus`, `Reply`, `LeafReason`, `RepNode`, `Choice`, `PositionStats`, `StatUpdate`, `ExplorerFilters`, `ExplorerMove`, `ExplorerResult`, `EngineResult`, `MATE_SCORE`.
  - Ports: `ExplorerSource`, `Engine`, `RepertoireStore`.
  - Errors: `InvalidResponseError`, `EngineError`.
  - Chess helpers: `INITIAL_KEY`, `positionFromFen`, `keyOf`, `positionKey`, `sideAt`, `toStandardUci`, `playUci`, `keyAfter`, `pathMoves`, `childPath`, `parentPath`, `uciToSan`, `sanLine`, `sanLineToUci`.

- [ ] **Step 1: Create root config files**

`package.json`:
```json
{
  "name": "chess-trainer",
  "private": true,
  "license": "GPL-3.0-or-later",
  "packageManager": "pnpm@12.4.2",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "turbo run dev --filter=@chess-trainer/web",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "format": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.14",
    "turbo": "^2.11.4",
    "typescript": "^7.0.2"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`turbo.json`:
```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "outputs": [] },
    "typecheck": { "outputs": [] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/src/data/openings.json"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } }
  }
}
```

`.gitignore`:
```
node_modules
dist
.turbo
*.log
.DS_Store
apps/web/public/stockfish
```

`LICENSE`: run `curl -sSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE`. Check that the first line contains `GNU GENERAL PUBLIC LICENSE`.

- [ ] **Step 2: Create the core package**

`packages/core/package.json`:
```json
{
  "name": "@chess-trainer/core",
  "version": "0.0.0",
  "private": true,
  "license": "GPL-3.0-or-later",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": { "chessops": "^0.15.1" },
  "devDependencies": { "typescript": "^7.0.2", "vitest": "^5.0.2" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/src/types.ts`:
```ts
export type Uci = string
export type PositionKey = string
export type Color = 'white' | 'black'
export type Speed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'

export interface Settings {
  ratings: number[]
  speeds: Speed[]
  minLineProbability: number
  engineToleranceCp: number
  minGames: number
  maxPly: number
}

export const DEFAULT_SETTINGS: Settings = {
  ratings: [1600, 1800, 2000],
  speeds: ['blitz', 'rapid', 'classical'],
  minLineProbability: 0.01,
  engineToleranceCp: 30,
  minGames: 50,
  maxPly: 30,
}

export type RepertoireStatus = 'generating' | 'paused' | 'ready' | 'error'

export interface Repertoire {
  id: string
  name: string
  color: Color
  rootMoves: Uci[]
  settings: Settings
  status: RepertoireStatus
  createdAt: number
  updatedAt: number
}

export interface Reply {
  uci: Uci
  share: number
  forced?: boolean
}

export type LeafReason = 'threshold' | 'minGames' | 'maxPly' | 'noMoves'

export interface RepNode {
  repertoireId: string
  path: string
  positionKey: PositionKey
  ply: number
  probability: number
  side: 'mine' | 'theirs'
  expanded: boolean
  replies?: Reply[]
  leafReason?: LeafReason
}

export interface Choice {
  repertoireId: string
  positionKey: PositionKey
  uci: Uci
  source: 'auto' | 'user' | 'prefix'
}

export interface PositionStats {
  repertoireId: string
  positionKey: PositionKey
  attempts: number
  errors: number
  lastResult?: 'ok' | 'ko'
  lastSeenAt?: number
}

export interface StatUpdate {
  positionKey: PositionKey
  result: 'ok' | 'ko'
}

export interface ExplorerFilters {
  ratings: number[]
  speeds: Speed[]
}

export interface ExplorerMove {
  uci: Uci
  san: string
  white: number
  draws: number
  black: number
  averageRating?: number
}

export interface ExplorerResult {
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  opening?: { eco: string; name: string }
}

/** Centipawns from the side to move. Mate in N is MATE_SCORE - N, mated in N is -(MATE_SCORE - N). */
export interface EngineResult {
  best: { uci: Uci; cp: number }
  candidates: Record<Uci, number>
  depth: number
}

export const MATE_SCORE = 100_000
```

`packages/core/src/ports.ts`:
```ts
import type {
  Choice,
  EngineResult,
  ExplorerFilters,
  ExplorerResult,
  PositionKey,
  RepNode,
  Uci,
} from './types'

export interface ExplorerSource {
  query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult>
}

export interface Engine {
  evaluate(fen: string, candidates: Uci[]): Promise<EngineResult>
}

export interface RepertoireStore {
  putNode(node: RepNode): Promise<void>
  getNode(repertoireId: string, path: string): Promise<RepNode | undefined>
  unexpandedNodes(repertoireId: string): Promise<RepNode[]>
  nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]>
  /** Deletes the node at `path` and all its descendants. */
  deleteSubtree(repertoireId: string, path: string): Promise<void>
  getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined>
  putChoice(choice: Choice): Promise<void>
}
```

`packages/core/src/errors.ts`:
```ts
export class InvalidResponseError extends Error {
  override name = 'InvalidResponseError'
}

export class EngineError extends Error {
  override name = 'EngineError'
}
```

- [ ] **Step 3: Write the failing chess tests**

`packages/core/src/chess.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  INITIAL_KEY,
  childPath,
  keyAfter,
  parentPath,
  pathMoves,
  playUci,
  positionFromFen,
  positionKey,
  sanLine,
  sanLineToUci,
  sideAt,
  toStandardUci,
  uciToSan,
} from './chess'

const CASTLE_READY = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'

describe('positionKey', () => {
  it('is the 4-field EPD of the initial position', () => {
    expect(INITIAL_KEY).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
  })

  it('strips move counters', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 20')).toBe(INITIAL_KEY)
  })

  it('drops an en-passant square when no capture is legal', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    )
  })

  it('keeps an en-passant square when a capture is legal', () => {
    expect(positionKey('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3')).toBe(
      'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3',
    )
  })

  it('is equal for transpositions', () => {
    expect(keyAfter(['g1f3', 'd7d5', 'd2d4'])).toBe(keyAfter(['d2d4', 'd7d5', 'g1f3']))
  })
})

describe('toStandardUci', () => {
  const pos = () => positionFromFen(CASTLE_READY)

  it('converts king-takes-rook castling to king-two-squares', () => {
    expect(toStandardUci(pos(), 'e1h1')).toBe('e1g1')
    expect(toStandardUci(pos(), 'e1a1')).toBe('e1c1')
  })

  it('keeps standard castling and ordinary moves', () => {
    expect(toStandardUci(pos(), 'e1g1')).toBe('e1g1')
    expect(toStandardUci(pos(), 'h1g1')).toBe('h1g1')
  })

  it('returns undefined for illegal or malformed moves', () => {
    expect(toStandardUci(pos(), 'e1e3')).toBeUndefined()
    expect(toStandardUci(pos(), 'zz')).toBeUndefined()
  })

  it('needs the promotion piece', () => {
    const promo = positionFromFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
    expect(toStandardUci(promo, 'e7e8q')).toBe('e7e8q')
    expect(toStandardUci(promo, 'e7e8')).toBeUndefined()
  })
})

describe('moves and paths', () => {
  it('plays a move and rejects an illegal one', () => {
    expect(playUci(INITIAL_KEY, 'e2e4')).toBe(keyAfter(['e2e4']))
    expect(() => playUci(INITIAL_KEY, 'e2e5')).toThrow()
  })

  it('builds and splits paths', () => {
    expect(childPath('', 'e2e4')).toBe('e2e4')
    expect(childPath('e2e4', 'e7e6')).toBe('e2e4 e7e6')
    expect(pathMoves('')).toEqual([])
    expect(pathMoves('e2e4 e7e6')).toEqual(['e2e4', 'e7e6'])
    expect(parentPath('e2e4 e7e6')).toBe('e2e4')
    expect(parentPath('e2e4')).toBe('')
  })

  it('knows whose move it is for the repertoire color', () => {
    expect(sideAt(INITIAL_KEY, 'white')).toBe('mine')
    expect(sideAt(INITIAL_KEY, 'black')).toBe('theirs')
  })

  it('converts between SAN and UCI', () => {
    expect(uciToSan(INITIAL_KEY, 'g1f3')).toBe('Nf3')
    expect(sanLine(['e2e4', 'e7e6', 'd2d4'])).toEqual(['e4', 'e6', 'd4'])
    expect(sanLineToUci('1. e4 e6 2. d4 d5')).toEqual(['e2e4', 'e7e6', 'd2d4', 'd7d5'])
    expect(sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O').at(-1)).toBe('e1g1')
  })

  it('rejects an invalid SAN line', () => {
    expect(() => sanLineToUci('1. e4 Ke3')).toThrow()
  })
})
```

- [ ] **Step 4: Install dependencies and see the tests fail**

Run: `pnpm install && pnpm --filter @chess-trainer/core test`
Expected: FAIL, "Failed to resolve import './chess'". If pnpm reports ignored build scripts, run `pnpm approve-builds` and accept only the packages Biome and turbo need.

- [ ] **Step 5: Implement `chess.ts` and `index.ts`**

`packages/core/src/chess.ts`:
```ts
import { isNormal } from 'chessops'
import { Chess, castlingSide } from 'chessops/chess'
import { makeFen, parseFen } from 'chessops/fen'
import { makeSan, parseSan } from 'chessops/san'
import { kingCastlesTo, makeUci, parseUci } from 'chessops/util'
import type { Color, PositionKey, Uci } from './types'

export function positionFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

export function keyOf(pos: Chess): PositionKey {
  return makeFen(pos.toSetup(), { epd: true })
}

export const INITIAL_KEY: PositionKey = keyOf(Chess.default())

export function positionKey(fen: string): PositionKey {
  return keyOf(positionFromFen(fen))
}

export function sideAt(key: PositionKey, color: Color): 'mine' | 'theirs' {
  return positionFromFen(key).turn === color ? 'mine' : 'theirs'
}

/** Lichess and chessground write castling as king-takes-rook (e1h1); the app stores e1g1. */
export function toStandardUci(pos: Chess, uci: Uci): Uci | undefined {
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) return undefined
  const side = castlingSide(pos, move)
  if (side && isNormal(move)) return makeUci({ ...move, to: kingCastlesTo(pos.turn, side) })
  return makeUci(move)
}

export function playUci(key: PositionKey, uci: Uci): PositionKey {
  const pos = positionFromFen(key)
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) throw new Error(`Illegal move ${uci} in ${key}`)
  pos.play(move)
  return keyOf(pos)
}

export function keyAfter(moves: readonly Uci[]): PositionKey {
  return moves.reduce(playUci, INITIAL_KEY)
}

export function pathMoves(path: string): Uci[] {
  return path ? path.split(' ') : []
}

export function childPath(path: string, uci: Uci): string {
  return path ? `${path} ${uci}` : uci
}

export function parentPath(path: string): string {
  return pathMoves(path).slice(0, -1).join(' ')
}

export function uciToSan(key: PositionKey, uci: Uci): string {
  const move = parseUci(uci)
  if (!move) throw new Error(`Invalid UCI ${uci}`)
  return makeSan(positionFromFen(key), move)
}

export function sanLine(moves: readonly Uci[]): string[] {
  const sans: string[] = []
  let key = INITIAL_KEY
  for (const uci of moves) {
    sans.push(uciToSan(key, uci))
    key = playUci(key, uci)
  }
  return sans
}

export function sanLineToUci(line: string): Uci[] {
  const pos = Chess.default()
  const moves: Uci[] = []
  for (const token of line.split(/\s+/)) {
    const san = token.replace(/^\d+\.+/, '')
    if (!san) continue
    const move = parseSan(pos, san)
    const uci = move && toStandardUci(pos, makeUci(move))
    if (!move || !uci) throw new Error(`Invalid SAN ${san} in "${line}"`)
    moves.push(uci)
    pos.play(move)
  }
  return moves
}
```

`packages/core/src/index.ts`:
```ts
export * from './chess'
export * from './errors'
export type * from './ports'
export * from './types'
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/core test && pnpm --filter @chess-trainer/core typecheck && pnpm lint`
Expected: all chess tests PASS, no type errors, no lint errors. Run `pnpm format` if Biome only reports formatting.

- [ ] **Step 7: Mark files for review (no commit)**

Run: `git add -N .`
Expected: `git status --short` lists the new files as ` A`.

---

### Task 2: Test fakes and repertoire generation

**Files:**
- Create: `packages/core/src/testing/memory-store.ts`, `packages/core/src/testing/fakes.ts`, `packages/core/src/testing/french.ts`, `packages/core/src/testing/index.ts`
- Create: `packages/core/src/generate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/generate.test.ts`

**Interfaces:**
- Consumes (Task 1): types, ports, `InvalidResponseError`, and the chess helpers.
- Produces:
  - `filtersOf(settings: Settings): ExplorerFilters`
  - `makeChild(parent: RepNode, uci: Uci, probability: number): RepNode`
  - `initRepertoire(repertoire: Repertoire, store: RepertoireStore): Promise<void>`
  - `runGeneration(ctx: GenerationContext): Promise<'done' | 'aborted'>`
  - `GenerationContext = { repertoire: Repertoire; store: RepertoireStore; explorer: ExplorerSource; engine: Engine; signal?: AbortSignal; onProgress?: (p: GenerationProgress) => void }`
  - `GenerationProgress = { expanded: number; pending: number }`
  - `MAX_CANDIDATES = 5`
  - Testing (`@chess-trainer/core/testing`):
    - `MemoryStore` (implements `RepertoireStore`, plus `allNodes(repertoireId)` and `allChoices(repertoireId)`)
    - `fakeExplorer(source)` with `.calls: PositionKey[]`
    - `fakeEngine(table?)` with `.calls: PositionKey[]`
    - `legalUcis(key)`
    - `FRENCH`, `frenchExplorer()`, `frenchEngine()`, `generateFrench()`

- [ ] **Step 1: Write the testing helpers**

`packages/core/src/testing/memory-store.ts`:
```ts
import type { RepertoireStore } from '../ports'
import type { Choice, PositionKey, RepNode } from '../types'

export class MemoryStore implements RepertoireStore {
  readonly nodes = new Map<string, RepNode>()
  readonly choices = new Map<string, Choice>()

  async putNode(node: RepNode): Promise<void> {
    this.nodes.set(`${node.repertoireId}|${node.path}`, structuredClone(node))
  }

  async getNode(repertoireId: string, path: string): Promise<RepNode | undefined> {
    const node = this.nodes.get(`${repertoireId}|${path}`)
    return node && structuredClone(node)
  }

  async unexpandedNodes(repertoireId: string): Promise<RepNode[]> {
    return this.allNodes(repertoireId).filter((n) => !n.expanded)
  }

  async nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]> {
    return this.allNodes(repertoireId).filter((n) => n.positionKey === positionKey)
  }

  async deleteSubtree(repertoireId: string, path: string): Promise<void> {
    const prefix = path ? `${path} ` : ''
    for (const [key, node] of this.nodes) {
      if (node.repertoireId !== repertoireId) continue
      if (node.path === path || node.path.startsWith(prefix)) this.nodes.delete(key)
    }
  }

  async getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined> {
    const choice = this.choices.get(`${repertoireId}|${positionKey}`)
    return choice && structuredClone(choice)
  }

  async putChoice(choice: Choice): Promise<void> {
    this.choices.set(`${choice.repertoireId}|${choice.positionKey}`, structuredClone(choice))
  }

  allNodes(repertoireId: string): RepNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.repertoireId === repertoireId)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((n) => structuredClone(n))
  }

  allChoices(repertoireId: string): Choice[] {
    return [...this.choices.values()]
      .filter((c) => c.repertoireId === repertoireId)
      .sort((a, b) => a.positionKey.localeCompare(b.positionKey))
      .map((c) => structuredClone(c))
  }
}
```

`packages/core/src/testing/fakes.ts`:
```ts
import { makeUci } from 'chessops/util'
import { keyAfter, pathMoves, positionFromFen, positionKey, toStandardUci } from '../chess'
import type { Engine, ExplorerSource } from '../ports'
import type { PositionKey, Uci } from '../types'

type MoveCounts = Array<[Uci, number]>

/** Legal moves in standard UCI, promotions to queen only. */
export function legalUcis(key: PositionKey): Uci[] {
  const pos = positionFromFen(key)
  const moves = new Set<Uci>()
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from)
      const lastRank = to >> 3 === 0 || to >> 3 === 7
      const promotion = piece?.role === 'pawn' && lastRank ? 'queen' : undefined
      const uci = toStandardUci(pos, makeUci({ from, to, promotion }))
      if (uci) moves.add(uci)
    }
  }
  return [...moves]
}

/**
 * Explorer backed by a table keyed by move path ('e2e4 e7e6'), or by a function of the position.
 * Each count goes to `white`, so the total equals the sum of counts.
 */
export function fakeExplorer(
  source: Record<string, MoveCounts> | ((key: PositionKey) => MoveCounts),
): ExplorerSource & { calls: PositionKey[] } {
  const byKey =
    typeof source === 'function'
      ? undefined
      : new Map(Object.entries(source).map(([path, moves]) => [keyAfter(pathMoves(path)), moves]))
  const calls: PositionKey[] = []
  return {
    calls,
    async query(fen) {
      const key = positionKey(fen)
      calls.push(key)
      const counts = typeof source === 'function' ? source(key) : (byKey?.get(key) ?? [])
      const moves = counts.map(([uci, games]) => ({ uci, san: '', white: games, draws: 0, black: 0 }))
      return { white: moves.reduce((sum, m) => sum + m.white, 0), draws: 0, black: 0, moves }
    },
  }
}

/**
 * Engine backed by a table keyed by move path. Without an entry, every candidate scores 0 and the
 * best move is the first candidate, or the first legal move when there is no candidate.
 */
export function fakeEngine(
  table: Record<string, Record<Uci, number>> = {},
): Engine & { calls: PositionKey[] } {
  const byKey = new Map(Object.entries(table).map(([path, evals]) => [keyAfter(pathMoves(path)), evals]))
  const calls: PositionKey[] = []
  return {
    calls,
    async evaluate(fen, candidates) {
      const key = positionKey(fen)
      calls.push(key)
      const evals = byKey.get(key) ?? Object.fromEntries(candidates.map((c) => [c, 0]))
      const ranked = Object.entries(evals).sort((a, b) => b[1] - a[1])
      const [bestUci, bestCp]: [Uci, number] = ranked[0] ?? [legalUcis(key)[0]!, 0]
      return {
        best: { uci: bestUci, cp: bestCp },
        candidates: Object.fromEntries(candidates.map((c) => [c, evals[c] ?? -Infinity])),
        depth: 1,
      }
    },
  }
}
```

`packages/core/src/testing/french.ts`:
```ts
import { buildTree, type RepertoireTree } from '../tree'
import { initRepertoire, runGeneration } from '../generate'
import { DEFAULT_SETTINGS, type Repertoire } from '../types'
import { fakeEngine, fakeExplorer } from './fakes'
import { MemoryStore } from './memory-store'

/** A tiny French Defense repertoire: 7 nodes, 2 opponent branches, leaves at ply 4. */
export const FRENCH: Repertoire = {
  id: 'french',
  name: 'French Defense',
  color: 'black',
  rootMoves: ['e2e4', 'e7e6'],
  settings: { ...DEFAULT_SETTINGS, minLineProbability: 0.1, maxPly: 4, minGames: 10 },
  status: 'generating',
  createdAt: 0,
  updatedAt: 0,
}

export const frenchExplorer = () =>
  fakeExplorer({
    'e2e4 e7e6': [
      ['d2d4', 700],
      ['d2d3', 200],
      ['g1f3', 80],
      ['b2b3', 20],
    ],
    'e2e4 e7e6 d2d4': [
      ['d7d5', 900],
      ['c7c5', 100],
    ],
    'e2e4 e7e6 d2d3': [
      ['d7d5', 500],
      ['c7c5', 400],
    ],
  })

export const frenchEngine = () =>
  fakeEngine({
    'e2e4 e7e6 d2d4': { d7d5: -30, c7c5: -80 },
    'e2e4 e7e6 d2d3': { c7c5: -10, d7d5: -20 },
  })

export async function generateFrench(): Promise<{ store: MemoryStore; tree: RepertoireTree }> {
  const store = new MemoryStore()
  await initRepertoire(FRENCH, store)
  await runGeneration({ repertoire: FRENCH, store, explorer: frenchExplorer(), engine: frenchEngine() })
  const tree = buildTree(FRENCH.color, store.allNodes(FRENCH.id), store.allChoices(FRENCH.id))
  return { store, tree }
}
```

`packages/core/src/testing/index.ts`:
```ts
export * from './fakes'
export * from './french'
export * from './memory-store'
```

`generateFrench` uses `buildTree` from `../tree`. Create that file now with the version below (Task 4 extends it):

`packages/core/src/tree.ts`:
```ts
import type { Choice, Color, PositionKey, RepNode, Uci } from './types'

export interface RepertoireTree {
  color: Color
  nodes: Map<string, RepNode>
  choices: Map<PositionKey, Uci>
}

export function buildTree(
  color: Color,
  nodes: readonly RepNode[],
  choices: readonly Choice[],
): RepertoireTree {
  return {
    color,
    nodes: new Map(nodes.map((n) => [n.path, n])),
    choices: new Map(choices.map((c) => [c.positionKey, c.uci])),
  }
}

/** Moves stored under a node: my choice, or the opponent replies by share, highest first. */
export function childMoves(tree: RepertoireTree, node: RepNode): Uci[] {
  if (node.side === 'mine') {
    const choice = tree.choices.get(node.positionKey)
    return choice ? [choice] : []
  }
  return [...(node.replies ?? [])].sort((a, b) => b.share - a.share).map((r) => r.uci)
}
```

- [ ] **Step 2: Write the failing generation tests**

`packages/core/src/generate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { keyAfter, pathMoves, sanLineToUci } from './chess'
import { InvalidResponseError } from './errors'
import { initRepertoire, runGeneration } from './generate'
import {
  FRENCH,
  MemoryStore,
  fakeEngine,
  fakeExplorer,
  frenchEngine,
  frenchExplorer,
  legalUcis,
} from './testing'
import type { ExplorerSource } from './ports'
import type { Repertoire } from './types'

const key = (path: string) => keyAfter(pathMoves(path))

async function generate(
  repertoire: Repertoire,
  explorer: ExplorerSource = frenchExplorer(),
  engine = frenchEngine(),
) {
  const store = new MemoryStore()
  await initRepertoire(repertoire, store)
  const outcome = await runGeneration({ repertoire, store, explorer, engine })
  return { store, outcome, node: (path: string) => store.getNode(repertoire.id, path) }
}

describe('initRepertoire', () => {
  it('stores the opening moves as a forced prefix', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    expect(await store.getNode('french', '')).toMatchObject({
      side: 'theirs',
      expanded: true,
      replies: [{ uci: 'e2e4', share: 1 }],
    })
    expect(await store.getChoice('french', key('e2e4'))).toMatchObject({ uci: 'e7e6', source: 'prefix' })
    expect(await store.getNode('french', 'e2e4 e7e6')).toMatchObject({
      probability: 1,
      side: 'theirs',
      expanded: false,
      ply: 2,
    })
  })
})

describe('runGeneration', () => {
  it('builds the French fixture tree', async () => {
    const { store, outcome } = await generate(FRENCH)
    expect(outcome).toBe('done')
    expect(store.allNodes('french').map((n) => n.path)).toEqual([
      '',
      'e2e4',
      'e2e4 e7e6',
      'e2e4 e7e6 d2d3',
      'e2e4 e7e6 d2d3 d7d5',
      'e2e4 e7e6 d2d4',
      'e2e4 e7e6 d2d4 d7d5',
    ])
  })

  it('keeps opponent replies above the line probability threshold', async () => {
    const { node } = await generate(FRENCH)
    expect((await node('e2e4 e7e6'))?.replies).toEqual([
      { uci: 'd2d4', share: 0.7 },
      { uci: 'd2d3', share: 0.2 },
    ])
    expect((await node('e2e4 e7e6 d2d4'))?.probability).toBeCloseTo(0.7)
  })

  it('picks the most played move within the engine tolerance', async () => {
    const { store } = await generate(FRENCH)
    expect((await store.getChoice('french', key('e2e4 e7e6 d2d3')))?.uci).toBe('d7d5')
  })

  it('skips a popular move the engine rejects', async () => {
    const engine = fakeEngine({ 'e2e4 e7e6 d2d4': { d7d5: -200, c7c5: -20 } })
    const { store } = await generate(FRENCH, frenchExplorer(), engine)
    expect((await store.getChoice('french', key('e2e4 e7e6 d2d4')))?.uci).toBe('c7c5')
  })

  it('falls back to the engine best move when no candidate is close enough', async () => {
    const engine = fakeEngine({ 'e2e4 e7e6 d2d4': { d7d5: -200, c7c5: -150, b7b6: -20 } })
    const { store } = await generate(FRENCH, frenchExplorer(), engine)
    expect((await store.getChoice('french', key('e2e4 e7e6 d2d4')))?.uci).toBe('b7b6')
  })

  it('reuses an existing choice for the same position without querying', async () => {
    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    await store.putChoice({
      repertoireId: 'french',
      positionKey: key('e2e4 e7e6 d2d4'),
      uci: 'c7c5',
      source: 'user',
    })
    const explorer = frenchExplorer()
    await runGeneration({ repertoire: FRENCH, store, explorer, engine: frenchEngine() })
    expect(explorer.calls).not.toContain(key('e2e4 e7e6 d2d4'))
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toBeDefined()
  })

  it('marks leaves with their reason', async () => {
    const { node } = await generate(FRENCH)
    expect((await node('e2e4 e7e6 d2d4 d7d5'))?.leafReason).toBe('maxPly')

    const few = await generate({ ...FRENCH, settings: { ...FRENCH.settings, minGames: 5000 } })
    expect((await few.node('e2e4 e7e6'))?.leafReason).toBe('minGames')

    const rare = await generate({ ...FRENCH, settings: { ...FRENCH.settings, minLineProbability: 0.9 } })
    expect((await rare.node('e2e4 e7e6'))?.leafReason).toBe('threshold')
  })

  it('stores king-takes-rook castling from the explorer as standard UCI', async () => {
    const rootMoves = sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5')
    const repertoire = { ...FRENCH, rootMoves, settings: { ...FRENCH.settings, maxPly: 8 } }
    const explorer = fakeExplorer({
      [rootMoves.join(' ')]: [
        ['e1h1', 600],
        ['c2c3', 400],
      ],
    })
    const { node } = await generate(repertoire, explorer, fakeEngine())
    expect((await node(rootMoves.join(' ')))?.replies?.map((r) => r.uci)).toEqual(['e1g1', 'c2c3'])
  })

  it('turns an invalid explorer response into a leaf and continues', async () => {
    const inner = frenchExplorer()
    const explorer: ExplorerSource = {
      query: async (fen, filters) =>
        fen === key('e2e4 e7e6')
          ? Promise.reject(new InvalidResponseError('garbled'))
          : inner.query(fen, filters),
    }
    const { node, outcome } = await generate(FRENCH, explorer)
    expect(outcome).toBe('done')
    expect((await node('e2e4 e7e6'))?.leafReason).toBe('noMoves')
  })

  it('resumes after an abort and ends with the same tree as a single run', async () => {
    const single = await generate(FRENCH)

    const store = new MemoryStore()
    await initRepertoire(FRENCH, store)
    const controller = new AbortController()
    const first = await runGeneration({
      repertoire: FRENCH,
      store,
      explorer: frenchExplorer(),
      engine: frenchEngine(),
      signal: controller.signal,
      onProgress: (p) => p.expanded === 2 && controller.abort(),
    })
    expect(first).toBe('aborted')
    const second = await runGeneration({
      repertoire: FRENCH,
      store,
      explorer: frenchExplorer(),
      engine: frenchEngine(),
    })
    expect(second).toBe('done')
    expect(store.allNodes('french')).toEqual(single.store.allNodes('french'))
    expect(store.allChoices('french')).toEqual(single.store.allChoices('french'))
  })

  it('bounds the number of lines by the probability threshold', async () => {
    const explorer = fakeExplorer((k) => legalUcis(k).slice(0, 4).map((uci) => [uci, 100]))
    const repertoire = {
      ...FRENCH,
      rootMoves: [],
      color: 'white' as const,
      settings: { ...FRENCH.settings, minLineProbability: 0.05, maxPly: 30 },
    }
    const { store, outcome } = await generate(repertoire, explorer, fakeEngine())
    expect(outcome).toBe('done')
    const leaves = store.allNodes('french').filter((n) => n.leafReason)
    expect(leaves.length).toBeGreaterThan(0)
    expect(leaves.length).toBeLessThanOrEqual(20)
  })
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/core test`
Expected: FAIL, "Failed to resolve import './generate'".

- [ ] **Step 4: Implement `generate.ts`**

`packages/core/src/generate.ts`:
```ts
import { childPath, playUci, positionFromFen, sideAt, toStandardUci, INITIAL_KEY } from './chess'
import { InvalidResponseError } from './errors'
import type { Engine, ExplorerSource, RepertoireStore } from './ports'
import type {
  ExplorerFilters,
  ExplorerResult,
  LeafReason,
  RepNode,
  Repertoire,
  Reply,
  Settings,
  Uci,
} from './types'

export const MAX_CANDIDATES = 5

export interface GenerationProgress {
  expanded: number
  pending: number
}

export interface GenerationContext {
  repertoire: Repertoire
  store: RepertoireStore
  explorer: ExplorerSource
  engine: Engine
  signal?: AbortSignal
  onProgress?: (progress: GenerationProgress) => void
}

export function filtersOf(settings: Settings): ExplorerFilters {
  return { ratings: settings.ratings, speeds: settings.speeds }
}

export function makeChild(parent: RepNode, uci: Uci, probability: number): RepNode {
  return {
    repertoireId: parent.repertoireId,
    path: childPath(parent.path, uci),
    positionKey: playUci(parent.positionKey, uci),
    ply: parent.ply + 1,
    probability,
    side: parent.side === 'mine' ? 'theirs' : 'mine',
    expanded: false,
  }
}

export async function initRepertoire(repertoire: Repertoire, store: RepertoireStore): Promise<void> {
  const { id: repertoireId, color } = repertoire
  let key = INITIAL_KEY
  let path = ''
  for (const [ply, uci] of repertoire.rootMoves.entries()) {
    const side = sideAt(key, color)
    const node: RepNode = { repertoireId, path, positionKey: key, ply, probability: 1, side, expanded: true }
    if (side === 'mine') {
      await store.putChoice({ repertoireId, positionKey: key, uci, source: 'prefix' })
    } else {
      node.replies = [{ uci, share: 1 }]
    }
    await store.putNode(node)
    key = playUci(key, uci)
    path = childPath(path, uci)
  }
  await store.putNode({
    repertoireId,
    path,
    positionKey: key,
    ply: repertoire.rootMoves.length,
    probability: 1,
    side: sideAt(key, color),
    expanded: false,
  })
}

export async function runGeneration(ctx: GenerationContext): Promise<'done' | 'aborted'> {
  const queue = await ctx.store.unexpandedNodes(ctx.repertoire.id)
  let expanded = 0
  while (queue.length > 0) {
    if (ctx.signal?.aborted) return 'aborted'
    queue.sort((a, b) => b.probability - a.probability || a.path.localeCompare(b.path))
    const node = queue.shift()!
    queue.push(...(await expandNode(node, ctx)))
    expanded++
    ctx.onProgress?.({ expanded, pending: queue.length })
  }
  return 'done'
}

async function expandNode(node: RepNode, ctx: GenerationContext): Promise<RepNode[]> {
  const pos = positionFromFen(node.positionKey)
  if (pos.isEnd()) return markLeaf(node, 'noMoves', ctx)
  if (node.side === 'mine') {
    const uci = await chooseMove(node, ctx)
    const child = makeChild(node, uci, node.probability)
    await ctx.store.putNode(child)
    await ctx.store.putNode({ ...node, expanded: true })
    return [child]
  }

  const { settings } = ctx.repertoire
  if (node.ply >= settings.maxPly) return markLeaf(node, 'maxPly', ctx)
  const stats = await queryExplorer(node, ctx)
  if (!stats) return markLeaf(node, 'noMoves', ctx)
  const total = stats.white + stats.draws + stats.black
  if (total < settings.minGames) return markLeaf(node, 'minGames', ctx)

  const replies: Reply[] = []
  for (const move of stats.moves) {
    const uci = toStandardUci(pos, move.uci)
    const share = (move.white + move.draws + move.black) / total
    if (uci && node.probability * share >= settings.minLineProbability) replies.push({ uci, share })
  }
  if (replies.length === 0) return markLeaf(node, 'threshold', ctx)

  const children = replies.map((r) => makeChild(node, r.uci, node.probability * r.share))
  for (const child of children) await ctx.store.putNode(child)
  await ctx.store.putNode({ ...node, expanded: true, replies })
  return children
}

async function chooseMove(node: RepNode, ctx: GenerationContext): Promise<Uci> {
  const existing = await ctx.store.getChoice(node.repertoireId, node.positionKey)
  if (existing) return existing.uci

  const pos = positionFromFen(node.positionKey)
  const stats = await queryExplorer(node, ctx)
  const candidates = (stats?.moves ?? [])
    .map((m) => ({ uci: toStandardUci(pos, m.uci), games: m.white + m.draws + m.black }))
    .filter((m): m is { uci: Uci; games: number } => m.uci !== undefined)
    .sort((a, b) => b.games - a.games)
    .slice(0, MAX_CANDIDATES)
    .map((m) => m.uci)
  const evaluation = await ctx.engine.evaluate(node.positionKey, candidates)
  const floor = evaluation.best.cp - ctx.repertoire.settings.engineToleranceCp
  const uci =
    candidates.find((c) => (evaluation.candidates[c] ?? Number.NEGATIVE_INFINITY) >= floor) ??
    evaluation.best.uci
  await ctx.store.putChoice({
    repertoireId: node.repertoireId,
    positionKey: node.positionKey,
    uci,
    source: 'auto',
  })
  return uci
}

async function queryExplorer(node: RepNode, ctx: GenerationContext): Promise<ExplorerResult | undefined> {
  try {
    return await ctx.explorer.query(node.positionKey, filtersOf(ctx.repertoire.settings))
  } catch (error) {
    if (!(error instanceof InvalidResponseError)) throw error
    console.warn(`Explorer response ignored at "${node.path}":`, error.message)
    return undefined
  }
}

async function markLeaf(node: RepNode, leafReason: LeafReason, ctx: GenerationContext): Promise<RepNode[]> {
  await ctx.store.putNode({ ...node, expanded: true, leafReason })
  return []
}
```

Update `packages/core/src/index.ts`:
```ts
export * from './chess'
export * from './errors'
export * from './generate'
export type * from './ports'
export * from './tree'
export * from './types'
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/core test && pnpm --filter @chess-trainer/core typecheck && pnpm lint`
Expected: all tests PASS. The bound test must finish in under 5 seconds. If it takes longer, the threshold pruning is wrong: do not raise the timeout.

- [ ] **Step 6: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 3: Repertoire editing (change a move, add or remove a branch)

**Files:**
- Create: `packages/core/src/edit.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './edit'`)
- Test: `packages/core/src/edit.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `makeChild`, `childPath`, `positionFromFen`, `toStandardUci`, `RepertoireStore`, `MemoryStore`, `generateFrench`, `runGeneration`, the `FRENCH` fixtures.
- Produces:
  - `changeChoice(store: RepertoireStore, repertoireId: string, positionKey: PositionKey, uci: Uci): Promise<void>`
  - `addReply(store: RepertoireStore, repertoireId: string, path: string, uci: Uci, share: number): Promise<void>`
  - `removeReply(store: RepertoireStore, repertoireId: string, path: string, uci: Uci): Promise<void>`
  - After an edit, the caller restarts generation (`runGeneration`) to expand the new, unexpanded nodes.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/edit.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { keyAfter, pathMoves } from './chess'
import { addReply, changeChoice, removeReply } from './edit'
import { runGeneration } from './generate'
import { FRENCH, frenchEngine, frenchExplorer, generateFrench } from './testing'

const key = (path: string) => keyAfter(pathMoves(path))
const regenerate = (store: Awaited<ReturnType<typeof generateFrench>>['store']) =>
  runGeneration({ repertoire: FRENCH, store, explorer: frenchExplorer(), engine: frenchEngine() })

describe('changeChoice', () => {
  it('replaces my move and regenerates the subtree below it', async () => {
    const { store } = await generateFrench()
    await changeChoice(store, 'french', key('e2e4 e7e6 d2d4'), 'c7c5')

    expect(await store.getChoice('french', key('e2e4 e7e6 d2d4'))).toMatchObject({
      uci: 'c7c5',
      source: 'user',
    })
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 d7d5')).toBeUndefined()
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toMatchObject({ expanded: false })

    await regenerate(store)
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 c7c5')).toMatchObject({
      expanded: true,
      leafReason: 'maxPly',
    })
  })

  it('refuses to change a move of the chosen opening', async () => {
    const { store } = await generateFrench()
    await expect(changeChoice(store, 'french', key('e2e4'), 'c7c5')).rejects.toThrow(/opening/)
  })

  it('refuses an illegal move', async () => {
    const { store } = await generateFrench()
    await expect(changeChoice(store, 'french', key('e2e4 e7e6 d2d4'), 'e8e6')).rejects.toThrow()
  })

  it('does nothing when the move is unchanged', async () => {
    const { store } = await generateFrench()
    const before = store.allNodes('french')
    await changeChoice(store, 'french', key('e2e4 e7e6 d2d4'), 'd7d5')
    expect(store.allNodes('french')).toEqual(before)
  })
})

describe('addReply', () => {
  it('adds a forced opponent branch generated with the parent probability', async () => {
    const { store } = await generateFrench()
    await addReply(store, 'french', 'e2e4 e7e6', 'g1f3', 0.08)

    expect((await store.getNode('french', 'e2e4 e7e6'))?.replies).toContainEqual({
      uci: 'g1f3',
      share: 0.08,
      forced: true,
    })
    expect(await store.getNode('french', 'e2e4 e7e6 g1f3')).toMatchObject({
      probability: 1,
      side: 'mine',
      expanded: false,
    })

    await regenerate(store)
    expect(await store.getNode('french', 'e2e4 e7e6 g1f3')).toMatchObject({ expanded: true })
  })

  it('clears the leaf reason of a leaf that gets a reply', async () => {
    const { store } = await generateFrench()
    await addReply(store, 'french', 'e2e4 e7e6 d2d4 d7d5', 'b1c3', 0.3)
    const node = await store.getNode('french', 'e2e4 e7e6 d2d4 d7d5')
    expect(node?.leafReason).toBeUndefined()
    expect(node?.replies).toHaveLength(1)
  })
})

describe('removeReply', () => {
  it('removes an opponent branch and its subtree', async () => {
    const { store } = await generateFrench()
    await removeReply(store, 'french', 'e2e4 e7e6', 'd2d3')
    expect((await store.getNode('french', 'e2e4 e7e6'))?.replies?.map((r) => r.uci)).toEqual(['d2d4'])
    expect(await store.getNode('french', 'e2e4 e7e6 d2d3')).toBeUndefined()
    expect(await store.getNode('french', 'e2e4 e7e6 d2d3 d7d5')).toBeUndefined()
  })

  it('refuses to remove the last reply', async () => {
    const { store } = await generateFrench()
    await expect(removeReply(store, 'french', '', 'e2e4')).rejects.toThrow(/last reply/)
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/core test edit`
Expected: FAIL, "Failed to resolve import './edit'".

- [ ] **Step 3: Implement `edit.ts`**

`packages/core/src/edit.ts`:
```ts
import { childPath, positionFromFen, toStandardUci } from './chess'
import { makeChild } from './generate'
import type { RepertoireStore } from './ports'
import type { PositionKey, RepNode, Uci } from './types'

export async function changeChoice(
  store: RepertoireStore,
  repertoireId: string,
  positionKey: PositionKey,
  uci: Uci,
): Promise<void> {
  const move = toStandardUci(positionFromFen(positionKey), uci)
  if (!move) throw new Error(`Illegal move ${uci}`)
  const previous = await store.getChoice(repertoireId, positionKey)
  if (previous?.source === 'prefix') throw new Error('Cannot change a move of the chosen opening')
  if (previous?.uci === move) return

  await store.putChoice({ repertoireId, positionKey, uci: move, source: 'user' })
  for (const node of await store.nodesAt(repertoireId, positionKey)) {
    if (node.side !== 'mine') continue
    if (previous) await store.deleteSubtree(repertoireId, childPath(node.path, previous.uci))
    await store.putNode(makeChild(node, move, node.probability))
    await store.putNode({ ...node, expanded: true })
  }
}

export async function addReply(
  store: RepertoireStore,
  repertoireId: string,
  path: string,
  uci: Uci,
  share: number,
): Promise<void> {
  const node = await store.getNode(repertoireId, path)
  if (!node || node.side !== 'theirs') throw new Error(`No opponent node at "${path}"`)
  const move = toStandardUci(positionFromFen(node.positionKey), uci)
  if (!move) throw new Error(`Illegal move ${uci}`)
  if (node.replies?.some((r) => r.uci === move)) return

  const { leafReason: _cleared, ...rest } = node
  const updated: RepNode = {
    ...rest,
    expanded: true,
    replies: [...(node.replies ?? []), { uci: move, share, forced: true }],
  }
  await store.putNode(makeChild(node, move, node.probability))
  await store.putNode(updated)
}

export async function removeReply(
  store: RepertoireStore,
  repertoireId: string,
  path: string,
  uci: Uci,
): Promise<void> {
  const node = await store.getNode(repertoireId, path)
  if (!node || node.side !== 'theirs' || !node.replies) {
    throw new Error(`No opponent node at "${path}"`)
  }
  if (!node.replies.some((r) => r.uci === uci)) return
  if (node.replies.length === 1) throw new Error('Cannot remove the last reply')

  await store.deleteSubtree(repertoireId, childPath(path, uci))
  await store.putNode({ ...node, replies: node.replies.filter((r) => r.uci !== uci) })
}
```

Add `export * from './edit'` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/core test && pnpm --filter @chess-trainer/core typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 4: Drill session

**Files:**
- Create: `packages/core/src/drill.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './drill'`)
- Test: `packages/core/src/drill.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `RepertoireTree`, `buildTree`, `childPath`, `positionFromFen`, `toStandardUci`, `keyAfter`, `sanLineToUci`, `generateFrench`.
- Produces:
  - `DrillTurn = 'mine' | 'theirs' | 'done'`
  - `PlayResult = { correct: true; stat?: StatUpdate } | { correct: false; expected: Uci; stat?: StatUpdate }`
  - `class DrillSession`:
    - `constructor(tree: RepertoireTree, startPath?: string, rng?: () => number)`
    - getters: `path`, `positionKey`, `turn`, `expected`, `lineErrors`, `isReplay`
    - methods: `playOpponent(): Uci`, `play(uci: Uci): PlayResult`, `nextLine(): void`
  - `pickWeighted(replies: Reply[], rng: () => number): Uci`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/drill.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { keyAfter, pathMoves, sanLineToUci } from './chess'
import { DrillSession, pickWeighted } from './drill'
import { generateFrench } from './testing'
import { buildTree } from './tree'
import type { RepNode } from './types'

const key = (path: string) => keyAfter(pathMoves(path))

describe('pickWeighted', () => {
  const replies = [
    { uci: 'd2d4', share: 0.7 },
    { uci: 'd2d3', share: 0.2 },
  ]
  it('picks by cumulative share', () => {
    expect(pickWeighted(replies, () => 0)).toBe('d2d4')
    expect(pickWeighted(replies, () => 0.77)).toBe('d2d4')
    expect(pickWeighted(replies, () => 0.79)).toBe('d2d3')
    expect(pickWeighted(replies, () => 0.9999)).toBe('d2d3')
  })
})

describe('DrillSession', () => {
  it('plays a full line, counts one error per position and reports stats', async () => {
    const { tree } = await generateFrench()
    const session = new DrillSession(tree, '', () => 0)

    expect(session.turn).toBe('theirs')
    expect(session.playOpponent()).toBe('e2e4')
    expect(session.turn).toBe('mine')
    expect(session.expected).toBe('e7e6')
    expect(session.play('e7e6')).toEqual({
      correct: true,
      stat: { positionKey: key('e2e4'), result: 'ok' },
    })

    expect(session.playOpponent()).toBe('d2d4')
    expect(session.play('c7c5')).toEqual({
      correct: false,
      expected: 'd7d5',
      stat: { positionKey: key('e2e4 e7e6 d2d4'), result: 'ko' },
    })
    expect(session.play('c7c5')).toEqual({ correct: false, expected: 'd7d5' })
    expect(session.play('d7d5')).toEqual({ correct: true })

    expect(session.turn).toBe('done')
    expect(session.lineErrors).toBe(1)
  })

  it('replays a failed line once with the same opponent moves', async () => {
    const { tree } = await generateFrench()
    let r = 0
    const session = new DrillSession(tree, '', () => r)
    session.playOpponent()
    session.play('e7e6')
    session.playOpponent()
    session.play('c7c5')
    session.play('d7d5')

    session.nextLine()
    expect(session.isReplay).toBe(true)
    r = 0.99
    session.playOpponent()
    session.play('e7e6')
    expect(session.playOpponent()).toBe('d2d4')
    session.play('d7d5')
    expect(session.lineErrors).toBe(0)

    session.nextLine()
    expect(session.isReplay).toBe(false)
    session.playOpponent()
    session.play('e7e6')
    expect(session.playOpponent()).toBe('d2d3')
  })

  it('does not replay a replayed line twice', async () => {
    const { tree } = await generateFrench()
    const session = new DrillSession(tree, '', () => 0)
    const failLine = () => {
      session.playOpponent()
      session.play('e7e6')
      session.playOpponent()
      session.play('c7c5')
      session.play('d7d5')
    }
    failLine()
    session.nextLine()
    failLine()
    session.nextLine()
    expect(session.isReplay).toBe(false)
  })

  it('starts from a chosen node', async () => {
    const { tree } = await generateFrench()
    const session = new DrillSession(tree, 'e2e4 e7e6 d2d3')
    expect(session.turn).toBe('mine')
    expect(session.expected).toBe('d7d5')
    expect(session.positionKey).toBe(key('e2e4 e7e6 d2d3'))
  })

  it('accepts king-takes-rook castling for a standard castling choice', () => {
    const moves = sanLineToUci('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5')
    const path = moves.join(' ')
    const mine: RepNode = {
      repertoireId: 'r',
      path,
      positionKey: keyAfter(moves),
      ply: 6,
      probability: 1,
      side: 'mine',
      expanded: true,
    }
    const leaf: RepNode = {
      ...mine,
      path: `${path} e1g1`,
      positionKey: keyAfter([...moves, 'e1g1']),
      ply: 7,
      side: 'theirs',
      leafReason: 'maxPly',
    }
    const tree = buildTree('white', [mine, leaf], [
      { repertoireId: 'r', positionKey: mine.positionKey, uci: 'e1g1', source: 'auto' },
    ])
    const session = new DrillSession(tree, path)
    expect(session.play('e1h1')).toMatchObject({ correct: true })
    expect(session.turn).toBe('done')
  })

  it('is done when my move is not generated yet', async () => {
    const { tree } = await generateFrench()
    tree.choices.delete(key('e2e4 e7e6 d2d4'))
    const session = new DrillSession(tree, 'e2e4 e7e6 d2d4')
    expect(session.turn).toBe('done')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/core test drill`
Expected: FAIL, "Failed to resolve import './drill'".

- [ ] **Step 3: Implement `drill.ts`**

`packages/core/src/drill.ts`:
```ts
import { childPath, keyAfter, pathMoves, positionFromFen, toStandardUci } from './chess'
import type { RepertoireTree } from './tree'
import type { PositionKey, RepNode, Reply, StatUpdate, Uci } from './types'

export type DrillTurn = 'mine' | 'theirs' | 'done'

export type PlayResult =
  | { correct: true; stat?: StatUpdate }
  | { correct: false; expected: Uci; stat?: StatUpdate }

export function pickWeighted(replies: readonly Reply[], rng: () => number): Uci {
  const total = replies.reduce((sum, r) => sum + r.share, 0)
  let x = rng() * total
  for (const reply of replies) {
    x -= reply.share
    if (x < 0) return reply.uci
  }
  return replies.at(-1)!.uci
}

export class DrillSession {
  private currentPath: string
  private plan = new Map<string, Uci>()
  private judged = new Set<string>()
  private errors = 0
  private replaying = false

  constructor(
    private readonly tree: RepertoireTree,
    private readonly startPath = '',
    private readonly rng: () => number = Math.random,
  ) {
    this.currentPath = startPath
  }

  get path(): string {
    return this.currentPath
  }

  get positionKey(): PositionKey {
    return this.node?.positionKey ?? keyAfter(pathMoves(this.currentPath))
  }

  get lineErrors(): number {
    return this.errors
  }

  get isReplay(): boolean {
    return this.replaying
  }

  get turn(): DrillTurn {
    const node = this.node
    if (!node) return 'done'
    if (node.side === 'theirs') return node.replies?.length ? 'theirs' : 'done'
    return this.tree.choices.has(node.positionKey) ? 'mine' : 'done'
  }

  get expected(): Uci | undefined {
    const node = this.node
    return node?.side === 'mine' ? this.tree.choices.get(node.positionKey) : undefined
  }

  playOpponent(): Uci {
    const node = this.node
    if (!node || node.side !== 'theirs' || !node.replies?.length) {
      throw new Error('Not the opponent turn')
    }
    const uci = this.plan.get(node.path) ?? pickWeighted(node.replies, this.rng)
    this.plan.set(node.path, uci)
    this.currentPath = childPath(node.path, uci)
    return uci
  }

  play(uci: Uci): PlayResult {
    const node = this.node
    const expected = this.expected
    if (!node || !expected) throw new Error('Not your turn')
    const played = toStandardUci(positionFromFen(node.positionKey), uci)
    const first = !this.judged.has(node.path)
    this.judged.add(node.path)

    if (played === expected) {
      this.currentPath = childPath(node.path, expected)
      return first ? { correct: true, stat: { positionKey: node.positionKey, result: 'ok' } } : { correct: true }
    }
    if (!first) return { correct: false, expected }
    this.errors++
    return { correct: false, expected, stat: { positionKey: node.positionKey, result: 'ko' } }
  }

  nextLine(): void {
    const replay = this.errors > 0 && !this.replaying
    if (!replay) this.plan = new Map()
    this.replaying = replay
    this.judged = new Set()
    this.errors = 0
    this.currentPath = this.startPath
  }

  private get node(): RepNode | undefined {
    return this.tree.nodes.get(this.currentPath)
  }
}
```

Add `export * from './drill'` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/core test && pnpm --filter @chess-trainer/core typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 5: Opening lookup and PGN export

**Files:**
- Create: `packages/core/src/openings.ts`, `packages/core/src/pgn.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './openings'` and `export * from './pgn'`)
- Test: `packages/core/src/openings.test.ts`, `packages/core/src/pgn.test.ts`

**Interfaces:**
- Consumes: `RepertoireTree`, `childMoves`, `childPath`, `uciToSan`, `generateFrench`.
- Produces:
  - `Opening = { eco: string; name: string; moves: Uci[] }`
  - `findOpening(openings: readonly Opening[], line: readonly Uci[]): Opening | undefined`
  - `searchOpenings(openings: readonly Opening[], query: string, limit?: number): Opening[]`
  - `exportPgn(tree: RepertoireTree, event: string): string`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/openings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { findOpening, searchOpenings, type Opening } from './openings'

const OPENINGS: Opening[] = [
  { eco: 'B00', name: "King's Pawn Game", moves: ['e2e4'] },
  { eco: 'C00', name: 'French Defense', moves: ['e2e4', 'e7e6'] },
  { eco: 'C01', name: 'French Defense: Exchange Variation', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4d5'] },
  { eco: 'A04', name: 'Réti Opening', moves: ['g1f3'] },
]

describe('findOpening', () => {
  it('returns the longest opening that prefixes the line', () => {
    expect(findOpening(OPENINGS, ['e2e4', 'e7e6', 'd2d4'])?.eco).toBe('C00')
    expect(findOpening(OPENINGS, ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4d5', 'e6d5'])?.eco).toBe('C01')
    expect(findOpening(OPENINGS, [])).toBeUndefined()
  })
})

describe('searchOpenings', () => {
  it('matches every word, case and accent insensitive, shortest line first', () => {
    expect(searchOpenings(OPENINGS, 'french').map((o) => o.eco)).toEqual(['C00', 'C01'])
    expect(searchOpenings(OPENINGS, 'FRENCH exch').map((o) => o.eco)).toEqual(['C01'])
    expect(searchOpenings(OPENINGS, 'reti').map((o) => o.eco)).toEqual(['A04'])
    expect(searchOpenings(OPENINGS, 'c00').map((o) => o.eco)).toEqual(['C00'])
  })

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchOpenings(OPENINGS, '  ')).toEqual([])
    expect(searchOpenings(OPENINGS, 'e', 2)).toHaveLength(2)
  })
})
```

`packages/core/src/pgn.test.ts`:
```ts
import { parsePgn } from 'chessops/pgn'
import { describe, expect, it } from 'vitest'
import { exportPgn } from './pgn'
import { generateFrench } from './testing'

describe('exportPgn', () => {
  it('writes the tree with the most frequent reply as the main line', async () => {
    const { tree } = await generateFrench()
    const pgn = exportPgn(tree, 'French Defense')
    const [game] = parsePgn(pgn)

    expect(game?.headers.get('Event')).toBe('French Defense')
    expect([...game!.moves.mainline()].map((d) => d.san)).toEqual(['e4', 'e6', 'd4', 'd5'])
    const afterE6 = game!.moves.children[0]!.children[0]!
    expect(afterE6.children.map((c) => c.data.san)).toEqual(['d4', 'd3'])
    expect(afterE6.children[1]!.children[0]!.data.san).toBe('d5')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/core test openings pgn`
Expected: FAIL, "Failed to resolve import './openings'" and "Failed to resolve import './pgn'".

- [ ] **Step 3: Implement both files**

`packages/core/src/openings.ts`:
```ts
import type { Uci } from './types'

export interface Opening {
  eco: string
  name: string
  moves: Uci[]
}

export function findOpening(openings: readonly Opening[], line: readonly Uci[]): Opening | undefined {
  let best: Opening | undefined
  for (const opening of openings) {
    if (opening.moves.length > line.length) continue
    if (best && opening.moves.length <= best.moves.length) continue
    if (opening.moves.every((move, i) => move === line[i])) best = opening
  }
  return best
}

const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function searchOpenings(openings: readonly Opening[], query: string, limit = 20): Opening[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return openings
    .filter((o) => {
      const haystack = normalize(`${o.eco} ${o.name}`)
      return words.every((w) => haystack.includes(w))
    })
    .sort((a, b) => a.moves.length - b.moves.length)
    .slice(0, limit)
}
```

`packages/core/src/pgn.ts`:
```ts
import { ChildNode, defaultGame, makePgn, type Node, type PgnNodeData } from 'chessops/pgn'
import { childPath, uciToSan } from './chess'
import { childMoves, type RepertoireTree } from './tree'

export function exportPgn(tree: RepertoireTree, event: string): string {
  const game = defaultGame<PgnNodeData>(() => new Map([['Event', event]]))
  const walk = (path: string, parent: Node<PgnNodeData>) => {
    const node = tree.nodes.get(path)
    if (!node) return
    for (const uci of childMoves(tree, node)) {
      const child = new ChildNode<PgnNodeData>({ san: uciToSan(node.positionKey, uci) })
      parent.children.push(child)
      walk(childPath(path, uci), child)
    }
  }
  walk('', game.moves)
  return makePgn(game)
}
```

Add both exports to `packages/core/src/index.ts`.

- [ ] **Step 4: Run all core tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/core test && pnpm --filter @chess-trainer/core typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 6: Lichess request queue and explorer client

**Files:**
- Create: `packages/lichess/package.json`, `packages/lichess/tsconfig.json`
- Create: `packages/lichess/src/index.ts`, `packages/lichess/src/errors.ts`, `packages/lichess/src/queue.ts`, `packages/lichess/src/explorer.ts`
- Create: `packages/lichess/src/fixtures/french-after-e4-e6.json`
- Test: `packages/lichess/src/queue.test.ts`, `packages/lichess/src/explorer.test.ts`

**Interfaces:**
- Consumes (core): `ExplorerSource`, `ExplorerFilters`, `ExplorerResult`, `InvalidResponseError`.
- Produces:
  - Types: `FetchFn = (url: string, init?: RequestInit) => Promise<Response>` and `QueueStatus = { kind: 'idle' } | { kind: 'waiting'; reason: 'rateLimit' | 'retry'; until: number }`.
  - Errors: `LichessAuthError`, `LichessHttpError` (with `status: number`).
  - `class RequestQueue` with `constructor(fetchFn: FetchFn, options?: QueueOptions)` and `run(url: string, init?: RequestInit): Promise<Response>`.
  - `QueueOptions = { minIntervalMs?; rateLimitWaitMs?; retryDelaysMs?; sleep?; now?; onStatus? }`.
  - `EXPLORER_BASE = 'https://explorer.lichess.org'`.
  - `buildExplorerUrl(fen: string, filters: ExplorerFilters, base?: string): string` and `parseExplorerResponse(json: unknown): ExplorerResult`.
  - `class LichessExplorer implements ExplorerSource` with `constructor(queue: RequestQueue, getToken: () => string | undefined, base?: string)`.

- [ ] **Step 1: Create the package**

`packages/lichess/package.json`:
```json
{
  "name": "@chess-trainer/lichess",
  "version": "0.0.0",
  "private": true,
  "license": "GPL-3.0-or-later",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": { "@chess-trainer/core": "workspace:*" },
  "devDependencies": { "typescript": "^7.0.2", "vitest": "^5.0.2" }
}
```

`packages/lichess/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/lichess/src/errors.ts`:
```ts
export class LichessAuthError extends Error {
  override name = 'LichessAuthError'
}

export class LichessHttpError extends Error {
  override name = 'LichessHttpError'

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
```

`packages/lichess/src/fixtures/french-after-e4-e6.json` is written by hand from the documented schema, with invented counts. The smoke test in Task 14 replaces it with a captured response.
```json
{
  "white": 1520000,
  "draws": 110000,
  "black": 1370000,
  "moves": [
    {
      "uci": "d2d4",
      "san": "d4",
      "averageRating": 1712,
      "white": 1100000,
      "draws": 80000,
      "black": 950000,
      "game": null,
      "opening": { "eco": "C00", "name": "French Defense: Normal Variation" }
    },
    {
      "uci": "d2d3",
      "san": "d3",
      "averageRating": 1580,
      "white": 230000,
      "draws": 15000,
      "black": 230000,
      "game": null,
      "opening": null
    },
    {
      "uci": "g1f3",
      "san": "Nf3",
      "averageRating": 1650,
      "white": 190000,
      "draws": 15000,
      "black": 190000,
      "game": null,
      "opening": null
    }
  ],
  "topGames": [],
  "recentGames": [],
  "opening": { "eco": "C00", "name": "French Defense" }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/lichess/src/queue.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { LichessAuthError, LichessHttpError } from './errors'
import { RequestQueue, type QueueStatus } from './queue'

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
```

`packages/lichess/src/explorer.test.ts`:
```ts
import { InvalidResponseError } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { LichessAuthError } from './errors'
import { LichessExplorer, buildExplorerUrl, parseExplorerResponse } from './explorer'
import fixture from './fixtures/french-after-e4-e6.json'
import { RequestQueue } from './queue'

const FEN = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'
const FILTERS = { ratings: [1600, 1800], speeds: ['blitz' as const, 'rapid' as const] }
const instant = { sleep: async () => {}, now: () => 0 }

describe('buildExplorerUrl', () => {
  it('encodes the position and the filters', () => {
    const url = new URL(buildExplorerUrl(FEN, FILTERS))
    expect(url.origin + url.pathname).toBe('https://explorer.lichess.org/lichess')
    expect(url.searchParams.get('fen')).toBe(FEN)
    expect(url.searchParams.get('variant')).toBe('standard')
    expect(url.searchParams.get('speeds')).toBe('blitz,rapid')
    expect(url.searchParams.get('ratings')).toBe('1600,1800')
    expect(url.searchParams.get('topGames')).toBe('0')
  })
})

describe('parseExplorerResponse', () => {
  it('keeps totals, moves and the opening name', () => {
    const result = parseExplorerResponse(fixture)
    expect(result.white + result.draws + result.black).toBe(3_000_000)
    expect(result.moves.map((m) => m.uci)).toEqual(['d2d4', 'd2d3', 'g1f3'])
    expect(result.moves[0]).toMatchObject({ san: 'd4', white: 1_100_000, averageRating: 1712 })
    expect(result.opening).toEqual({ eco: 'C00', name: 'French Defense' })
  })

  it('rejects a response without moves', () => {
    expect(() => parseExplorerResponse({ white: 1 })).toThrow(InvalidResponseError)
    expect(() => parseExplorerResponse(null)).toThrow(InvalidResponseError)
  })

  it('rejects a move with a missing count', () => {
    const bad = { ...fixture, moves: [{ uci: 'd2d4', san: 'd4', white: 1, draws: 1 }] }
    expect(() => parseExplorerResponse(bad)).toThrow(InvalidResponseError)
  })
})

describe('LichessExplorer', () => {
  it('sends the bearer token and parses the answer', async () => {
    const inits: RequestInit[] = []
    const fetch = async (_url: string, init?: RequestInit) => {
      inits.push(init ?? {})
      return new Response(JSON.stringify(fixture), { status: 200 })
    }
    const explorer = new LichessExplorer(new RequestQueue(fetch, instant), () => 'tok')
    const result = await explorer.query(FEN, FILTERS)
    expect(result.moves).toHaveLength(3)
    expect(new Headers(inits[0]?.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('refuses to query without a token', async () => {
    let called = false
    const fetch = async () => {
      called = true
      return new Response('{}')
    }
    const explorer = new LichessExplorer(new RequestQueue(fetch, instant), () => undefined)
    await expect(explorer.query(FEN, FILTERS)).rejects.toBeInstanceOf(LichessAuthError)
    expect(called).toBe(false)
  })

  it('turns a non-JSON body into an InvalidResponseError', async () => {
    const fetch = async () => new Response('<html>oops</html>', { status: 200 })
    const explorer = new LichessExplorer(new RequestQueue(fetch, instant), () => 'tok')
    await expect(explorer.query(FEN, FILTERS)).rejects.toBeInstanceOf(InvalidResponseError)
  })
})
```

- [ ] **Step 3: Install and see the tests fail**

Run: `pnpm install && pnpm --filter @chess-trainer/lichess test`
Expected: FAIL, "Failed to resolve import './queue'".

- [ ] **Step 4: Implement the queue and the explorer**

`packages/lichess/src/queue.ts`:
```ts
import { LichessAuthError, LichessHttpError } from './errors'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type QueueStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; reason: 'rateLimit' | 'retry'; until: number }

export interface QueueOptions {
  minIntervalMs?: number
  rateLimitWaitMs?: number
  retryDelaysMs?: number[]
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onStatus?: (status: QueueStatus) => void
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Runs requests one at a time, at most 25 per minute, as the Lichess explorer requires. */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private lastStart = Number.NEGATIVE_INFINITY
  private readonly minIntervalMs: number
  private readonly rateLimitWaitMs: number
  private readonly retryDelaysMs: number[]
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly options: QueueOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 2_400
    this.rateLimitWaitMs = options.rateLimitWaitMs ?? 60_000
    this.retryDelaysMs = options.retryDelaysMs ?? [5_000, 15_000, 45_000]
    this.sleep = options.sleep ?? wait
    this.now = options.now ?? Date.now
  }

  run(url: string, init?: RequestInit): Promise<Response> {
    const task = this.tail.then(() => this.execute(url, init))
    this.tail = task.catch(() => undefined)
    return task
  }

  private async execute(url: string, init?: RequestInit): Promise<Response> {
    let retries = 0
    for (;;) {
      await this.waitForSlot()
      let response: Response | undefined
      let failure: unknown
      try {
        const fetchFn = this.fetchFn
        response = await fetchFn(url, init)
      } catch (error) {
        failure = error
      }

      if (response?.status === 401) throw new LichessAuthError('Lichess rejected the token')
      if (response?.status === 429) {
        await this.pause('rateLimit', this.rateLimitWaitMs)
        continue
      }
      if (response && response.status < 500) {
        if (!response.ok) throw new LichessHttpError(response.status, `Lichess answered ${response.status}`)
        return response
      }

      const delay = this.retryDelaysMs[retries++]
      if (delay === undefined) {
        throw response ? new LichessHttpError(response.status, `Lichess answered ${response.status}`) : failure
      }
      await this.pause('retry', delay)
    }
  }

  private async waitForSlot(): Promise<void> {
    const delay = this.lastStart + this.minIntervalMs - this.now()
    if (delay > 0) await this.sleep(delay)
    this.lastStart = this.now()
  }

  private async pause(reason: 'rateLimit' | 'retry', ms: number): Promise<void> {
    this.options.onStatus?.({ kind: 'waiting', reason, until: this.now() + ms })
    await this.sleep(ms)
    this.options.onStatus?.({ kind: 'idle' })
  }
}
```

`packages/lichess/src/explorer.ts`:
```ts
import {
  type ExplorerFilters,
  type ExplorerMove,
  type ExplorerResult,
  type ExplorerSource,
  InvalidResponseError,
} from '@chess-trainer/core'
import { LichessAuthError } from './errors'
import type { RequestQueue } from './queue'

export const EXPLORER_BASE = 'https://explorer.lichess.org'

export function buildExplorerUrl(fen: string, filters: ExplorerFilters, base = EXPLORER_BASE): string {
  const params = new URLSearchParams({
    variant: 'standard',
    fen,
    moves: '12',
    topGames: '0',
    recentGames: '0',
  })
  if (filters.speeds.length > 0) params.set('speeds', filters.speeds.join(','))
  if (filters.ratings.length > 0) params.set('ratings', filters.ratings.join(','))
  return `${base}/lichess?${params}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidResponseError(`Expected a game count, got ${JSON.stringify(value)}`)
  }
  return value
}

function parseMove(value: unknown): ExplorerMove {
  if (!isRecord(value) || typeof value.uci !== 'string' || typeof value.san !== 'string') {
    throw new InvalidResponseError('Explorer move without uci or san')
  }
  return {
    uci: value.uci,
    san: value.san,
    white: count(value.white),
    draws: count(value.draws),
    black: count(value.black),
    averageRating: typeof value.averageRating === 'number' ? value.averageRating : undefined,
  }
}

export function parseExplorerResponse(json: unknown): ExplorerResult {
  if (!isRecord(json) || !Array.isArray(json.moves)) {
    throw new InvalidResponseError('Explorer response without moves')
  }
  const { opening } = json
  return {
    white: count(json.white),
    draws: count(json.draws),
    black: count(json.black),
    moves: json.moves.map(parseMove),
    opening:
      isRecord(opening) && typeof opening.eco === 'string' && typeof opening.name === 'string'
        ? { eco: opening.eco, name: opening.name }
        : undefined,
  }
}

export class LichessExplorer implements ExplorerSource {
  constructor(
    private readonly queue: RequestQueue,
    private readonly getToken: () => string | undefined,
    private readonly base = EXPLORER_BASE,
  ) {}

  async query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult> {
    const token = this.getToken()
    if (!token) throw new LichessAuthError('Not logged in to Lichess')
    const response = await this.queue.run(buildExplorerUrl(fen, filters, this.base), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new InvalidResponseError('Explorer response is not JSON')
    }
    return parseExplorerResponse(json)
  }
}
```

`packages/lichess/src/index.ts`:
```ts
export * from './errors'
export * from './explorer'
export * from './queue'
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/lichess test && pnpm --filter @chess-trainer/lichess typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 7: Lichess OAuth PKCE

**Files:**
- Create: `packages/lichess/src/oauth.ts`
- Modify: `packages/lichess/src/index.ts` (add `export * from './oauth'`)
- Test: `packages/lichess/src/oauth.test.ts`

**Interfaces:**
- Consumes: `LichessAuthError`, `FetchFn`.
- Produces:
  - Constants: `LICHESS_HOST = 'https://lichess.org'`, `CLIENT_ID = 'chess-trainer'`.
  - Type: `KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`.
  - `base64Url(bytes: Uint8Array): string`
  - `codeChallenge(verifier: string): Promise<string>`
  - `buildAuthorizeUrl(redirectUri: string, storage?: KeyValueStorage): Promise<string>`
  - `exchangeCode(callbackUrl: string, redirectUri: string, fetchFn?: FetchFn, storage?: KeyValueStorage): Promise<string>`, which returns the access token.
  - `revokeToken(token: string, fetchFn?: FetchFn): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`packages/lichess/src/oauth.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { LichessAuthError } from './errors'
import {
  type KeyValueStorage,
  base64Url,
  buildAuthorizeUrl,
  codeChallenge,
  exchangeCode,
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
    return { storage, state: url.searchParams.get('state')!, challenge: url.searchParams.get('code_challenge')! }
  }

  it('posts the code with the verifier and returns the token', async () => {
    const { storage, state, challenge } = await authorize()
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      return Response.json({ token_type: 'Bearer', access_token: 'tok', expires_in: 31536000 })
    }

    const token = await exchangeCode(`${REDIRECT}?code=abc&state=${state}`, REDIRECT, fetch, storage)

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
  })

  it('rejects a failed token exchange', async () => {
    const { storage, state } = await authorize()
    const fetch = async () => new Response('{}', { status: 400 })
    await expect(
      exchangeCode(`${REDIRECT}?code=abc&state=${state}`, REDIRECT, fetch, storage),
    ).rejects.toBeInstanceOf(LichessAuthError)
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/lichess test oauth`
Expected: FAIL, "Failed to resolve import './oauth'".

- [ ] **Step 3: Implement `oauth.ts`**

`packages/lichess/src/oauth.ts`:
```ts
import { LichessAuthError } from './errors'
import type { FetchFn } from './queue'

export const LICHESS_HOST = 'https://lichess.org'
export const CLIENT_ID = 'chess-trainer'
const VERIFIER_KEY = 'chess-trainer.pkce-verifier'
const STATE_KEY = 'chess-trainer.pkce-state'

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const defaultFetch: FetchFn = (url, init) => fetch(url, init)

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
  fetchFn: FetchFn = defaultFetch,
  storage: KeyValueStorage = sessionStorage,
): Promise<string> {
  const params = new URL(callbackUrl).searchParams
  const refusal = params.get('error')
  if (refusal) throw new LichessAuthError(`Lichess refused the login: ${refusal}`)

  const code = params.get('code')
  const verifier = storage.getItem(VERIFIER_KEY)
  const expectedState = storage.getItem(STATE_KEY)
  storage.removeItem(VERIFIER_KEY)
  storage.removeItem(STATE_KEY)
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
  const json: unknown = await response.json()
  const token = typeof json === 'object' && json !== null ? (json as { access_token?: unknown }).access_token : undefined
  if (typeof token !== 'string') throw new LichessAuthError('No access token in the response')
  return token
}

export async function revokeToken(token: string, fetchFn: FetchFn = defaultFetch): Promise<void> {
  await fetchFn(`${LICHESS_HOST}/api/token`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}
```

Add `export * from './oauth'` to `packages/lichess/src/index.ts`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/lichess test && pnpm --filter @chess-trainer/lichess typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 8: Web app scaffold, IndexedDB storage, openings dataset, backups

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx` (placeholder, replaced in Task 11), `apps/web/src/index.css`
- Create: `apps/web/scripts/fetch-openings.mjs`, `apps/web/src/data/openings.json` (generated), `apps/web/src/data/openings.ts`
- Create: `apps/web/src/storage/db.ts`, `apps/web/src/storage/dexie-store.ts`, `apps/web/src/storage/cached-explorer.ts`, `apps/web/src/storage/backup.ts`
- Test: `apps/web/src/storage/dexie-store.test.ts`, `apps/web/src/storage/cached-explorer.test.ts`, `apps/web/src/storage/backup.test.ts`

**Interfaces:**
- Consumes (core): the types, `RepertoireStore`, `ExplorerSource`, `buildTree`, `RepertoireTree`, `positionKey`, `Opening`. From `@chess-trainer/core/testing`: `generateFrench`, `FRENCH`, `frenchExplorer`, `frenchEngine`.
- Produces:
  - `class TrainerDb extends Dexie` with tables `repertoires`, `nodes`, `choices`, `stats`, `explorerCache`, `engineCache`, and `constructor(name?: string)`.
  - `ExplorerCacheEntry = { key: string; result: ExplorerResult; fetchedAt: number }`
  - `EngineCacheEntry = { positionKey: PositionKey; result: EngineResult }`
  - `class DexieStore implements RepertoireStore`, with extra methods:
    - `nodesOf(id): Promise<RepNode[]>`, `choicesOf(id): Promise<Choice[]>`, `statsOf(id): Promise<PositionStats[]>`
    - `loadTree(id): Promise<RepertoireTree>`
    - `recordStat(id, update: StatUpdate): Promise<void>`
    - `summary(id): Promise<{ positions: number; mastered: number }>`
    - `deleteRepertoire(id): Promise<void>`
  - `class CachedExplorerSource implements ExplorerSource`, with `constructor(db: TrainerDb, inner: ExplorerSource, sourceId?: string)` and `peek(fen, filters): Promise<ExplorerResult | undefined>`.
  - `explorerCacheKey(sourceId, key, filters): string`
  - `exportBackup(db, id): Promise<string>` and `importBackup(db, json: string, newId?: string): Promise<string>`.
  - `OPENINGS: Opening[]`

- [ ] **Step 1: Create the app package and config**

`apps/web/package.json`:
```json
{
  "name": "@chess-trainer/web",
  "version": "0.0.0",
  "private": true,
  "license": "GPL-3.0-or-later",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "fetch-openings": "node scripts/fetch-openings.mjs"
  },
  "dependencies": {
    "@chess-trainer/core": "workspace:*",
    "@chess-trainer/lichess": "workspace:*",
    "@lichess-org/chessground": "^10.4.0",
    "chessops": "^0.15.1",
    "dexie": "^4.4.6",
    "dexie-react-hooks": "^4.4.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "stockfish": "^19.0.0",
    "wouter": "^3.11.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "fake-indexeddb": "^6.2.5",
    "tailwindcss": "^4.3.3",
    "typescript": "^7.0.2",
    "vite": "^8.3.1",
    "vitest": "^5.0.2"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "types": ["vite/client"] },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { environment: 'node' },
})
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chess Trainer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/index.css`:
```css
@import "tailwindcss";
```

`apps/web/src/main.tsx` (placeholder until Task 11):
```tsx
import './index.css'

document.getElementById('root')!.textContent = 'Chess Trainer'
```

- [ ] **Step 2: Generate the openings dataset**

`apps/web/scripts/fetch-openings.mjs`:
```js
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
```

Run: `pnpm install && pnpm --filter @chess-trainer/web fetch-openings`
Expected: `Wrote 3815 openings`, or a count between 3 500 and 4 500. On HTTP 404, the default branch is not `master`: check it with `gh api repos/lichess-org/chess-openings --jq .default_branch` and fix `BASE`.

`apps/web/src/data/openings.ts`:
```ts
import type { Opening } from '@chess-trainer/core'
import raw from './openings.json'

export const OPENINGS: Opening[] = (raw as Array<{ eco: string; name: string; moves: string }>).map(
  (o) => ({ eco: o.eco, name: o.name, moves: o.moves.split(' ') }),
)
```

- [ ] **Step 3: Write the failing storage tests**

`apps/web/src/storage/dexie-store.test.ts`:
```ts
import 'fake-indexeddb/auto'
import { initRepertoire, keyAfter, runGeneration } from '@chess-trainer/core'
import { FRENCH, frenchEngine, frenchExplorer, generateFrench } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { TrainerDb } from './db'
import { DexieStore } from './dexie-store'

function freshStore() {
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  return { db, store: new DexieStore(db) }
}

async function generateInDexie() {
  const { db, store } = freshStore()
  await db.repertoires.put(FRENCH)
  await initRepertoire(FRENCH, store)
  await runGeneration({ repertoire: FRENCH, store, explorer: frenchExplorer(), engine: frenchEngine() })
  return { db, store }
}

describe('DexieStore', () => {
  it('generates the same tree as the in-memory store', async () => {
    const { store } = await generateInDexie()
    const expected = await generateFrench()
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
    expect((await store.nodesOf('french')).sort(byPath)).toEqual(expected.store.allNodes('french'))
    expect((await store.loadTree('french')).choices).toEqual(expected.tree.choices)
  })

  it('lists unexpanded nodes and nodes at a position', async () => {
    const { store } = freshStore()
    await initRepertoire(FRENCH, store)
    expect((await store.unexpandedNodes('french')).map((n) => n.path)).toEqual(['e2e4 e7e6'])
    expect((await store.nodesAt('french', keyAfter(['e2e4']))).map((n) => n.path)).toEqual(['e2e4'])
  })

  it('deletes a subtree without touching siblings that share a string prefix', async () => {
    const { store } = freshStore()
    const node = (path: string) => ({
      repertoireId: 'r',
      path,
      positionKey: path,
      ply: path.split(' ').length,
      probability: 1,
      side: 'mine' as const,
      expanded: true,
    })
    for (const path of ['a', 'a e7e8', 'a e7e8 b', 'a e7e8q', 'a e7e8q c']) await store.putNode(node(path))
    await store.putNode({ ...node('a e7e8'), repertoireId: 'other' })

    await store.deleteSubtree('r', 'a e7e8')

    expect((await store.nodesOf('r')).map((n) => n.path).sort()).toEqual(['a', 'a e7e8q', 'a e7e8q c'])
    expect(await store.getNode('other', 'a e7e8')).toBeDefined()
  })

  it('records stats and summarizes mastery over current positions', async () => {
    const { store } = await generateInDexie()
    const k = keyAfter(['e2e4', 'e7e6', 'd2d4'])
    await store.recordStat('french', { positionKey: k, result: 'ko' })
    await store.recordStat('french', { positionKey: k, result: 'ok' })
    await store.recordStat('french', { positionKey: 'not-in-tree', result: 'ok' })

    expect((await store.statsOf('french')).find((s) => s.positionKey === k)).toMatchObject({
      attempts: 2,
      errors: 1,
      lastResult: 'ok',
    })
    expect(await store.summary('french')).toEqual({ positions: 3, mastered: 1 })
  })

  it('deletes a repertoire and all its rows', async () => {
    const { db, store } = await generateInDexie()
    await store.recordStat('french', { positionKey: keyAfter(['e2e4']), result: 'ok' })
    await store.deleteRepertoire('french')
    expect(await db.repertoires.count()).toBe(0)
    expect(await db.nodes.count()).toBe(0)
    expect(await db.choices.count()).toBe(0)
    expect(await db.stats.count()).toBe(0)
  })
})
```

`apps/web/src/storage/cached-explorer.test.ts`:
```ts
import 'fake-indexeddb/auto'
import { INITIAL_KEY } from '@chess-trainer/core'
import { fakeExplorer } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { CachedExplorerSource } from './cached-explorer'
import { TrainerDb } from './db'

const FILTERS = { ratings: [1800, 1600], speeds: ['rapid' as const, 'blitz' as const] }

function setup() {
  const inner = fakeExplorer({ '': [['e2e4', 10]] })
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  return { inner, explorer: new CachedExplorerSource(db, inner) }
}

describe('CachedExplorerSource', () => {
  it('queries once per position and filters', async () => {
    const { inner, explorer } = setup()
    const first = await explorer.query(`${INITIAL_KEY} 0 1`, FILTERS)
    const second = await explorer.query(INITIAL_KEY, { ratings: [1600, 1800], speeds: ['blitz', 'rapid'] })
    expect(second).toEqual(first)
    expect(inner.calls).toHaveLength(1)
  })

  it('misses when the filters differ', async () => {
    const { inner, explorer } = setup()
    await explorer.query(INITIAL_KEY, FILTERS)
    await explorer.query(INITIAL_KEY, { ...FILTERS, ratings: [2000] })
    expect(inner.calls).toHaveLength(2)
  })

  it('peeks without querying', async () => {
    const { inner, explorer } = setup()
    expect(await explorer.peek(INITIAL_KEY, FILTERS)).toBeUndefined()
    await explorer.query(INITIAL_KEY, FILTERS)
    expect(await explorer.peek(INITIAL_KEY, FILTERS)).toBeDefined()
    expect(inner.calls).toHaveLength(1)
  })
})
```

`apps/web/src/storage/backup.test.ts`:
```ts
import 'fake-indexeddb/auto'
import { initRepertoire, runGeneration } from '@chess-trainer/core'
import { FRENCH, frenchEngine, frenchExplorer } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { TrainerDb } from './db'
import { DexieStore } from './dexie-store'

async function seeded() {
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  const store = new DexieStore(db)
  await db.repertoires.put(FRENCH)
  await initRepertoire(FRENCH, store)
  await runGeneration({ repertoire: FRENCH, store, explorer: frenchExplorer(), engine: frenchEngine() })
  await store.recordStat('french', { positionKey: FRENCH.id, result: 'ok' })
  return { db, store }
}

describe('backup', () => {
  it('round-trips a repertoire under a new id', async () => {
    const { db, store } = await seeded()
    const json = await exportBackup(db, 'french')
    const id = await importBackup(db, json, 'copy')

    expect(id).toBe('copy')
    expect(await db.repertoires.get('copy')).toMatchObject({ name: 'French Defense', status: 'paused' })
    const strip = <T extends { repertoireId: string }>(rows: T[]) =>
      rows.map(({ repertoireId: _, ...rest }) => rest)
    expect(strip(await store.nodesOf('copy'))).toEqual(strip(await store.nodesOf('french')))
    expect(strip(await store.choicesOf('copy'))).toEqual(strip(await store.choicesOf('french')))
    expect(await store.statsOf('copy')).toHaveLength(1)
  })

  it('rejects invalid files without writing anything', async () => {
    const { db } = await seeded()
    const before = await db.nodes.count()
    await expect(importBackup(db, 'not json')).rejects.toThrow(/invalide/)
    await expect(importBackup(db, JSON.stringify({ format: 'other' }))).rejects.toThrow(/invalide/)
    const valid = JSON.parse(await exportBackup(db, 'french'))
    valid.nodes[0].ply = 'three'
    await expect(importBackup(db, JSON.stringify(valid))).rejects.toThrow(/invalide/)
    expect(await db.nodes.count()).toBe(before)
    expect(await db.repertoires.count()).toBe(1)
  })
})
```

- [ ] **Step 4: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/web test`
Expected: FAIL, "Failed to resolve import './db'".

- [ ] **Step 5: Implement the storage modules**

`apps/web/src/storage/db.ts`:
```ts
import type {
  Choice,
  EngineResult,
  ExplorerResult,
  PositionKey,
  PositionStats,
  RepNode,
  Repertoire,
} from '@chess-trainer/core'
import Dexie, { type EntityTable, type Table } from 'dexie'

export interface ExplorerCacheEntry {
  key: string
  result: ExplorerResult
  fetchedAt: number
}

export interface EngineCacheEntry {
  positionKey: PositionKey
  result: EngineResult
}

export class TrainerDb extends Dexie {
  repertoires!: EntityTable<Repertoire, 'id'>
  nodes!: Table<RepNode, [string, string]>
  choices!: Table<Choice, [string, string]>
  stats!: Table<PositionStats, [string, string]>
  explorerCache!: EntityTable<ExplorerCacheEntry, 'key'>
  engineCache!: EntityTable<EngineCacheEntry, 'positionKey'>

  constructor(name = 'chess-trainer') {
    super(name)
    // IndexedDB cannot index booleans: never add an index on nodes.expanded.
    this.version(1).stores({
      repertoires: 'id, status, createdAt',
      nodes: '[repertoireId+path], [repertoireId+positionKey]',
      choices: '[repertoireId+positionKey]',
      stats: '[repertoireId+positionKey]',
      explorerCache: 'key',
      engineCache: 'positionKey',
    })
  }
}
```

`apps/web/src/storage/dexie-store.ts`:
```ts
import {
  type Choice,
  type PositionKey,
  type PositionStats,
  type RepNode,
  type RepertoireStore,
  type RepertoireTree,
  type StatUpdate,
  buildTree,
} from '@chess-trainer/core'
import Dexie from 'dexie'
import type { TrainerDb } from './db'

const all = (repertoireId: string) => [[repertoireId, Dexie.minKey], [repertoireId, Dexie.maxKey]] as const

export class DexieStore implements RepertoireStore {
  constructor(private readonly db: TrainerDb) {}

  async putNode(node: RepNode): Promise<void> {
    await this.db.nodes.put(node)
  }

  getNode(repertoireId: string, path: string): Promise<RepNode | undefined> {
    return this.db.nodes.get([repertoireId, path])
  }

  async unexpandedNodes(repertoireId: string): Promise<RepNode[]> {
    return (await this.nodesOf(repertoireId)).filter((n) => !n.expanded)
  }

  nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]> {
    return this.db.nodes.where('[repertoireId+positionKey]').equals([repertoireId, positionKey]).toArray()
  }

  async deleteSubtree(repertoireId: string, path: string): Promise<void> {
    const prefix = path ? `${path} ` : ''
    await this.db.nodes
      .where('[repertoireId+path]')
      .between([repertoireId, path], [repertoireId, `${prefix}￿`], true, true)
      .filter((n) => n.path === path || n.path.startsWith(prefix))
      .delete()
  }

  getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined> {
    return this.db.choices.get([repertoireId, positionKey])
  }

  async putChoice(choice: Choice): Promise<void> {
    await this.db.choices.put(choice)
  }

  nodesOf(repertoireId: string): Promise<RepNode[]> {
    return this.db.nodes.where('[repertoireId+path]').between(...all(repertoireId)).toArray()
  }

  choicesOf(repertoireId: string): Promise<Choice[]> {
    return this.db.choices.where('[repertoireId+positionKey]').between(...all(repertoireId)).toArray()
  }

  statsOf(repertoireId: string): Promise<PositionStats[]> {
    return this.db.stats.where('[repertoireId+positionKey]').between(...all(repertoireId)).toArray()
  }

  async loadTree(repertoireId: string): Promise<RepertoireTree> {
    const repertoire = await this.db.repertoires.get(repertoireId)
    if (!repertoire) throw new Error(`Unknown repertoire ${repertoireId}`)
    const [nodes, choices] = await Promise.all([this.nodesOf(repertoireId), this.choicesOf(repertoireId)])
    return buildTree(repertoire.color, nodes, choices)
  }

  async recordStat(repertoireId: string, update: StatUpdate): Promise<void> {
    await this.db.transaction('rw', this.db.stats, async () => {
      const current = await this.db.stats.get([repertoireId, update.positionKey])
      await this.db.stats.put({
        repertoireId,
        positionKey: update.positionKey,
        attempts: (current?.attempts ?? 0) + 1,
        errors: (current?.errors ?? 0) + (update.result === 'ko' ? 1 : 0),
        lastResult: update.result,
        lastSeenAt: Date.now(),
      })
    })
  }

  async summary(repertoireId: string): Promise<{ positions: number; mastered: number }> {
    const [nodes, stats] = await Promise.all([this.nodesOf(repertoireId), this.statsOf(repertoireId)])
    const mine = new Set(nodes.filter((n) => n.side === 'mine').map((n) => n.positionKey))
    const mastered = stats.filter((s) => mine.has(s.positionKey) && s.lastResult === 'ok').length
    return { positions: mine.size, mastered }
  }

  async deleteRepertoire(repertoireId: string): Promise<void> {
    const { db } = this
    await db.transaction('rw', [db.repertoires, db.nodes, db.choices, db.stats], async () => {
      await db.nodes.where('[repertoireId+path]').between(...all(repertoireId)).delete()
      await db.choices.where('[repertoireId+positionKey]').between(...all(repertoireId)).delete()
      await db.stats.where('[repertoireId+positionKey]').between(...all(repertoireId)).delete()
      await db.repertoires.delete(repertoireId)
    })
  }
}
```

In the summary test, the French tree has 3 `mine` positions: after `e4`, after `e4 e6 d4`, and after `e4 e6 d3`. The d4 position ends with `lastResult: 'ok'`, and the stat outside the tree is ignored. That gives `{ positions: 3, mastered: 1 }`.

`apps/web/src/storage/cached-explorer.ts`:
```ts
import {
  type ExplorerFilters,
  type ExplorerResult,
  type ExplorerSource,
  type PositionKey,
  positionKey,
} from '@chess-trainer/core'
import type { TrainerDb } from './db'

export function explorerCacheKey(sourceId: string, key: PositionKey, filters: ExplorerFilters): string {
  const speeds = [...filters.speeds].sort().join(',')
  const ratings = [...filters.ratings].sort((a, b) => a - b).join(',')
  return `${sourceId}|${speeds}|${ratings}|${key}`
}

export class CachedExplorerSource implements ExplorerSource {
  constructor(
    private readonly db: TrainerDb,
    private readonly inner: ExplorerSource,
    private readonly sourceId = 'lichess',
  ) {}

  async query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult> {
    const key = explorerCacheKey(this.sourceId, positionKey(fen), filters)
    const hit = await this.db.explorerCache.get(key)
    if (hit) return hit.result
    const result = await this.inner.query(fen, filters)
    await this.db.explorerCache.put({ key, result, fetchedAt: Date.now() })
    return result
  }

  async peek(fen: string, filters: ExplorerFilters): Promise<ExplorerResult | undefined> {
    const hit = await this.db.explorerCache.get(explorerCacheKey(this.sourceId, positionKey(fen), filters))
    return hit?.result
  }
}
```

`apps/web/src/storage/backup.ts`:
```ts
import type { Choice, PositionStats, RepNode, Repertoire } from '@chess-trainer/core'
import type { TrainerDb } from './db'
import { DexieStore } from './dexie-store'

interface Backup {
  format: 'chess-trainer'
  version: 1
  repertoire: Repertoire
  nodes: RepNode[]
  choices: Choice[]
  stats: PositionStats[]
}

export async function exportBackup(db: TrainerDb, repertoireId: string): Promise<string> {
  const store = new DexieStore(db)
  const repertoire = await db.repertoires.get(repertoireId)
  if (!repertoire) throw new Error(`Unknown repertoire ${repertoireId}`)
  const backup: Backup = {
    format: 'chess-trainer',
    version: 1,
    repertoire,
    nodes: await store.nodesOf(repertoireId),
    choices: await store.choicesOf(repertoireId),
    stats: await store.statsOf(repertoireId),
  }
  return JSON.stringify(backup)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isString = (v: unknown) => typeof v === 'string'
const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

function invalid(reason: string): never {
  throw new Error(`Fichier invalide : ${reason}`)
}

function assertBackup(value: unknown): asserts value is Backup {
  if (!isObject(value) || value.format !== 'chess-trainer' || value.version !== 1) {
    invalid('ce n’est pas une sauvegarde Chess Trainer')
  }
  const { repertoire, nodes, choices, stats } = value
  if (
    !isObject(repertoire) ||
    !isString(repertoire.name) ||
    (repertoire.color !== 'white' && repertoire.color !== 'black') ||
    !Array.isArray(repertoire.rootMoves) ||
    !isObject(repertoire.settings)
  ) {
    invalid('répertoire incomplet')
  }
  if (!Array.isArray(nodes) || !Array.isArray(choices) || !Array.isArray(stats)) invalid('données manquantes')
  for (const n of nodes) {
    if (
      !isObject(n) ||
      !isString(n.path) ||
      !isString(n.positionKey) ||
      !isNumber(n.ply) ||
      !isNumber(n.probability) ||
      (n.side !== 'mine' && n.side !== 'theirs') ||
      typeof n.expanded !== 'boolean'
    ) {
      invalid('nœud mal formé')
    }
  }
  for (const c of choices) {
    if (!isObject(c) || !isString(c.positionKey) || !isString(c.uci)) invalid('coup mal formé')
  }
  for (const s of stats) {
    if (!isObject(s) || !isString(s.positionKey) || !isNumber(s.attempts) || !isNumber(s.errors)) {
      invalid('statistique mal formée')
    }
  }
}

export async function importBackup(
  db: TrainerDb,
  json: string,
  newId: string = crypto.randomUUID(),
): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    invalid('JSON illisible')
  }
  assertBackup(parsed)
  const retag = <T extends { repertoireId: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, repertoireId: newId }))
  const status = parsed.repertoire.status === 'generating' ? 'paused' : parsed.repertoire.status
  const now = Date.now()

  await db.transaction('rw', [db.repertoires, db.nodes, db.choices, db.stats], async () => {
    await db.repertoires.add({ ...parsed.repertoire, id: newId, status, createdAt: now, updatedAt: now })
    await db.nodes.bulkPut(retag(parsed.nodes))
    await db.choices.bulkPut(retag(parsed.choices))
    await db.stats.bulkPut(retag(parsed.stats))
  })
  return newId
}
```

The `FRENCH` fixture has `status: 'generating'`, so the round-trip test expects the imported copy to be `'paused'`.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/web test && pnpm --filter @chess-trainer/web typecheck && pnpm lint`
Expected: PASS. If the typecheck rejects `between(...all(id))`, write both bounds out: `.between([id, Dexie.minKey], [id, Dexie.maxKey])`.

- [ ] **Step 7: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 9: Stockfish engine in a Web Worker

**Files:**
- Create: `apps/web/scripts/copy-stockfish.mjs`
- Modify: `apps/web/package.json` (`dev` and `build` scripts copy Stockfish first)
- Create: `apps/web/src/engine/uci.ts`, `apps/web/src/engine/stockfish-engine.ts`, `apps/web/src/engine/cached-engine.ts`
- Test: `apps/web/src/engine/uci.test.ts`, `apps/web/src/engine/cached-engine.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EngineResult`, `EngineError`, `MATE_SCORE`, `positionKey`, `TrainerDb`, `fakeEngine`.
- Produces:
  - `InfoLine = { depth: number; multipv: number; cp: number; move: Uci }`
  - `parseInfo(line: string): InfoLine | undefined`
  - `class StockfishEngine implements Engine`, with `constructor(depth?: number, url?: string)` and `destroy(): void`
  - `class CachedEngine implements Engine`, with `constructor(db: TrainerDb, inner: () => Engine)`. The inner engine is created lazily, on the first cache miss.
  - `cachedEvals(db: TrainerDb, fen: string): Promise<EngineResult | undefined>`

- [ ] **Step 1: Copy the Stockfish build into `public/`**

`apps/web/scripts/copy-stockfish.mjs`:
```js
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

const source = new URL('../node_modules/stockfish/bin/', import.meta.url)
const target = new URL('../public/stockfish/', import.meta.url)
mkdirSync(target, { recursive: true })
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  const from = new URL(file, source)
  if (!existsSync(from)) throw new Error(`Missing ${from.pathname}: check the stockfish package version`)
  copyFileSync(from, new URL(file, target))
}
console.log('Stockfish copied to public/stockfish')
```

In `apps/web/package.json`, replace the `dev` and `build` scripts. pnpm does not run `pre*` hooks by default, so the copy goes inside the scripts:
```json
"dev": "node scripts/copy-stockfish.mjs && vite",
"build": "node scripts/copy-stockfish.mjs && vite build",
```

Run: `pnpm --filter @chess-trainer/web exec node scripts/copy-stockfish.mjs && ls -la apps/web/public/stockfish`
Expected: two files. The `.wasm` is about 1.8 MB.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/engine/uci.test.ts`:
```ts
import { MATE_SCORE } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { parseInfo } from './uci'

describe('parseInfo', () => {
  it('reads depth, multipv, centipawns and the first pv move', () => {
    expect(
      parseInfo('info depth 16 seldepth 20 multipv 2 score cp -32 nodes 1 nps 1 time 1 pv e7e6 d2d4'),
    ).toEqual({ depth: 16, multipv: 2, cp: -32, move: 'e7e6' })
  })

  it('defaults multipv to 1', () => {
    expect(parseInfo('info depth 10 score cp 15 pv e2e4')?.multipv).toBe(1)
  })

  it('maps mate scores', () => {
    expect(parseInfo('info depth 5 score mate 3 pv d1h5')?.cp).toBe(MATE_SCORE - 3)
    expect(parseInfo('info depth 5 score mate -2 pv g8f6')?.cp).toBe(-(MATE_SCORE - 2))
  })

  it('ignores bounds, lines without score or pv, and other output', () => {
    expect(parseInfo('info depth 12 score cp 20 lowerbound pv e2e4')).toBeUndefined()
    expect(parseInfo('info depth 12 currmove e2e4 currmovenumber 1')).toBeUndefined()
    expect(parseInfo('info depth 0 score mate 0')).toBeUndefined()
    expect(parseInfo('info string NNUE evaluation enabled')).toBeUndefined()
    expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeUndefined()
  })
})
```

`apps/web/src/engine/cached-engine.test.ts`:
```ts
import 'fake-indexeddb/auto'
import { INITIAL_KEY } from '@chess-trainer/core'
import { fakeEngine } from '@chess-trainer/core/testing'
import { describe, expect, it } from 'vitest'
import { TrainerDb } from '../storage/db'
import { CachedEngine, cachedEvals } from './cached-engine'

describe('CachedEngine', () => {
  it('evaluates once and merges new candidates into the cache', async () => {
    const db = new TrainerDb(`test-${crypto.randomUUID()}`)
    const inner = fakeEngine({ '': { e2e4: 30, d2d4: 25, g1f3: 20 } })
    let created = 0
    const engine = new CachedEngine(db, () => {
      created++
      return inner
    })

    await engine.evaluate(INITIAL_KEY, ['e2e4', 'd2d4'])
    await engine.evaluate(`${INITIAL_KEY} 0 1`, ['d2d4'])
    expect(inner.calls).toHaveLength(1)

    await engine.evaluate(INITIAL_KEY, ['g1f3'])
    expect(inner.calls).toHaveLength(2)
    expect((await cachedEvals(db, INITIAL_KEY))?.candidates).toEqual({ e2e4: 30, d2d4: 25, g1f3: 20 })
    expect(created).toBe(1)
  })
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/web test engine`
Expected: FAIL, "Failed to resolve import './uci'".

- [ ] **Step 4: Implement the parser, the worker engine and the cache**

`apps/web/src/engine/uci.ts`:
```ts
import { MATE_SCORE, type Uci } from '@chess-trainer/core'

export interface InfoLine {
  depth: number
  multipv: number
  cp: number
  move: Uci
}

function numberAfter(tokens: string[], name: string): number | undefined {
  const i = tokens.indexOf(name)
  const value = i >= 0 ? Number(tokens[i + 1]) : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

/** Scores are from the side to move. Bound lines are skipped: their score is not exact. */
export function parseInfo(line: string): InfoLine | undefined {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'info' || tokens.includes('lowerbound') || tokens.includes('upperbound')) return
  const depth = numberAfter(tokens, 'depth')
  const scoreAt = tokens.indexOf('score')
  const move = tokens[tokens.indexOf('pv') + 1]
  if (depth === undefined || scoreAt < 0 || !tokens.includes('pv') || !move) return
  const value = Number(tokens[scoreAt + 2])
  if (!Number.isFinite(value)) return
  const kind = tokens[scoreAt + 1]
  const cp =
    kind === 'cp' ? value : kind === 'mate' ? Math.sign(value) * (MATE_SCORE - Math.abs(value)) : undefined
  if (cp === undefined) return
  return { depth, multipv: numberAfter(tokens, 'multipv') ?? 1, cp, move }
}
```

`apps/web/src/engine/stockfish-engine.ts`:
```ts
import { type Engine, EngineError, type EngineResult, type Uci } from '@chess-trainer/core'
import { type InfoLine, parseInfo } from './uci'

const DEFAULT_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`
const INIT_TIMEOUT_MS = 15_000

export class StockfishEngine implements Engine {
  private readonly worker: Worker
  private readonly listeners = new Set<(line: string) => void>()
  private readonly ready: Promise<void>
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly depth = 16,
    url = DEFAULT_URL,
  ) {
    this.worker = new Worker(url)
    this.worker.onmessage = (event: MessageEvent) => {
      for (const listener of [...this.listeners]) listener(String(event.data))
    }
    const failed = new Promise<never>((_, reject) => {
      this.worker.onerror = () => reject(new EngineError('Stockfish failed to load'))
      setTimeout(() => reject(new EngineError('Stockfish did not answer')), INIT_TIMEOUT_MS)
    })
    this.ready = Promise.race([
      this.send('uci', (l) => l === 'uciok').then(() => this.send('isready', (l) => l === 'readyok')),
      failed,
    ])
  }

  evaluate(fen: string, candidates: Uci[]): Promise<EngineResult> {
    const run = this.chain.then(() => this.run(fen, candidates))
    this.chain = run.catch(() => undefined)
    return run
  }

  destroy(): void {
    this.worker.terminate()
  }

  private async run(fen: string, candidates: Uci[]): Promise<EngineResult> {
    await this.ready
    const full = fen.trim().split(/\s+/).length === 4 ? `${fen} 0 1` : fen
    const top = (await this.search(full, [], 1)).get(1)
    if (!top) throw new EngineError(`No legal move in ${fen}`)
    const scores: Record<Uci, number> = {}
    if (candidates.length > 0) {
      for (const info of (await this.search(full, candidates, candidates.length)).values()) {
        scores[info.move] = info.cp
      }
    }
    return { best: { uci: top.move, cp: top.cp }, candidates: scores, depth: this.depth }
  }

  /** With MultiPV 1, `searchmoves` returns only the best move of the subset; MultiPV must equal the subset size. */
  private async search(fen: string, moves: Uci[], multipv: number): Promise<Map<number, InfoLine>> {
    const lines = new Map<number, InfoLine>()
    this.worker.postMessage(`setoption name MultiPV value ${multipv}`)
    this.worker.postMessage(`position fen ${fen}`)
    const go = `go depth ${this.depth}${moves.length ? ` searchmoves ${moves.join(' ')}` : ''}`
    await this.send(
      go,
      (line) => line.startsWith('bestmove'),
      (line) => {
        const info = parseInfo(line)
        if (info) lines.set(info.multipv, info)
      },
    )
    return lines
  }

  private send(command: string, isDone: (line: string) => boolean, onLine?: (line: string) => void): Promise<void> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        onLine?.(line)
        if (!isDone(line)) return
        this.listeners.delete(listener)
        resolve()
      }
      this.listeners.add(listener)
      this.worker.postMessage(command)
    })
  }
}
```

`apps/web/src/engine/cached-engine.ts`:
```ts
import { type Engine, type EngineResult, type Uci, positionKey } from '@chess-trainer/core'
import type { TrainerDb } from '../storage/db'

export async function cachedEvals(db: TrainerDb, fen: string): Promise<EngineResult | undefined> {
  return (await db.engineCache.get(positionKey(fen)))?.result
}

export class CachedEngine implements Engine {
  private engine: Engine | undefined

  constructor(
    private readonly db: TrainerDb,
    private readonly inner: () => Engine,
  ) {}

  async evaluate(fen: string, candidates: Uci[]): Promise<EngineResult> {
    const key = positionKey(fen)
    const hit = await cachedEvals(this.db, key)
    if (hit && candidates.every((c) => c in hit.candidates)) return hit
    this.engine ??= this.inner()
    const fresh = await this.engine.evaluate(key, candidates)
    const merged = { ...fresh, candidates: { ...hit?.candidates, ...fresh.candidates } }
    await this.db.engineCache.put({ positionKey: key, result: merged })
    return merged
  }
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/web test && pnpm --filter @chess-trainer/web typecheck && pnpm lint`
Expected: PASS. `StockfishEngine` has no unit test because it needs a browser Worker. Task 14 checks it in the browser.

- [ ] **Step 6: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 10: Auth token store, generation runner and service wiring

**Files:**
- Create: `apps/web/src/services/auth.ts`, `apps/web/src/services/runner.ts`, `apps/web/src/services/index.ts`
- Test: `apps/web/src/services/runner.test.ts`

**Interfaces:**
- Consumes:
  - core: `runGeneration`, `GenerationProgress`, `Engine`, `ExplorerSource`, `Repertoire`, `RepertoireStatus`, `EngineError`
  - lichess: `LichessAuthError`, `LichessHttpError`, `QueueStatus`, `RequestQueue`, `LichessExplorer`, `buildAuthorizeUrl`, `exchangeCode`, `revokeToken`
  - web: `TrainerDb`, `DexieStore`, `CachedExplorerSource`, `CachedEngine`, `StockfishEngine`
- Produces:
  - `auth.ts`: `getToken(): string | undefined`, `useToken(): string | undefined`, `login(): Promise<void>`, `logout(): Promise<void>`, `completeLoginIfCallback(): Promise<boolean>`
  - `runner.ts`:
    - `RunnerState = { activeId?: string; progress?: GenerationProgress; queue: QueueStatus; message?: string; messageFor?: string }`
    - `RunnerDeps = { db: TrainerDb; store: DexieStore; explorer: ExplorerSource; engine: () => Engine }`
    - `class GenerationRunner`:
      - methods: `subscribe`, `getState`, `setQueueStatus`, `start(id)`, `pause(id)`, `kick(): Promise<void>`
      - `useRunner(runner): RunnerState`
  - `services/index.ts`: `db`, `store`, `explorer`, `runner`

- [ ] **Step 1: Write the failing runner tests**

`apps/web/src/services/runner.test.ts`:
```ts
import 'fake-indexeddb/auto'
import { type ExplorerSource, initRepertoire } from '@chess-trainer/core'
import { FRENCH, frenchEngine, frenchExplorer } from '@chess-trainer/core/testing'
import { LichessAuthError } from '@chess-trainer/lichess'
import { describe, expect, it } from 'vitest'
import { TrainerDb } from '../storage/db'
import { DexieStore } from '../storage/dexie-store'
import { GenerationRunner } from './runner'

async function setup(explorer: ExplorerSource = frenchExplorer()) {
  const db = new TrainerDb(`test-${crypto.randomUUID()}`)
  const store = new DexieStore(db)
  await db.repertoires.put(FRENCH)
  await initRepertoire(FRENCH, store)
  const runner = new GenerationRunner({ db, store, explorer, engine: frenchEngine })
  return { db, store, runner }
}

const failing = (error: unknown): ExplorerSource => ({ query: () => Promise.reject(error) })

describe('GenerationRunner', () => {
  it('generates pending repertoires and marks them ready', async () => {
    const { db, store, runner } = await setup()
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('ready')
    expect(await store.getNode('french', 'e2e4 e7e6 d2d4 d7d5')).toBeDefined()
    expect(runner.getState().activeId).toBeUndefined()
  })

  it('keeps the status on auth errors so the run resumes after login', async () => {
    const { db, runner } = await setup(failing(new LichessAuthError('no token')))
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('generating')
    expect(runner.getState()).toMatchObject({ messageFor: 'french' })
    expect(runner.getState().message).toMatch(/Lichess/)
  })

  it('pauses on network errors', async () => {
    const { db, runner } = await setup(failing(new TypeError('offline')))
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('paused')
  })

  it('pauses the active run on request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = frenchExplorer()
    const slow: ExplorerSource = {
      query: async (fen, filters) => {
        await gate
        return inner.query(fen, filters)
      },
    }
    const { db, runner } = await setup(slow)
    const active = new Promise<void>((resolve) => {
      const off = runner.subscribe(() => {
        if (runner.getState().activeId !== 'french') return
        off()
        resolve()
      })
    })
    const done = runner.kick()
    await active
    const paused = runner.pause('french')
    release()
    await paused
    await done
    expect((await db.repertoires.get('french'))?.status).toBe('paused')
  })

  it('runs queued repertoires one after the other', async () => {
    const { db, runner } = await setup()
    const second = { ...FRENCH, id: 'second', createdAt: 1 }
    await db.repertoires.put(second)
    await initRepertoire(second, new DexieStore(db))
    await runner.kick()
    expect((await db.repertoires.get('french'))?.status).toBe('ready')
    expect((await db.repertoires.get('second'))?.status).toBe('ready')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/web test runner`
Expected: FAIL, "Failed to resolve import './runner'".

- [ ] **Step 3: Implement the runner**

`apps/web/src/services/runner.ts`:
```ts
import {
  type Engine,
  EngineError,
  type ExplorerSource,
  type GenerationProgress,
  type RepertoireStatus,
  runGeneration,
} from '@chess-trainer/core'
import { LichessAuthError, LichessHttpError, type QueueStatus } from '@chess-trainer/lichess'
import { useSyncExternalStore } from 'react'
import type { TrainerDb } from '../storage/db'
import type { DexieStore } from '../storage/dexie-store'

export interface RunnerState {
  activeId?: string
  progress?: GenerationProgress
  queue: QueueStatus
  message?: string
  messageFor?: string
}

export interface RunnerDeps {
  db: TrainerDb
  store: DexieStore
  explorer: ExplorerSource
  engine: () => Engine
}

function outcomeOf(error: unknown): { status: RepertoireStatus; message: string } {
  if (error instanceof LichessAuthError) {
    return { status: 'generating', message: 'Connecte-toi à Lichess pour continuer la génération.' }
  }
  if (error instanceof EngineError) {
    return { status: 'error', message: 'Le moteur Stockfish n’a pas pu démarrer dans ce navigateur.' }
  }
  if (error instanceof LichessHttpError) {
    return { status: 'paused', message: `Lichess a répondu ${error.status}. Réessaie plus tard.` }
  }
  return { status: 'paused', message: 'Réseau indisponible. Reprends la génération une fois en ligne.' }
}

/** Generates repertoires with status 'generating' one at a time, oldest first. */
export class GenerationRunner {
  private state: RunnerState = { queue: { kind: 'idle' } }
  private readonly listeners = new Set<() => void>()
  private controller: AbortController | undefined
  private current: Promise<unknown> | undefined
  private loop: Promise<void> | undefined
  private rekick = false

  constructor(private readonly deps: RunnerDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  setQueueStatus(queue: QueueStatus): void {
    this.update({ queue })
  }

  async start(id: string): Promise<void> {
    await this.setStatus(id, 'generating')
    void this.kick()
  }

  /** Resolves once no node of this repertoire can be written anymore. */
  async pause(id: string): Promise<void> {
    if (this.state.activeId !== id) return this.setStatus(id, 'paused')
    this.controller?.abort()
    await this.current
  }

  kick(): Promise<void> {
    this.rekick = true
    this.loop ??= this.drain().finally(() => {
      this.loop = undefined
      if (this.rekick) void this.kick()
    })
    return this.loop
  }

  private async drain(): Promise<void> {
    for (;;) {
      this.rekick = false
      const [next] = await this.deps.db.repertoires.where('status').equals('generating').sortBy('createdAt')
      if (!next) return
      const controller = new AbortController()
      this.controller = controller
      this.update({ activeId: next.id, progress: undefined, message: undefined, messageFor: undefined })
      try {
        const run = runGeneration({
          repertoire: next,
          store: this.deps.store,
          explorer: this.deps.explorer,
          engine: this.deps.engine(),
          signal: controller.signal,
          onProgress: (progress) => this.update({ progress }),
        })
        this.current = run.catch(() => undefined)
        const outcome = await run
        await this.setStatus(next.id, outcome === 'done' ? 'ready' : 'paused')
      } catch (error) {
        const { status, message } = outcomeOf(error)
        await this.setStatus(next.id, status)
        this.update({ message, messageFor: next.id })
        return
      } finally {
        this.controller = undefined
        this.current = undefined
        this.update({ activeId: undefined })
      }
    }
  }

  private async setStatus(id: string, status: RepertoireStatus): Promise<void> {
    await this.deps.db.repertoires.update(id, { status, updatedAt: Date.now() })
  }

  private update(patch: Partial<RunnerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

export function useRunner(runner: GenerationRunner): RunnerState {
  return useSyncExternalStore(runner.subscribe, runner.getState)
}
```

A failed run ends `drain()` with `return`, so `rekick` stays false and the failing repertoire is not retried in a loop. A later `start()`, a login or a page load calls `kick()` again.

- [ ] **Step 4: Implement auth and the service wiring**

`apps/web/src/services/auth.ts`:
```ts
import { buildAuthorizeUrl, exchangeCode, revokeToken } from '@chess-trainer/lichess'
import { useSyncExternalStore } from 'react'

const TOKEN_KEY = 'chess-trainer.lichess-token'
const listeners = new Set<() => void>()

export function getToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function setToken(token: string | undefined): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  for (const listener of listeners) listener()
}

export function useToken(): string | undefined {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, getToken)
}

/** Must be identical in the authorize request and the token exchange. */
const redirectUri = () => `${location.origin}${location.pathname}`

export async function login(): Promise<void> {
  location.assign(await buildAuthorizeUrl(redirectUri()))
}

export async function logout(): Promise<void> {
  const token = getToken()
  setToken(undefined)
  if (token) await revokeToken(token).catch(() => undefined)
}

export async function completeLoginIfCallback(): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  if (!params.has('code') && !params.has('error')) return false
  try {
    setToken(await exchangeCode(location.href, redirectUri()))
  } finally {
    history.replaceState(null, '', `${location.pathname}#/`)
  }
  return true
}
```

`apps/web/src/services/index.ts`:
```ts
import { LichessExplorer, RequestQueue } from '@chess-trainer/lichess'
import { CachedEngine } from '../engine/cached-engine'
import { StockfishEngine } from '../engine/stockfish-engine'
import { CachedExplorerSource } from '../storage/cached-explorer'
import { TrainerDb } from '../storage/db'
import { DexieStore } from '../storage/dexie-store'
import { getToken } from './auth'
import { GenerationRunner } from './runner'

export const db = new TrainerDb()
export const store = new DexieStore(db)

const queue = new RequestQueue((url, init) => fetch(url, init), {
  onStatus: (status) => runner.setQueueStatus(status),
})
export const explorer = new CachedExplorerSource(db, new LichessExplorer(queue, getToken))

const engine = new CachedEngine(db, () => new StockfishEngine())
export const runner = new GenerationRunner({ db, store, explorer, engine: () => engine })
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @chess-trainer/web test && pnpm --filter @chess-trainer/web typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 11: App shell, board, stats panel and home screen

**Files:**
- Modify: `apps/web/src/main.tsx` (replace the placeholder)
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/ui/styles.ts`, `apps/web/src/ui/format.ts`, `apps/web/src/ui/paths.ts`, `apps/web/src/ui/hooks.ts`
- Create: `apps/web/src/ui/board.tsx`, `apps/web/src/ui/stats-panel.tsx`, `apps/web/src/ui/layout.tsx`
- Create: `apps/web/src/screens/home.tsx`, `apps/web/src/screens/placeholders.tsx` (temporary routes, removed in Task 15)
- Test: `apps/web/src/ui/format.test.ts`, `apps/web/src/ui/paths.test.ts`

**Interfaces:**
- Consumes:
  - services: `db`, `store`, `explorer`, `runner`, `useRunner`, `useToken`, `login`, `logout`, `getToken`, `completeLoginIfCallback`
  - storage: `exportBackup`, `importBackup`
  - core: `exportPgn`, `positionFromFen`, `toStandardUci`, `MATE_SCORE`
- Produces:
  - Styles: `button`, `primaryButton`, `card`
  - Format:
    - `pct(x)`, `formatEval(cp, turn)`, `formatLine(sans)`, `ratingLabel(r)`, `slug(name)`, `downloadFile(name, content, type)`
    - Constants: `RATING_BUCKETS`, `SPEED_LABELS`, `STATUS_LABELS`, `LEAF_LABELS`
  - Paths: `pathToParam(path)`, `parsePathParam(param): string | undefined`, `exploreHref(id, path)`, `drillHref(id, path)`
  - Hooks: `useRepertoire(id): Repertoire | null | undefined` (`null` = not found, `undefined` = loading) and `useNow(intervalMs): number`
  - Components:
    - `<Board positionKey orientation lastMove? movable arrows? version? onMove? />` and the `Arrow` type
    - `<StatsPanel positionKey stats? evals? highlight onSelect? />`
    - `<Layout>`, `<App>`, `<HomeScreen>`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/ui/paths.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { drillHref, exploreHref, parsePathParam, pathToParam } from './paths'

describe('paths in URLs', () => {
  it('round-trips a move path', () => {
    expect(pathToParam('e2e4 e7e6')).toBe('e2e4-e7e6')
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
```

`apps/web/src/ui/format.test.ts`:
```ts
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
    expect(pct(0.7)).toBe('70 %')
    expect(pct(0.012)).toBe('1.2 %')
    expect(ratingLabel(1600)).toBe('1600–1799')
    expect(ratingLabel(2500)).toBe('2500+')
    expect(slug('French Defense: Winawer, Réti')).toBe('french-defense-winawer-reti')
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @chess-trainer/web test ui`
Expected: FAIL, "Failed to resolve import './paths'".

- [ ] **Step 3: Implement the UI helpers**

`apps/web/src/ui/styles.ts`:
```ts
export const button =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-50'

export const card =
  'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
```

`apps/web/src/ui/format.ts`:
```ts
import { type Color, type LeafReason, MATE_SCORE, type RepertoireStatus, type Speed } from '@chess-trainer/core'

export function pct(x: number): string {
  const value = x * 100
  return `${x < 0.1 ? value.toFixed(1) : Math.round(value)} %`
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
  ultraBullet: 'Ultrabullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapide',
  classical: 'Classique',
  correspondence: 'Correspondance',
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
```

`apps/web/src/ui/paths.ts`:
```ts
import { keyAfter, pathMoves } from '@chess-trainer/core'

export function pathToParam(path: string): string {
  return path.split(' ').join('-')
}

/** Returns undefined when the URL holds an illegal move sequence. */
export function parsePathParam(param: string | undefined): string | undefined {
  const path = param ? param.split('-').join(' ') : ''
  try {
    keyAfter(pathMoves(path))
    return path
  } catch {
    return undefined
  }
}

export const exploreHref = (id: string, path: string) =>
  path ? `/r/${id}/explore/${pathToParam(path)}` : `/r/${id}/explore`

export const drillHref = (id: string, path: string) =>
  path ? `/r/${id}/drill/${pathToParam(path)}` : `/r/${id}/drill`
```

`apps/web/src/ui/hooks.ts`:
```ts
import type { Repertoire } from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../services'

export function useRepertoire(id: string): Repertoire | null | undefined {
  return useLiveQuery(async () => (await db.repertoires.get(id)) ?? null, [id])
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm --filter @chess-trainer/web test ui`
Expected: PASS.

- [ ] **Step 5: Implement the board and the stats panel**

`apps/web/src/ui/board.tsx`:
```tsx
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'
import { type Color, type PositionKey, type Uci, positionFromFen } from '@chess-trainer/core'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Key } from '@lichess-org/chessground/types'
import { chessgroundDests } from 'chessops/compat'
import { parseSquare } from 'chessops/util'
import { useEffect, useRef } from 'react'

export interface Arrow {
  from: string
  to: string
  brush: 'green' | 'red' | 'blue'
}

interface BoardProps {
  positionKey: PositionKey
  orientation: Color
  lastMove?: Uci
  movable: boolean
  arrows?: Arrow[]
  /** Bump to redraw the same position, e.g. to take back a wrong move the user dropped. */
  version?: number
  onMove?: (uci: Uci) => void
}

const NO_ARROWS: Arrow[] = []

/** Chessground gives no promotion piece; openings almost never promote, so the board picks a queen. */
function withPromotion(key: PositionKey, uci: Uci): Uci {
  const from = parseSquare(uci.slice(0, 2))
  const to = parseSquare(uci.slice(2, 4))
  if (from === undefined || to === undefined) return uci
  const isPawn = positionFromFen(key).board.get(from)?.role === 'pawn'
  const lastRank = to >> 3 === 0 || to >> 3 === 7
  return isPawn && lastRank ? `${uci}q` : uci
}

export function Board({
  positionKey,
  orientation,
  lastMove,
  movable,
  arrows = NO_ARROWS,
  version = 0,
  onMove,
}: BoardProps) {
  const element = useRef<HTMLDivElement>(null)
  const api = useRef<Api | undefined>(undefined)
  const latest = useRef({ positionKey, onMove })
  latest.current = { positionKey, onMove }

  useEffect(() => {
    if (!element.current) return
    api.current = Chessground(element.current, {
      animation: { duration: 200 },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const { positionKey: key, onMove: handler } = latest.current
            handler?.(withPromotion(key, `${orig}${dest}`))
          },
        },
      },
    })
    return () => api.current?.destroy()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces a redraw of the same position
  useEffect(() => {
    const pos = positionFromFen(positionKey)
    api.current?.set({
      fen: positionKey,
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
      movable: {
        color: movable ? pos.turn : undefined,
        dests: movable ? chessgroundDests(pos) : new Map(),
      },
      drawable: {
        autoShapes: arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush })),
      },
    })
  }, [positionKey, orientation, lastMove, movable, arrows, version])

  return <div ref={element} className="aspect-square w-full" />
}
```

`apps/web/src/ui/stats-panel.tsx`:
```tsx
import {
  type ExplorerResult,
  type PositionKey,
  type Uci,
  positionFromFen,
  toStandardUci,
} from '@chess-trainer/core'
import { formatEval, pct } from './format'

interface StatsPanelProps {
  positionKey: PositionKey
  stats?: ExplorerResult
  evals?: Record<Uci, number>
  highlight: ReadonlySet<Uci>
  onSelect?: (uci: Uci) => void
}

function ResultBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-sm border border-neutral-300 dark:border-neutral-700"
      title={`Blancs ${pct(white / total)}, nulles ${pct(draws / total)}, Noirs ${pct(black / total)}`}
    >
      <div className="bg-neutral-100" style={{ width: `${(white / total) * 100}%` }} />
      <div className="bg-neutral-400" style={{ width: `${(draws / total) * 100}%` }} />
      <div className="bg-neutral-800" style={{ width: `${(black / total) * 100}%` }} />
    </div>
  )
}

export function StatsPanel({ positionKey, stats, evals, highlight, onSelect }: StatsPanelProps) {
  if (!stats) {
    return <p className="text-sm text-neutral-500">Pas de statistiques en cache pour cette position.</p>
  }
  const pos = positionFromFen(positionKey)
  const total = stats.white + stats.draws + stats.black
  const rows = stats.moves.map((m) => ({
    ...m,
    uci: toStandardUci(pos, m.uci) ?? m.uci,
    games: m.white + m.draws + m.black,
  }))

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-neutral-500">
        <tr>
          <th className="py-1 font-medium">Coup</th>
          <th className="py-1 font-medium">Parties</th>
          <th className="w-1/3 py-1 font-medium">Résultats</th>
          <th className="py-1 text-right font-medium">Éval</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const cp = evals?.[m.uci]
          const mine = highlight.has(m.uci)
          return (
            <tr key={m.uci} className={mine ? 'bg-emerald-50 dark:bg-emerald-950' : undefined}>
              <td className="py-1">
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => onSelect?.(m.uci)}
                  disabled={!onSelect}
                >
                  {m.san}
                  {mine && <span className="sr-only"> (dans le répertoire)</span>}
                  {mine && <span aria-hidden="true"> ★</span>}
                </button>
              </td>
              <td className="py-1 tabular-nums">{pct(total ? m.games / total : 0)}</td>
              <td className="py-1">
                <ResultBar white={m.white} draws={m.draws} black={m.black} />
              </td>
              <td className="py-1 text-right tabular-nums">{cp === undefined ? '' : formatEval(cp, pos.turn)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 6: Implement the shell and the home screen**

`apps/web/src/ui/layout.tsx`:
```tsx
import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { runner } from '../services'
import { login, logout, useToken } from '../services/auth'
import { useRunner } from '../services/runner'
import { button } from './styles'

export function Layout({ children }: { children: ReactNode }) {
  const token = useToken()
  const state = useRunner(runner)
  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="font-semibold">
            Chess Trainer
          </Link>
          {token ? (
            <button type="button" className={button} onClick={() => void logout()}>
              Se déconnecter de Lichess
            </button>
          ) : (
            <button type="button" className={button} onClick={() => void login()}>
              Se connecter avec Lichess
            </button>
          )}
        </div>
        {state.activeId && state.progress && (
          <p className="bg-emerald-50 px-4 py-2 text-center text-sm dark:bg-emerald-950">
            <Link href={`/r/${state.activeId}/generation`} className="underline">
              Génération en cours : {state.progress.expanded} positions traitées, {state.progress.pending} en
              attente
            </Link>
          </p>
        )}
        {state.message && (
          <p role="alert" className="bg-amber-50 px-4 py-2 text-center text-sm dark:bg-amber-950">
            {state.message}
          </p>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
```

`apps/web/src/screens/home.tsx`:
```tsx
import { type Repertoire, exportPgn } from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation } from 'wouter'
import { db, runner, store } from '../services'
import { exportBackup, importBackup } from '../storage/backup'
import { STATUS_LABELS, downloadFile, slug } from '../ui/format'
import { drillHref, exploreHref } from '../ui/paths'
import { button, card, primaryButton } from '../ui/styles'

function RepertoireCard({ repertoire }: { repertoire: Repertoire }) {
  const { id, name } = repertoire
  const summary = useLiveQuery(() => store.summary(id), [id])

  async function exportJson() {
    downloadFile(`${slug(name)}.json`, await exportBackup(db, id), 'application/json')
  }

  async function exportPgnFile() {
    downloadFile(`${slug(name)}.pgn`, exportPgn(await store.loadTree(id), name), 'application/x-chess-pgn')
  }

  async function remove() {
    if (!confirm(`Supprimer « ${name} » ? Cette action est définitive.`)) return
    await runner.pause(id)
    await store.deleteRepertoire(id)
  }

  return (
    <li className={card}>
      <h2 className="font-semibold">{name}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {repertoire.color === 'white' ? 'Avec les Blancs' : 'Avec les Noirs'} · {STATUS_LABELS[repertoire.status]}
      </p>
      <p className="mt-2 text-sm">
        {summary ? `${summary.positions} positions à connaître, ${summary.mastered} réussies au dernier essai` : '…'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={drillHref(id, '')} className={primaryButton}>
          Entraîner
        </Link>
        <Link href={exploreHref(id, '')} className={button}>
          Explorer
        </Link>
        <Link href={`/r/${id}/stats`} className={button}>
          Stats
        </Link>
        {repertoire.status !== 'ready' && (
          <Link href={`/r/${id}/generation`} className={button}>
            Génération
          </Link>
        )}
        <button type="button" className={button} onClick={() => void exportJson()}>
          Exporter en JSON
        </button>
        <button type="button" className={button} onClick={() => void exportPgnFile()}>
          Exporter en PGN
        </button>
        <button type="button" className={button} onClick={() => void remove()}>
          Supprimer
        </button>
      </div>
    </li>
  )
}

export function HomeScreen() {
  const repertoires = useLiveQuery(() => db.repertoires.orderBy('createdAt').reverse().toArray(), [])
  const [, navigate] = useLocation()

  async function onImport(file: File) {
    try {
      navigate(exploreHref(await importBackup(db, await file.text()), ''))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mes répertoires</h1>
        <div className="flex gap-2">
          <label className={`${button} cursor-pointer`}>
            Importer un fichier JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onImport(file)
                event.target.value = ''
              }}
            />
          </label>
          <Link href="/new" className={primaryButton}>
            Nouveau répertoire
          </Link>
        </div>
      </div>
      {repertoires?.length === 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">
          Aucun répertoire pour l’instant. Crée le premier à partir d’une ouverture.
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {repertoires?.map((r) => (
          <RepertoireCard key={r.id} repertoire={r} />
        ))}
      </ul>
    </section>
  )
}
```

`apps/web/src/screens/placeholders.tsx` (routes filled by Tasks 12–15, deleted in Task 15):
```tsx
export function ComingSoon() {
  return <p>Écran à venir.</p>
}
```

`apps/web/src/app.tsx`:
```tsx
import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { HomeScreen } from './screens/home'
import { ComingSoon } from './screens/placeholders'
import { Layout } from './ui/layout'

export function App() {
  return (
    <Router hook={useHashLocation}>
      <Layout>
        <Switch>
          <Route path="/" component={HomeScreen} />
          <Route path="/new" component={ComingSoon} />
          <Route path="/r/:id/generation" component={ComingSoon} />
          <Route path="/r/:id/explore/:moves?" component={ComingSoon} />
          <Route path="/r/:id/drill/:moves?" component={ComingSoon} />
          <Route path="/r/:id/stats" component={ComingSoon} />
          <Route>
            <p>Page introuvable.</p>
          </Route>
        </Switch>
      </Layout>
    </Router>
  )
}
```

Use the context7 MCP to check that `<Link>` renders `href="#/…"` under `useHashLocation` in wouter 3.11. If it renders `/…`, add `hrefs={(href) => `#${href}`}` to `<Router>`.

`apps/web/src/main.tsx`:
```tsx
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { runner } from './services'
import { completeLoginIfCallback, getToken } from './services/auth'

async function boot() {
  try {
    await completeLoginIfCallback()
  } catch (error) {
    console.error(error)
    alert('La connexion à Lichess a échoué. Réessaie depuis le bouton « Se connecter avec Lichess ».')
  }
  if (getToken()) void runner.kick()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
```

- [ ] **Step 7: Typecheck, lint, test and build**

Run: `pnpm --filter @chess-trainer/web typecheck && pnpm lint && pnpm --filter @chess-trainer/web test && pnpm --filter @chess-trainer/web build`
Expected: PASS. The build writes `apps/web/dist`.

- [ ] **Step 8: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 12: New repertoire and generation screens

**Files:**
- Create: `apps/web/src/screens/new-repertoire.tsx`, `apps/web/src/screens/generation.tsx`
- Modify: `apps/web/src/app.tsx` (routes `/new` and `/r/:id/generation`)

**Interfaces:**
- Consumes:
  - core: `initRepertoire`, `searchOpenings`, `sanLine`, `DEFAULT_SETTINGS`
  - web: `OPENINGS`, `db`, `store`, `runner`, `useRunner`, `useToken`, `login`, `useRepertoire`, `useNow`
  - format: `RATING_BUCKETS`, `ratingLabel`, `SPEED_LABELS`, `STATUS_LABELS`, `formatLine`
  - styles, `drillHref`, `exploreHref`
- Produces: `<NewRepertoireScreen>` and `<GenerationScreen>`.

- [ ] **Step 1: Implement the new repertoire screen**

The screen saves the repertoire with status `'paused'`, writes the prefix, then calls `runner.start(id)`. If the status were `'generating'` before the prefix exists, a running generation loop could pick the repertoire up with no node and mark it `'ready'`.

`apps/web/src/screens/new-repertoire.tsx`:
```tsx
import {
  type Color,
  DEFAULT_SETTINGS,
  type Opening,
  type Repertoire,
  type Settings,
  type Speed,
  initRepertoire,
  sanLine,
  searchOpenings,
} from '@chess-trainer/core'
import { useId, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { OPENINGS } from '../data/openings'
import { db, runner, store } from '../services'
import { login, useToken } from '../services/auth'
import { RATING_BUCKETS, SPEED_LABELS, formatLine, ratingLabel } from '../ui/format'
import { button, card, primaryButton } from '../ui/styles'

const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical']

const toggle = <T,>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

function NumberField(props: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        className="w-32 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(event) => {
          const value = Number(event.target.value)
          if (Number.isFinite(value)) props.onChange(Math.min(props.max, Math.max(props.min, value)))
        }}
      />
      {props.hint && <p className="text-xs text-neutral-500">{props.hint}</p>}
    </div>
  )
}

export function NewRepertoireScreen() {
  const token = useToken()
  const [, navigate] = useLocation()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<Opening>()
  const [color, setColor] = useState<Color>('black')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(false)
  const results = useMemo(() => searchOpenings(OPENINGS, query), [query])
  const valid = !!opening && settings.ratings.length > 0 && settings.speeds.length > 0
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  function choose(o: Opening) {
    setOpening(o)
    setColor(o.moves.length % 2 === 1 ? 'white' : 'black')
    set({ maxPly: Math.max(DEFAULT_SETTINGS.maxPly, o.moves.length + 2) })
  }

  async function create() {
    if (!opening || !valid) return
    setBusy(true)
    const now = Date.now()
    const repertoire: Repertoire = {
      id: crypto.randomUUID(),
      name: opening.name,
      color,
      rootMoves: opening.moves,
      settings,
      status: 'paused',
      createdAt: now,
      updatedAt: now,
    }
    await db.repertoires.add(repertoire)
    await initRepertoire(repertoire, store)
    await runner.start(repertoire.id)
    navigate(`/r/${repertoire.id}/generation`)
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Nouveau répertoire</h1>

      <div className={`${card} space-y-3`}>
        <label htmlFor={searchId} className="block font-medium">
          Ouverture
        </label>
        <input
          id={searchId}
          type="search"
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          placeholder="ex. French Defense, Sicilian, C00"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {results.length > 0 && (
          <ul className="max-h-72 divide-y divide-neutral-200 overflow-y-auto dark:divide-neutral-800">
            {results.map((o) => (
              <li key={`${o.eco}-${o.name}-${o.moves.join('')}`}>
                <button
                  type="button"
                  className="w-full px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onClick={() => choose(o)}
                >
                  <span className="font-medium">
                    {o.eco} · {o.name}
                  </span>
                  <span className="block text-sm text-neutral-500">{formatLine(sanLine(o.moves))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {opening && (
        <div className={`${card} space-y-5`}>
          <div>
            <h2 className="font-semibold">{opening.name}</h2>
            <p className="text-sm text-neutral-500">{formatLine(sanLine(opening.moves))}</p>
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Je joue avec</legend>
            {(['white', 'black'] as const).map((c) => (
              <label key={c} className="mr-4 inline-flex items-center gap-2 text-sm">
                <input type="radio" name="color" checked={color === c} onChange={() => setColor(c)} />
                {c === 'white' ? 'les Blancs' : 'les Noirs'}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Niveau des parties (Elo Lichess)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {RATING_BUCKETS.map((r) => (
                <label key={r} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.ratings.includes(r)}
                    onChange={() => set({ ratings: toggle(settings.ratings, r) })}
                  />
                  {ratingLabel(r)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Cadences</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {SPEEDS.map((s) => (
                <label key={s} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.speeds.includes(s)}
                    onChange={() => set({ speeds: toggle(settings.speeds, s) })}
                  />
                  {SPEED_LABELS[s]}
                </label>
              ))}
            </div>
          </fieldset>

          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">Réglages avancés</summary>
            <div className="grid gap-4 pt-3 sm:grid-cols-2">
              <NumberField
                label="Probabilité minimale d’une ligne (%)"
                hint="1 % donne environ 100 lignes. Plus bas : répertoire plus complet, génération plus longue."
                value={Math.round(settings.minLineProbability * 1000) / 10}
                min={0.1}
                max={20}
                step={0.1}
                onChange={(v) => set({ minLineProbability: v / 100 })}
              />
              <NumberField
                label="Tolérance du moteur (centipions)"
                hint="Écart accepté avec le meilleur coup pour garder le coup le plus joué."
                value={settings.engineToleranceCp}
                min={0}
                max={200}
                onChange={(v) => set({ engineToleranceCp: v })}
              />
              <NumberField
                label="Parties minimum par position"
                value={settings.minGames}
                min={1}
                max={10_000}
                onChange={(v) => set({ minGames: v })}
              />
              <NumberField
                label="Profondeur maximale (demi-coups)"
                hint="L’explorateur Lichess s’arrête à 50."
                value={settings.maxPly}
                min={opening.moves.length + 2}
                max={50}
                onChange={(v) => set({ maxPly: v })}
              />
            </div>
          </details>

          {token ? (
            <button type="button" className={primaryButton} disabled={!valid || busy} onClick={() => void create()}>
              Générer le répertoire
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">La génération lit les statistiques de Lichess : connecte-toi d’abord.</p>
              <button type="button" className={button} onClick={() => void login()}>
                Se connecter avec Lichess
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Implement the generation screen**

`apps/web/src/screens/generation.tsx`:
```tsx
import { useLiveQuery } from 'dexie-react-hooks'
import Dexie from 'dexie'
import { Link, useParams } from 'wouter'
import { db, runner } from '../services'
import { login, useToken } from '../services/auth'
import { useRunner } from '../services/runner'
import { STATUS_LABELS } from '../ui/format'
import { useNow, useRepertoire } from '../ui/hooks'
import { drillHref, exploreHref } from '../ui/paths'
import { button, card, primaryButton } from '../ui/styles'

const SECONDS_PER_REQUEST = 2.4

export function GenerationScreen() {
  const { id } = useParams<{ id: string }>()
  const repertoire = useRepertoire(id)
  const nodeCount = useLiveQuery(
    () => db.nodes.where('[repertoireId+path]').between([id, Dexie.minKey], [id, Dexie.maxKey]).count(),
    [id],
  )
  const state = useRunner(runner)
  const token = useToken()
  const now = useNow(1000)

  if (repertoire === undefined) return <p>Chargement…</p>
  if (repertoire === null) return <p>Répertoire introuvable.</p>

  const active = state.activeId === id
  const progress = active ? state.progress : undefined
  const message = state.messageFor === id ? state.message : undefined
  const waitSeconds =
    active && state.queue.kind === 'waiting' ? Math.max(0, Math.ceil((state.queue.until - now) / 1000)) : 0
  const done = progress ? progress.expanded / (progress.expanded + progress.pending) : 0

  return (
    <section className={`${card} max-w-2xl space-y-4`}>
      <h1 className="text-2xl font-semibold">{repertoire.name}</h1>
      <p>
        Statut : {STATUS_LABELS[repertoire.status]}
        {repertoire.status === 'generating' && !active && ' (en file d’attente)'}
      </p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{nodeCount ?? 0} positions dans l’arbre.</p>

      {progress && (
        <div className="space-y-2">
          <div
            className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-valuenow={Math.round(done * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progression de la génération"
          >
            <div className="h-full bg-emerald-600" style={{ width: `${done * 100}%` }} />
          </div>
          <p className="text-sm">
            {progress.expanded} positions traitées, {progress.pending} en attente. Encore{' '}
            {Math.ceil((progress.pending * SECONDS_PER_REQUEST) / 60)} min au plus : les positions déjà en cache vont
            plus vite.
          </p>
        </div>
      )}

      {waitSeconds > 0 && state.queue.kind === 'waiting' && (
        <p className="text-sm">
          {state.queue.reason === 'rateLimit' ? 'Limite de Lichess atteinte' : 'Lichess ne répond pas'}, reprise dans{' '}
          {waitSeconds} s.
        </p>
      )}
      {message && (
        <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!token && (
          <button type="button" className={primaryButton} onClick={() => void login()}>
            Se connecter avec Lichess
          </button>
        )}
        {repertoire.status === 'generating' && (
          <button type="button" className={button} onClick={() => void runner.pause(id)}>
            Mettre en pause
          </button>
        )}
        {(repertoire.status === 'paused' || repertoire.status === 'error') && (
          <button type="button" className={primaryButton} onClick={() => void runner.start(id)}>
            Reprendre
          </button>
        )}
        {repertoire.status === 'ready' && (
          <Link href={drillHref(id, '')} className={primaryButton}>
            S’entraîner
          </Link>
        )}
        <Link href={exploreHref(id, '')} className={button}>
          Explorer l’arbre
        </Link>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Wire the routes**

In `apps/web/src/app.tsx`, import `NewRepertoireScreen` and `GenerationScreen`, then replace `ComingSoon` on `/new` and `/r/:id/generation`.

- [ ] **Step 4: Typecheck, lint and build**

Run: `pnpm --filter @chess-trainer/web typecheck && pnpm lint && pnpm --filter @chess-trainer/web build`
Expected: PASS.

- [ ] **Step 5: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 13: Explorer and edit screen

**Files:**
- Create: `apps/web/src/screens/explore.tsx`
- Modify: `apps/web/src/app.tsx` (route `/r/:id/explore/:moves?`)

**Interfaces:**
- Consumes:
  - core: `addReply`, `changeChoice`, `removeReply`, `childMoves`, `childPath`, `parentPath`, `pathMoves`, `keyAfter`, `filtersOf`, `findOpening`, `sanLine`, `positionFromFen`, `toStandardUci`, `uciToSan`, `RepertoireTree`, `Repertoire`
  - lichess: `LichessAuthError`
  - web: `explorer.peek`, `explorer.query`, `cachedEvals`, `db`, `store`, `runner`, `Board`, `StatsPanel`, `useRepertoire`, `parsePathParam`, `exploreHref`, `drillHref`, `LEAF_LABELS`, `pct`, styles
- Produces: `<ExploreScreen>`.

- [ ] **Step 1: Implement the screen**

The move handler covers five cases:
- A move already in the tree: navigate to it.
- A position inside the chosen opening's prefix: refuse. Prefix moves are fixed on both sides.
- My turn: confirm, then `changeChoice`.
- Opponent turn: confirm, then `addReply` with the share from the cached stats (0 when unknown).
- A position outside the tree: navigate freely, no edit.

After an edit, `runner.start(id)` expands the new nodes.

`apps/web/src/screens/explore.tsx`:
```tsx
import {
  type Repertoire,
  type RepertoireTree,
  type Uci,
  addReply,
  changeChoice,
  childMoves,
  childPath,
  filtersOf,
  findOpening,
  keyAfter,
  parentPath,
  pathMoves,
  positionFromFen,
  removeReply,
  sanLine,
  toStandardUci,
  uciToSan,
} from '@chess-trainer/core'
import { LichessAuthError } from '@chess-trainer/lichess'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'wouter'
import { OPENINGS } from '../data/openings'
import { cachedEvals } from '../engine/cached-engine'
import { db, explorer, runner, store } from '../services'
import { Board } from '../ui/board'
import { LEAF_LABELS, pct } from '../ui/format'
import { useRepertoire } from '../ui/hooks'
import { drillHref, exploreHref, parsePathParam } from '../ui/paths'
import { StatsPanel } from '../ui/stats-panel'
import { button, card, primaryButton } from '../ui/styles'

function Explorer({ repertoire, tree, path }: { repertoire: Repertoire; tree: RepertoireTree; path: string }) {
  const [, navigate] = useLocation()
  const [loading, setLoading] = useState(false)
  const { id } = repertoire
  const moves = pathMoves(path)
  const node = tree.nodes.get(path)
  const positionKey = node?.positionKey ?? keyAfter(moves)
  const stats = useLiveQuery(() => explorer.peek(positionKey, filtersOf(repertoire.settings)), [positionKey, id])
  const evals = useLiveQuery(() => cachedEvals(db, positionKey), [positionKey])
  const children = node ? childMoves(tree, node) : []
  const parent = moves.length > 0 ? tree.nodes.get(parentPath(path)) : undefined
  const lastMove = moves.at(-1)
  const inPrefix = moves.length < repertoire.rootMoves.length
  const canRemove =
    !!parent &&
    !!lastMove &&
    parent.side === 'theirs' &&
    (parent.replies?.length ?? 0) > 1 &&
    parent.ply >= repertoire.rootMoves.length
  const opening = findOpening(OPENINGS, moves)
  const sans = sanLine(moves)
  const go = (target: string) => navigate(exploreHref(id, target))

  async function select(uci: Uci) {
    const move = toStandardUci(positionFromFen(positionKey), uci)
    if (!move) return
    if (!node || children.includes(move)) return go(childPath(path, move))
    if (inPrefix) return alert('Cette position fait partie de l’ouverture choisie : elle ne peut pas changer.')
    const san = uciToSan(positionKey, move)
    try {
      if (node.side === 'mine') {
        const current = tree.choices.get(positionKey)
        const was = current ? uciToSan(positionKey, current) : 'aucun coup'
        if (!confirm(`Jouer ${san} ici au lieu de ${was} ? La suite de la ligne sera régénérée.`)) return
        await changeChoice(store, id, positionKey, move)
      } else {
        if (!confirm(`Ajouter la réponse adverse ${san} au répertoire ?`)) return
        const pos = positionFromFen(positionKey)
        const stat = stats?.moves.find((m) => toStandardUci(pos, m.uci) === move)
        const total = stats ? stats.white + stats.draws + stats.black : 0
        const share = stat && total ? (stat.white + stat.draws + stat.black) / total : 0
        await addReply(store, id, path, move, share)
      }
      await runner.start(id)
      go(childPath(path, move))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeBranch() {
    if (!lastMove || !confirm('Retirer cette réponse adverse et toute la suite de la ligne ?')) return
    const target = parentPath(path)
    await removeReply(store, id, target, lastMove)
    go(target)
  }

  async function loadStats() {
    setLoading(true)
    try {
      await explorer.query(positionKey, filtersOf(repertoire.settings))
    } catch (error) {
      alert(
        error instanceof LichessAuthError
          ? 'Connecte-toi à Lichess pour charger les statistiques.'
          : 'Impossible de charger les statistiques pour le moment.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-3">
        <Board
          positionKey={positionKey}
          orientation={repertoire.color}
          lastMove={lastMove}
          movable
          onMove={(uci) => void select(uci)}
        />
        <nav aria-label="Coups de la ligne" className="flex flex-wrap gap-1 text-sm">
          <button type="button" className="rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => go('')}>
            Début
          </button>
          {sans.map((san, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: a ply index is the identity of a move in the line
              key={i}
              type="button"
              aria-current={i === sans.length - 1 ? 'step' : undefined}
              className="rounded px-1.5 py-0.5 hover:bg-neutral-200 aria-[current=step]:font-semibold dark:hover:bg-neutral-800"
              onClick={() => go(moves.slice(0, i + 1).join(' '))}
            >
              {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
              {san}
            </button>
          ))}
        </nav>
      </div>

      <aside className="space-y-4">
        <div className={`${card} space-y-1`}>
          <h1 className="font-semibold">{repertoire.name}</h1>
          {opening && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {opening.eco} · {opening.name}
            </p>
          )}
          <p className="text-sm">
            {!node ? 'Hors répertoire' : node.side === 'mine' ? 'À toi de jouer' : 'Coup adverse'}
            {node && ` · probabilité de la ligne : ${pct(node.probability)}`}
          </p>
          {node?.leafReason && <p className="text-sm">{LEAF_LABELS[node.leafReason]}</p>}
          {inPrefix && <p className="text-sm">Coup imposé par l’ouverture choisie.</p>}
        </div>

        <StatsPanel
          positionKey={positionKey}
          stats={stats}
          evals={evals?.candidates}
          highlight={new Set(children)}
          onSelect={(uci) => void select(uci)}
        />
        {!stats && (
          <button type="button" className={button} disabled={loading} onClick={() => void loadStats()}>
            {loading ? 'Chargement…' : 'Charger les statistiques'}
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          {moves.length > 0 && (
            <button type="button" className={button} onClick={() => go(parentPath(path))}>
              Coup précédent
            </button>
          )}
          <Link href={drillHref(id, path)} className={primaryButton}>
            S’entraîner depuis ici
          </Link>
          {canRemove && (
            <button type="button" className={button} onClick={() => void removeBranch()}>
              Retirer cette branche
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          Clique un coup pour avancer. À ton tour, un autre coup remplace le tien. Au tour adverse, il ajoute une
          branche.
        </p>
      </aside>
    </div>
  )
}

export function ExploreScreen() {
  const params = useParams<{ id: string; moves?: string }>()
  const path = parsePathParam(params.moves)
  const repertoire = useRepertoire(params.id)
  const tree = useLiveQuery(() => store.loadTree(params.id).catch(() => null), [params.id])

  if (repertoire === undefined || tree === undefined) return <p>Chargement…</p>
  if (repertoire === null || tree === null) return <p>Répertoire introuvable.</p>
  if (path === undefined) {
    return (
      <p>
        Position introuvable.{' '}
        <Link href={exploreHref(params.id, '')} className="underline">
          Revenir au début
        </Link>
      </p>
    )
  }
  return <Explorer repertoire={repertoire} tree={tree} path={path} />
}
```

- [ ] **Step 2: Wire the route**

In `apps/web/src/app.tsx`, route `/r/:id/explore/:moves?` to `ExploreScreen`.

- [ ] **Step 3: Typecheck, lint and build**

Run: `pnpm --filter @chess-trainer/web typecheck && pnpm lint && pnpm --filter @chess-trainer/web build`
Expected: PASS.

- [ ] **Step 4: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 14: Drill screen

**Files:**
- Create: `apps/web/src/screens/drill.tsx`
- Modify: `apps/web/src/app.tsx` (route `/r/:id/drill/:moves?`)

**Interfaces:**
- Consumes:
  - core: `DrillSession`, `RepertoireTree`, `Repertoire`, `filtersOf`, `findOpening`, `pathMoves`
  - web: `store.loadTree`, `store.recordStat`, `explorer.peek`, `cachedEvals`, `Board`, `Arrow`, `StatsPanel`, `useRepertoire`, `parsePathParam`, `exploreHref`, `OPENINGS`, styles
- Produces: `<DrillScreen>`.

- [ ] **Step 1: Implement the screen**

Rules from spec §7:
- The opponent answers after 400 ms.
- A wrong move is taken back (bump `version`) and a green arrow shows the expected move.
- The stats of the position are shown only after the correct move.
- The tree is loaded once per session, not live: regeneration must not reshuffle a line in progress.

`apps/web/src/screens/drill.tsx`:
```tsx
import {
  DrillSession,
  type PositionKey,
  type Repertoire,
  type RepertoireTree,
  type Uci,
  filtersOf,
  findOpening,
  pathMoves,
} from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Link, useParams } from 'wouter'
import { OPENINGS } from '../data/openings'
import { cachedEvals } from '../engine/cached-engine'
import { db, explorer, store } from '../services'
import { type Arrow, Board } from '../ui/board'
import { useRepertoire } from '../ui/hooks'
import { exploreHref, parsePathParam } from '../ui/paths'
import { StatsPanel } from '../ui/stats-panel'
import { card, primaryButton } from '../ui/styles'

const OPPONENT_DELAY_MS = 400

function RevealedStats({
  repertoire,
  tree,
  positionKey,
}: { repertoire: Repertoire; tree: RepertoireTree; positionKey: PositionKey }) {
  const stats = useLiveQuery(
    () => explorer.peek(positionKey, filtersOf(repertoire.settings)),
    [positionKey, repertoire.id],
  )
  const evals = useLiveQuery(() => cachedEvals(db, positionKey), [positionKey])
  const choice = tree.choices.get(positionKey)
  return (
    <StatsPanel
      positionKey={positionKey}
      stats={stats}
      evals={evals?.candidates}
      highlight={new Set(choice ? [choice] : [])}
    />
  )
}

function Drill({ repertoire, tree, startPath }: { repertoire: Repertoire; tree: RepertoireTree; startPath: string }) {
  const [session] = useState(() => new DrillSession(tree, startPath))
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [lastMove, setLastMove] = useState<Uci | undefined>(pathMoves(startPath).at(-1))
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [revealed, setRevealed] = useState<PositionKey>()
  const [version, setVersion] = useState(0)
  const [totals, setTotals] = useState({ lines: 0, errors: 0 })
  const nextButton = useRef<HTMLButtonElement>(null)
  const turn = session.turn

  useEffect(() => {
    if (turn !== 'theirs') return
    const timer = setTimeout(() => {
      setLastMove(session.playOpponent())
      rerender()
    }, OPPONENT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [session, turn])

  useEffect(() => {
    if (turn === 'done') nextButton.current?.focus()
  }, [turn])

  function onMove(uci: Uci) {
    if (session.turn !== 'mine') return
    const before = session.positionKey
    const result = session.play(uci)
    if (result.stat) void store.recordStat(repertoire.id, result.stat)
    if (result.correct) {
      setLastMove(pathMoves(session.path).at(-1))
      setArrows([])
      setRevealed(before)
    } else {
      setArrows([{ from: result.expected.slice(0, 2), to: result.expected.slice(2, 4), brush: 'green' }])
    }
    setVersion((v) => v + 1)
    rerender()
  }

  function nextLine() {
    setTotals((t) => ({ lines: t.lines + 1, errors: t.errors + session.lineErrors }))
    session.nextLine()
    setLastMove(pathMoves(startPath).at(-1))
    setArrows([])
    setRevealed(undefined)
    setVersion((v) => v + 1)
    rerender()
  }

  const opening = findOpening(OPENINGS, pathMoves(session.path))
  const errors = session.lineErrors
  const empty = turn === 'done' && session.path === startPath

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Board
        positionKey={session.positionKey}
        orientation={repertoire.color}
        lastMove={lastMove}
        movable={turn === 'mine'}
        arrows={arrows}
        version={version}
        onMove={onMove}
      />
      <aside className="space-y-4">
        <div className={`${card} space-y-2`}>
          <h1 className="font-semibold">{repertoire.name}</h1>
          {opening && <p className="text-sm text-neutral-600 dark:text-neutral-400">{opening.name}</p>}
          <div aria-live="polite" className="space-y-2">
            {turn === 'mine' && arrows.length === 0 && <p>À toi de jouer.</p>}
            {turn === 'mine' && arrows.length > 0 && (
              <p className="text-red-700 dark:text-red-400">Pas ce coup-là. Joue le coup indiqué par la flèche.</p>
            )}
            {turn === 'theirs' && <p>L’adversaire joue…</p>}
            {empty && (
              <p>
                Rien à entraîner ici pour l’instant. Attends la fin de la génération ou{' '}
                <Link href={exploreHref(repertoire.id, startPath)} className="underline">
                  explore l’arbre
                </Link>
                .
              </p>
            )}
            {turn === 'done' && !empty && (
              <>
                <p>
                  Ligne terminée
                  {errors ? ` avec ${errors} erreur${errors > 1 ? 's' : ''}.` : ' sans erreur.'}
                  {errors > 0 && !session.isReplay && ' Elle va être rejouée.'}
                </p>
                <button ref={nextButton} type="button" className={primaryButton} onClick={nextLine}>
                  Ligne suivante
                </button>
              </>
            )}
          </div>
        </div>
        {revealed && <RevealedStats repertoire={repertoire} tree={tree} positionKey={revealed} />}
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Session : {totals.lines} ligne{totals.lines > 1 ? 's' : ''}, {totals.errors} erreur
          {totals.errors > 1 ? 's' : ''}.
        </p>
      </aside>
    </div>
  )
}

export function DrillScreen() {
  const params = useParams<{ id: string; moves?: string }>()
  const startPath = parsePathParam(params.moves)
  const repertoire = useRepertoire(params.id)
  const [tree, setTree] = useState<RepertoireTree | null>()

  useEffect(() => {
    let alive = true
    store
      .loadTree(params.id)
      .then((t) => alive && setTree(t))
      .catch(() => alive && setTree(null))
    return () => {
      alive = false
    }
  }, [params.id])

  if (repertoire === undefined || tree === undefined) return <p>Chargement…</p>
  if (repertoire === null || tree === null) return <p>Répertoire introuvable.</p>
  if (startPath === undefined) return <p>Position introuvable.</p>
  return <Drill key={`${repertoire.id}|${startPath}`} repertoire={repertoire} tree={tree} startPath={startPath} />
}
```

- [ ] **Step 2: Wire the route**

In `apps/web/src/app.tsx`, route `/r/:id/drill/:moves?` to `DrillScreen`.

- [ ] **Step 3: Typecheck, lint and build**

Run: `pnpm --filter @chess-trainer/web typecheck && pnpm lint && pnpm --filter @chess-trainer/web build`
Expected: PASS.

- [ ] **Step 4: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 15: Stats screen, README, final checks

**Files:**
- Create: `apps/web/src/ui/rank.ts`, `apps/web/src/screens/stats.tsx`, `README.md`
- Modify: `apps/web/src/app.tsx` (route `/r/:id/stats`)
- Delete: `apps/web/src/screens/placeholders.tsx`
- Test: `apps/web/src/ui/rank.test.ts`

**Interfaces:**
- Consumes: `RepNode`, `PositionStats`, `PositionKey`, `sanLine`, `pathMoves`, `store.nodesOf`, `store.statsOf`, `useRepertoire`, `exploreHref`, `formatLine`, `pct`, styles.
- Produces:
  - `RankedPosition = PositionStats & { path: string; rate: number }`
  - `rankPositions(nodes: RepNode[], stats: PositionStats[]): RankedPosition[]`
  - `<StatsScreen>`

- [ ] **Step 1: Write the failing ranking test**

`apps/web/src/ui/rank.test.ts`:
```ts
import type { PositionStats, RepNode } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { rankPositions } from './rank'

const node = (path: string, positionKey: string, side: 'mine' | 'theirs' = 'mine'): RepNode => ({
  repertoireId: 'r',
  path,
  positionKey,
  ply: path.split(' ').length,
  probability: 1,
  side,
  expanded: true,
})
const stat = (positionKey: string, attempts: number, errors: number): PositionStats => ({
  repertoireId: 'r',
  positionKey,
  attempts,
  errors,
})

describe('rankPositions', () => {
  it('sorts by error rate, then errors, keeps the shortest path and drops unknown positions', () => {
    const nodes = [node('a b c', 'P'), node('x', 'P'), node('a', 'Q'), node('a b', 'R', 'theirs')]
    const stats = [stat('P', 4, 1), stat('Q', 2, 1), stat('R', 1, 1), stat('gone', 1, 1)]
    expect(rankPositions(nodes, stats).map((r) => [r.positionKey, r.path, r.rate])).toEqual([
      ['Q', 'a', 0.5],
      ['P', 'x', 0.25],
    ])
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm --filter @chess-trainer/web test rank`
Expected: FAIL, "Failed to resolve import './rank'".

- [ ] **Step 3: Implement ranking and the screen**

`apps/web/src/ui/rank.ts`:
```ts
import type { PositionKey, PositionStats, RepNode } from '@chess-trainer/core'

export type RankedPosition = PositionStats & { path: string; rate: number }

export function rankPositions(nodes: readonly RepNode[], stats: readonly PositionStats[]): RankedPosition[] {
  const shortest = new Map<PositionKey, string>()
  for (const n of nodes) {
    if (n.side !== 'mine') continue
    const known = shortest.get(n.positionKey)
    if (known === undefined || n.path.length < known.length) shortest.set(n.positionKey, n.path)
  }
  return stats
    .flatMap((s) => {
      const path = shortest.get(s.positionKey)
      return path === undefined || s.attempts === 0 ? [] : [{ ...s, path, rate: s.errors / s.attempts }]
    })
    .sort((a, b) => b.rate - a.rate || b.errors - a.errors)
}
```

`apps/web/src/screens/stats.tsx`:
```tsx
import { pathMoves, sanLine } from '@chess-trainer/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'wouter'
import { store } from '../services'
import { formatLine, pct } from '../ui/format'
import { useRepertoire } from '../ui/hooks'
import { exploreHref } from '../ui/paths'
import { rankPositions } from '../ui/rank'
import { card } from '../ui/styles'

export function StatsScreen() {
  const { id } = useParams<{ id: string }>()
  const repertoire = useRepertoire(id)
  const rows = useLiveQuery(
    async () => rankPositions(await store.nodesOf(id), await store.statsOf(id)),
    [id],
  )

  if (repertoire === undefined || rows === undefined) return <p>Chargement…</p>
  if (repertoire === null) return <p>Répertoire introuvable.</p>

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Stats · {repertoire.name}</h1>
      {rows.length === 0 ? (
        <p className="text-neutral-600 dark:text-neutral-400">Pas encore d’essai. Lance une séance d’entraînement.</p>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="py-1 font-medium">Position (ton coup ensuite)</th>
                <th className="py-1 font-medium">Essais</th>
                <th className="py-1 font-medium">Erreurs</th>
                <th className="py-1 font-medium">Taux d’erreur</th>
                <th className="py-1 font-medium">Dernier essai</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.positionKey} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1.5">
                    <Link href={exploreHref(id, r.path)} className="underline-offset-2 hover:underline">
                      {formatLine(sanLine(pathMoves(r.path))) || 'Position de départ'}
                    </Link>
                  </td>
                  <td className="py-1.5 tabular-nums">{r.attempts}</td>
                  <td className="py-1.5 tabular-nums">{r.errors}</td>
                  <td className="py-1.5 tabular-nums">{pct(r.rate)}</td>
                  <td className="py-1.5">{r.lastResult === 'ok' ? 'Réussi' : 'Raté'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
```

Route `/r/:id/stats` to `StatsScreen` in `apps/web/src/app.tsx`. Then delete `apps/web/src/screens/placeholders.tsx` and its import.

- [ ] **Step 4: Write the README**

`README.md`:
````markdown
# Chess Trainer

Learn a chess opening by heart.

The app builds a repertoire from real Lichess games. It checks your moves with Stockfish. Then it drills you line by line: the opponent plays like humans of your level, and you must find your move.

## How it works

1. Pick an opening, your color, a rating range and time controls.
2. The app reads the Lichess opening explorer:
   - For your moves, it keeps the most played move that Stockfish rates within 0.3 pawn of the best move.
   - For the opponent, it keeps every reply that occurs in at least 1 % of your games.
3. Drill the lines. A wrong move shows the right one, and a failed line comes back once.

Everything runs in your browser. Repertoires stay in IndexedDB. Use the JSON export to back them up.

## Run it

Requirements: Node 22.12 or later, pnpm 12.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 and log in with Lichess. Since March 2026, the opening explorer accepts only authenticated requests: 25 per minute per account. The first generation of an opening takes 10 to 30 minutes, and the app caches every answer.

| Command | Purpose |
|---|---|
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | TypeScript |
| `pnpm lint` | Biome |
| `pnpm build` | Production build in `apps/web/dist` |
| `pnpm --filter @chess-trainer/web fetch-openings` | Refresh the opening names |

## Layout

| Path | Content |
|---|---|
| `packages/core` | Domain logic, no I/O: generation, editing, drill |
| `packages/lichess` | Explorer client, rate-limited queue, OAuth PKCE |
| `apps/web` | Vite + React app, IndexedDB, Stockfish worker, chessground board |

## License and data

GPL-3.0-or-later.

- Game statistics come from the [Lichess opening explorer](https://lichess.org/api#tag/Opening-Explorer).
- Opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
- The app uses [Stockfish](https://stockfishchess.org/), [chessground](https://github.com/lichess-org/chessground) and [chessops](https://github.com/niklasf/chessops) (all GPL-3.0).
````

- [ ] **Step 5: Run every check**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all packages PASS. The build writes `apps/web/dist`, and `apps/web/dist/stockfish/` holds the two engine files.

- [ ] **Step 6: Browser smoke test (controller, with Chrome DevTools MCP)**

Start `pnpm dev` in the background. Open http://localhost:5173 and check each item:

1. The home screen renders with no console error.
2. `#/new`: typing "french" lists "C00 · French Defense". Picking it selects Black. Rating and speed checkboxes toggle.
3. In the page console, Stockfish answers:
   ```js
   await new Promise((resolve) => {
     const w = new Worker('/stockfish/stockfish-19-lite-single.js')
     w.onmessage = (e) => e.data === 'uciok' && resolve('ok')
     w.postMessage('uci')
   })
   ```
   Expected: `'ok'`.
4. `#/r/unknown/explore/e2e4-zzzz` shows "Position introuvable" or "Répertoire introuvable", never a blank page.
5. At 390 px wide, the page has no horizontal scroll.

The live Lichess login needs the user's account. Hand these steps to the user:
- log in;
- generate "French Defense" with the minimal line probability at 5 % (a fast run);
- drill one line;
- change one move in the explorer.

After that first generation, capture one real `/lichess` response and replace the fixture in `packages/lichess/src/fixtures/`.

- [ ] **Step 7: Mark files for review (no commit)**

Run: `git add -N .`

---

### Task 16: Readable coordinates, square names, move hover arrow and tooltip

User request (2026-09-28):
- Make the board coordinates much more visible, because the user also uses the drill to memorize square names.
- When a move is hovered in the stats list, show it on the board and give a French text version in a tooltip, for every kind of move.

**Files:**
- Create: `apps/web/src/ui/describe-move.ts`, `apps/web/src/ui/preferences.tsx`
- Modify: `apps/web/src/ui/board.tsx`, `apps/web/src/ui/stats-panel.tsx`, `apps/web/src/index.css`, `apps/web/src/screens/explore.tsx`, `apps/web/src/screens/drill.tsx`
- Test: `apps/web/src/ui/describe-move.test.ts`

**Interfaces:**
- Consumes: `positionFromFen`, `toStandardUci`, `keyAfter`, `PositionKey`, `Uci`, `Color` from core; `castlingSide` from `chessops/chess`; `makeSan` from `chessops/san`; `parseUci`, `makeSquare` from `chessops/util`; the `Role` type from `chessops/types`.
- Produces:
  - `describeMove(key: PositionKey, uci: Uci): { san: string; text: string } | undefined`. It returns undefined for an illegal or malformed move.
  - `arrowOf(uci: Uci, brush: Arrow['brush']): Arrow` in `ui/board.tsx`.
  - `<Board … squareNames?: boolean />`.
  - `useSquareNames(): [boolean, (value: boolean) => void]` and `<SquareNamesToggle />` in `ui/preferences.tsx`.
  - `<StatsPanel … onHover?: (uci: Uci | undefined) => void />`.

- [ ] **Step 1: Write the failing test for the move descriptions**

`apps/web/src/ui/describe-move.test.ts`:
```ts
import { INITIAL_KEY, keyAfter, positionKey } from '@chess-trainer/core'
import { describe, expect, it } from 'vitest'
import { describeMove } from './describe-move'

const text = (fen: string, uci: string) => describeMove(positionKey(fen), uci)?.text

describe('describeMove', () => {
  it('describes quiet pawn and piece moves with both squares', () => {
    expect(describeMove(INITIAL_KEY, 'e2e4')).toEqual({ san: 'e4', text: 'Le pion e2 va en e4' })
    expect(describeMove(INITIAL_KEY, 'g1f3')?.text).toBe('Le cavalier g1 va en f3')
  })

  it('names the captured piece', () => {
    expect(describeMove(keyAfter(['e2e4', 'd7d5']), 'e4d5')?.text).toBe('Le pion e4 prend le pion en d5')
    expect(text('3qk3/8/8/8/8/8/8/3QK3 w - - 0 1', 'd1d8')).toBe('La dame d1 prend la dame en d8, échec')
  })

  it('describes both castlings, also from king-takes-rook input and for Black', () => {
    const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
    expect(text(castle, 'e1g1')).toBe('Petit roque')
    expect(text(castle, 'e1h1')).toBe('Petit roque')
    expect(text(castle, 'e1c1')).toBe('Grand roque')
    expect(text('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8c8')).toBe('Grand roque')
  })

  it('describes en passant', () => {
    expect(text('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 'e5f6')).toBe(
      'Le pion e5 prend le pion en passant en f6',
    )
  })

  it('describes promotions, underpromotions and capture-promotions', () => {
    expect(text('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7e8q')).toBe('Le pion e7 va en e8 et devient une dame')
    expect(text('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7e8n')).toBe('Le pion e7 va en e8 et devient un cavalier')
    expect(text('3r4/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7d8q')).toBe(
      'Le pion e7 prend la tour en d8 et devient une dame',
    )
  })

  it('adds check and mate', () => {
    expect(text('rnbqkbnr/ppp2ppp/8/3pp3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'f1b5')).toBe(
      'Le fou f1 va en b5, échec',
    )
    expect(describeMove(keyAfter(['f2f3', 'e7e5', 'g2g4']), 'd8h4')).toEqual({
      san: 'Qh4#',
      text: 'La dame d8 va en h4, échec et mat',
    })
  })

  it('keeps the origin square when SAN needs disambiguation', () => {
    expect(text('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1', 'b1d2')).toBe('Le cavalier b1 va en d2')
  })

  it('returns undefined for an illegal or malformed move', () => {
    expect(describeMove(INITIAL_KEY, 'e2e5')).toBeUndefined()
    expect(describeMove(INITIAL_KEY, 'zz')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm --filter @chess-trainer/web test describe-move`
Expected: FAIL, "Failed to resolve import './describe-move'".

- [ ] **Step 3: Implement `describe-move.ts`**

`apps/web/src/ui/describe-move.ts`:
```ts
import { type PositionKey, type Uci, positionFromFen, toStandardUci } from '@chess-trainer/core'
import { castlingSide } from 'chessops/chess'
import { makeSan } from 'chessops/san'
import type { Role } from 'chessops/types'
import { makeSquare, parseUci } from 'chessops/util'

const PIECES: Record<Role, { subject: string; object: string; promoted: string }> = {
  pawn: { subject: 'Le pion', object: 'le pion', promoted: 'un pion' },
  knight: { subject: 'Le cavalier', object: 'le cavalier', promoted: 'un cavalier' },
  bishop: { subject: 'Le fou', object: 'le fou', promoted: 'un fou' },
  rook: { subject: 'La tour', object: 'la tour', promoted: 'une tour' },
  queen: { subject: 'La dame', object: 'la dame', promoted: 'une dame' },
  king: { subject: 'Le roi', object: 'le roi', promoted: 'un roi' },
}

export function describeMove(key: PositionKey, uci: Uci): { san: string; text: string } | undefined {
  const pos = positionFromFen(key)
  const standard = toStandardUci(pos, uci)
  const move = standard ? parseUci(standard) : undefined
  if (!move || !('from' in move)) return undefined
  const piece = pos.board.get(move.from)
  if (!piece) return undefined

  const san = makeSan(pos, move)
  const suffix = san.endsWith('#') ? ', échec et mat' : san.endsWith('+') ? ', échec' : ''
  const side = castlingSide(pos, move)
  if (side) return { san, text: `${side === 'h' ? 'Petit roque' : 'Grand roque'}${suffix}` }

  const to = makeSquare(move.to)
  const captured = pos.board.get(move.to)
  const enPassant = piece.role === 'pawn' && !captured && (move.from & 7) !== (move.to & 7)
  const action = captured
    ? `prend ${PIECES[captured.role].object} en ${to}`
    : enPassant
      ? `prend le pion en passant en ${to}`
      : `va en ${to}`
  const promotion = move.promotion ? ` et devient ${PIECES[move.promotion].promoted}` : ''
  return { san, text: `${PIECES[piece.role].subject} ${makeSquare(move.from)} ${action}${promotion}${suffix}` }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @chess-trainer/web test describe-move`
Expected: PASS. If one expected SAN or sentence is wrong because of a chessops detail, fix the code rather than the assertion. The sentences are the spec.

- [ ] **Step 5: Add the square-name preference**

`apps/web/src/ui/preferences.tsx`:
```tsx
import { useSyncExternalStore } from 'react'

const KEY = 'chess-trainer.square-names'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function write(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

export function useSquareNames(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, read)
  return [value, write]
}

export function SquareNamesToggle() {
  const [value, setValue] = useSquareNames()
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(event) => setValue(event.target.checked)} />
      Afficher le nom de chaque case
    </label>
  )
}
```

- [ ] **Step 6: Board — large edge coordinates, optional square names, arrow helper**

In `apps/web/src/ui/board.tsx`:
- Rename the current `Board` function to `BoardCanvas`, with the same props plus `squareNames: boolean`. In its `Chessground(...)` creation config, add `coordinates: squareNames` and `coordinatesOnSquares: squareNames`. Chessground reads these only when it is created, which is why the wrapper below remounts the canvas through `key`.
- Add and export `arrowOf`:
```ts
export const arrowOf = (uci: Uci, brush: Arrow['brush']): Arrow => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  brush,
})
```
- Add a new exported `Board`. It lays out a rank gutter left of the canvas and a file gutter under it, in the board orientation:
```tsx
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8']
const GUTTER = 'text-sm font-semibold text-neutral-600 sm:text-base dark:text-neutral-300'

export function Board({ squareNames = false, ...props }: BoardProps & { squareNames?: boolean }) {
  const white = props.orientation === 'white'
  const files = white ? FILES : [...FILES].reverse()
  const ranks = white ? [...RANKS].reverse() : RANKS
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-1">
      <div aria-hidden="true" className={`grid grid-rows-8 ${GUTTER}`}>
        {ranks.map((rank) => (
          <span key={rank} className="flex items-center justify-end">
            {rank}
          </span>
        ))}
      </div>
      <BoardCanvas key={squareNames ? 'names' : 'plain'} {...props} squareNames={squareNames} />
      <span />
      <div aria-hidden="true" className={`grid grid-cols-8 text-center ${GUTTER}`}>
        {files.map((file) => (
          <span key={file}>{file}</span>
        ))}
      </div>
    </div>
  )
}
```

In `apps/web/src/index.css`, append the style for the per-square names. Chessground's default is uppercase 9 px at 80 % opacity:
```css
.cg-wrap coords.squares {
  text-transform: none;
  font-size: clamp(10px, 1.6vw, 14px);
  font-weight: 700;
  opacity: 1;
}
```

- [ ] **Step 7: StatsPanel — hover arrow and tooltip for every move row**

In `apps/web/src/ui/stats-panel.tsx`:
- Add the prop `onHover?: (uci: Uci | undefined) => void`.
- Call `const tipBase = useId()` at the top of the component, before the early return.
- For each row, compute `const tip = describeMove(positionKey, m.uci)`.
- On the `<tr>`, add `className` `group` (keep the highlight class), and set `onMouseEnter={() => onHover?.(m.uci)}` and `onMouseLeave={() => onHover?.(undefined)}`.
- On the SAN button:
  - remove `disabled`;
  - add `aria-disabled={onSelect ? undefined : true}`;
  - add `onFocus={() => onHover?.(m.uci)}` and `onBlur={() => onHover?.(undefined)}`;
  - add `aria-describedby={tip ? `${tipBase}-${m.uci}` : undefined}`.
  - Chrome does not fire mouse events on disabled buttons, so a disabled button would break the hover in the drill.
- Make the first `<td>` `relative`, and after the button render:
```tsx
{tip && (
  <span
    id={`${tipBase}-${m.uci}`}
    role="tooltip"
    className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-64 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-md group-hover:block group-focus-within:block dark:bg-neutral-100 dark:text-neutral-900"
  >
    {tip.text}
  </span>
)}
```

- [ ] **Step 8: Wire the screens**

`apps/web/src/screens/explore.tsx`:
- Add `const [hovered, setHovered] = useState<Uci>()`.
- In `go()`, call `setHovered(undefined)` before `navigate`.
- Build `const arrows = useMemo(() => (hovered ? [arrowOf(hovered, 'blue')] : []), [hovered])`. Call it before any conditional code.
- Pass `arrows` and `squareNames` to `<Board>`. `squareNames` comes from `const [squareNames] = useSquareNames()`.
- Render `<SquareNamesToggle />` right under the move list nav.
- Pass `onHover={setHovered}` to `<StatsPanel>`.
- Give each breadcrumb button `title={describeMove(keyAfter(moves.slice(0, i)), moves[i]!)?.text}`.

`apps/web/src/screens/drill.tsx`:
- In `Drill`, add `const [hovered, setHovered] = useState<Uci>()` and `const boardArrows = useMemo(() => (hovered ? [...arrows, arrowOf(hovered, 'blue')] : arrows), [arrows, hovered])`.
- Pass `arrows={boardArrows}` and `squareNames` (from `useSquareNames()`) to `<Board>`.
- Call `setHovered(undefined)` in `onMove` and in `nextLine`.
- Render `<SquareNamesToggle />` under the board. Wrap the Board and the toggle in a `<div className="space-y-3">` so the grid keeps two columns.
- Give `RevealedStats` an `onHover` prop and forward it to `<StatsPanel>`.

- [ ] **Step 9: Checks**

Run: `pnpm --filter @chess-trainer/web test && pnpm --filter @chess-trainer/web typecheck && pnpm lint && pnpm --filter @chess-trainer/web build`
Expected: PASS. Paste the tail of each output into the report.

- [ ] **Step 10: Mark files for review (no commit)**

Run: `git add -N .`
