# Chess Coach

Play the computer at your rating, with a coaching panel written for that rating.
The opponent's strength and the coaching's content both follow from a single ELO
setting chosen before each game.

## Running it

```bash
npm install            # postinstall copies Stockfish into static/
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm run dev
```

If you ever need to re-copy the engine by hand: `npm run setup:stockfish`.

The app runs without an API key — it falls back to heuristic, template-based
coaching. That fallback is a real degradation, not a placeholder: it is the
Option-A behaviour, and the difference between it and the model-backed coach is
the argument for the model-backed coach.

## How it fits together

```
 browser                                            server
┌──────────────────────────────────┐              ┌────────────────────────┐
│  stockfish.wasm × 2              │              │  /api/coach            │
│    analyst  (full strength)  ────┼── facts ────▶│    Claude              │
│    opponent (throttled to ELO)   │   + lines    │    (prose only)        │
│                                  │◀── note ─────┤                        │
│  chess.js  → legality, SAN, FEN  │              └────────────────────────┘
│  chessground → board UI          │
└──────────────────────────────────┘
```

**Claude never evaluates the position.** Stockfish does. The endpoint receives
engine candidate lines plus a set of deterministic observations extracted from
the board (`src/lib/chess/facts.ts`) and Claude's job is pedagogy and
prioritisation — deciding which true thing matters at this player's level and
how to say it. This is what stops the coach confidently describing a fork that
isn't on the board.

## The ELO layer

One table in `src/lib/coach/levels.ts` drives three things at once:

| | Beginner | Developing | Intermediate | Advanced |
|---|---|---|---|---|
| Range | –1099 | 1100–1449 | 1450–1799 | 1800+ |
| Flags errors from | 90cp | 70cp | 50cp | 35cp |
| Candidates compared | 1 | 2 | 3 | 3 |
| Topics in scope | 5 | 6 | 7 | 6 |

Move grading is band-relative on purpose: a 60cp slip is a fine move for a 900
player and a real error for a 1900 player, and the app says so. One constraint
holds across every band though — `inaccuracy` must stay **below 100cp**, because
a clean pawn loss is worth ~100 and "you just dropped a pawn" deserves a mention
at every level. The first version set the beginner bar at 120 and cheerfully
called the Wing Gambit a good move.

**Opponent strength** (`src/lib/engine/strength.ts`). Stockfish's `UCI_Elo`
floor is ~1320, so above that we use `UCI_LimitStrength` honestly. Below it we
use `Skill Level` plus weighted selection from MultiPV — a throttled engine
otherwise plays near-perfectly and then hangs a rook at random, which reads as a
cheating computer rather than a 1000-rated human. `pickOpponentMove` is the only
function that knows this; swapping in Maia later means replacing it and nothing
else.

**Coaching content.** The band's `topics`/`avoid` lists are enforced twice:
`filterFactsForBand` strips out-of-scope observations before the model sees them
(filtering beats asking the model to ignore what it can see), and the band block
in the system prompt states the boundary explicitly.

## Prompt caching

The system prompt is two blocks, each with a cache breakpoint: shared rules
(hot across every band) then the band block (hot across every request at that
band). Per-move data lives in the user turn, after both breakpoints, so a new
position never invalidates the prefix. `/api/coach` logs
`cache_read_input_tokens` in dev — if it stays at zero across moves, something
has started varying inside the prefix.

## What this slice does not do yet

- **Promotion** is always to a queen; there's no piece picker.
- **No opening book or tablebase** — the engine plays from move one, and the
  opening names are a ~40-entry table, not ECO.
- **No game review replay.** The end-of-game card lists your mistakes but you
  can't step back through them.
- **No persistence.** Games are not saved; there is no account system.
- **Desktop layout only.** It reflows on mobile but hasn't been tuned there.
- **Hint prefetching isn't implemented** — the first hint on each move pays full
  latency. The analysis it needs is already cached, so this is a UI change.

## Licensing note

Stockfish.js is **GPLv3**. It is copied into `static/` at install time and
served to the browser, so distributing this app distributes Stockfish. That has
licensing implications for anything closed-source — worth resolving before this
ships anywhere public. `static/stockfish/` is gitignored, so the binary isn't in
your repo; the obligation attaches to what you deploy.

## Cost

One Claude call per player move (feedback) plus one per hint press. With the
default `claude-opus-5` at `effort: "low"` and the system prompt cached, a
40-move game lands in the low tens of cents. `COACH_MODEL=claude-sonnet-5` or
`claude-haiku-4-5` trades some coaching quality for latency and cost.
