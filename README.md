# Chess Coach

Play the computer at your rating, with a coaching panel written for that rating.
The opponent's strength and the coaching's content both follow from a single ELO
setting chosen before each game.

## Running it

```bash
npm install            # postinstall checks the Stockfish build + writes attribution
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm run dev
```

To re-run that check by hand: `npm run setup:stockfish`.

The app runs without an API key — it falls back to heuristic, template-based
coaching. That fallback is a real degradation, not a placeholder: it is the
Option-A behaviour, and the difference between it and the model-backed coach is
the argument for the model-backed coach.

## How it fits together

```
 browser                                    server
┌────────────────────────────┐   fen     ┌──────────────────────────────────┐
│  chess.js → legality, SAN  │──────────▶│  /api/engine                     │
│  chessground → board UI    │◀──────────│    stockfish.wasm (one instance) │
│                            │  lines /  │    full strength for analysis,   │
│                            │  best move│    throttled for the opponent    │
│                            │           ├──────────────────────────────────┤
│                            │── facts ─▶│  /api/coach                      │
│                            │  + lines  │    Claude (prose only)           │
│                            │◀── note ──│                                  │
└────────────────────────────┘           └──────────────────────────────────┘
```

The browser holds no engine. It sends a FEN and gets back either candidate lines
(for evaluation, grading and the coach) or one opponent move at the player's
rating — depth, MultiPV and skill level are server-side constants, so a client
can't ask a shared process for `go depth 40`. One WASM instance serves both
roles; every call states its full UCI option set rather than relying on what ran
before it.

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
- **Hints aren't prefetched.** The level-1 hint fires as soon as the turn opens,
  but it starts from scratch — nothing is computed during the opponent's move.
- **One engine, one queue.** A single WASM instance is shared by every visitor
  hitting the same server process, and requests are serialised. Fine at this
  scale; a busy deployment wants a pool.

## Licensing

Stockfish.js is **GPLv3**. It now runs on our server and only its output — an
evaluation, a move — reaches the browser. That is using the program, not
conveying it, and GPLv3 has no network clause (that's AGPL), so the distribution
obligations do not apply. The previous version shipped the compiled engine to
every visitor and did have to satisfy them.

The attribution stayed anyway. `scripts/setup-stockfish.mjs` writes `COPYING.txt`
(the full licence) and `SOURCE.txt` (version, build, corresponding-source URLs)
to `static/stockfish/`, both linked from a visible credit in the UI, and refuses
to run if the version quoted in `src/lib/engine/attribution.ts` drifts from the
installed package. Players should be able to see what is grading their moves.

Moving the engine also retires the question of whether the GPL reaches your
application code: nothing of Stockfish enters the client bundle, and the server
talks to it over UCI — text in, text out, closer to two programs over a pipe
than to linking. The cost is that you now pay for the compute.

Not legal advice — get a real opinion before shipping this commercially.

## Cost

Two Claude calls per player move: feedback on the move played, and the hint that
opens the next turn. The "I need more" and "show me the move" buttons add one
each when used. With the default `claude-opus-5` at `effort: "low"` and the
system prompt cached, a 40-move game lands in the low tens of cents.
`COACH_MODEL=claude-sonnet-5` or `claude-haiku-4-5` trades some coaching quality
for latency and cost.

Engine compute is now yours too: roughly 50–450ms of a serverless CPU per
analysis, twice per move, plus the opponent's own think time.
