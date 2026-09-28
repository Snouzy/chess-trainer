# Chess Trainer

Learn a chess opening by heart.

The app builds a repertoire from real Lichess games. It checks your moves with Stockfish. Then it drills you line by line: the opponent plays like humans of your level, and you must find your move.

## How it works

1. Pick an opening, your color, a rating range and time controls.
2. The app reads the Lichess opening explorer:
   - For your moves, it keeps the most played move that Stockfish rates within 0.3 pawn of the best move.
   - For the opponent, it keeps every reply that occurs in at least 1 % of your games.
3. Drill the lines. A wrong move shows the right one, and a failed line comes back once.
4. Learn the squares as you go: large board coordinates, an optional name on every square, and a hover arrow with a plain-language description for every move in the stats lists.

Everything runs in your browser. Repertoires stay in IndexedDB. Use the JSON export to back them up.

## Run it

Requirements: Node 22.12 or later, pnpm 12. pnpm may warn that chessground declares Node 24: the library runs in the browser, so the warning is harmless.

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
