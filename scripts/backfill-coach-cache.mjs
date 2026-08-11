#!/usr/bin/env node
/**
 * Re-fill the coach cache after a prompt change.
 *
 * The cache key contains a hash of the prompt that produced the note, so
 * editing SHARED_RULES or a band rolls every key over: the table is still full
 * but nothing in it can be hit, and the next player to reach each position pays
 * for it again. This script walks the positions already in the table and asks
 * the coach for them again under the current prompt, so the new version starts
 * warm on exactly the positions people actually reach.
 *
 * It drives a running dev server rather than calling Claude itself. Everything
 * that decides what gets written — the prompt blocks, the model, the effort
 * setting, the hint-level clamp, the cache write — lives in /api/coach, and a
 * backfill that reimplemented any of it would drift from the live path and
 * quietly fill the table with rows the app would never have produced. The same
 * goes for the analysis: candidates come from /api/engine at the server's own
 * depth, not from a second Stockfish with its own settings.
 *
 *   npm run dev                              # in another terminal
 *   node scripts/backfill-coach-cache.mjs    # plan only
 *   node scripts/backfill-coach-cache.mjs --write
 *
 * Options:
 *   --write          actually issue the coach calls (default is a dry run)
 *   --url <origin>   dev server origin (default http://localhost:5173)
 *   --limit <n>      stop after n requests
 *
 * Re-running is safe and cheap: a request already present under the current
 * prompt is a cache hit inside /api/coach and never reaches Claude.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Chess } from 'chess.js';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const i = argv.indexOf(name);
	return i === -1 ? fallback : argv[i + 1];
};

const WRITE = flag('--write');
const ORIGIN = (value('--url', 'http://localhost:5173') ?? '').replace(/\/$/, '');
const LIMIT = Number(value('--limit', Infinity));

/* ------------------------------------------------------------------ env */

process.loadEnvFile(path.join(ROOT, '.env'));
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
	console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env — nothing to backfill.');
	process.exit(1);
}

const SB = {
	headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` }
};

/** Every key in the table. Read in pages; PostgREST caps a response at 1000. */
async function allKeys() {
	const keys = [];
	for (let offset = 0; ; offset += 1000) {
		const res = await fetch(
			`${SUPABASE_URL}/rest/v1/coach_cache?select=key&order=key&offset=${offset}&limit=1000`,
			SB
		);
		if (!res.ok) throw new Error(`supabase read failed: ${res.status} ${await res.text()}`);
		const page = await res.json();
		keys.push(...page.map((r) => r.key));
		if (page.length < 1000) return keys;
	}
}

/* ------------------------------------- app modules, loaded straight from src

   The reconstruction has to agree with the app exactly — the same fact
   extraction, the same band filtering, the same grading. Loading the real
   modules through Vite is what guarantees that; a hand-copied version in this
   file would be correct on the day it was written and wrong after the next
   edit to facts.ts. Vite is already a dev dependency, and these four modules
   are plain TypeScript with no SvelteKit runtime behind them, so a bare server
   with the `$lib` alias is enough to load them.                              */

const vite = await createServer({
	root: ROOT,
	configFile: false,
	logLevel: 'error',
	appType: 'custom',
	server: { middlewareMode: true },
	resolve: { alias: { $lib: path.join(ROOT, 'src/lib') } }
});

const { extractFacts, filterFactsForBand, pvToSan } = await vite.ssrLoadModule(
	'/src/lib/chess/facts.ts'
);
const { OPENING_NAMES } = await vite.ssrLoadModule('/src/lib/chess/openings.ts');
const { BANDS, gradeMove } = await vite.ssrLoadModule('/src/lib/coach/levels.ts');
const { buildUserMessage } = await vite.ssrLoadModule('/src/lib/coach/prompt.ts');
const { toWhiteCp, fromWhiteCp } = await vite.ssrLoadModule('/src/lib/engine/uci.ts');

/* ------------------------------------------------------------------ keys */

/**
 * A stored key, back into the request that produced it.
 *
 * Two formats are in the table: the current
 * `version:model:band:mode:fen:arg:opening`, and an older one written before
 * the model joined the key. Anchoring on the mode segment reads both, and the
 * version and model are dropped either way — this is asking what request the
 * row stood for, not which prompt or model answered it.
 */
function parseKey(key) {
	const parts = key.split(':');
	const at = parts.findIndex((p) => p === 'hint' || p === 'feedback');
	if (at < 2) return null;
	return {
		band: parts[at - 1],
		mode: parts[at],
		fen: parts[at + 1],
		arg: parts[at + 2],
		opening: parts.slice(at + 3).join(':')
	};
}

/** What the request is, independent of the prompt and model that answered it. */
const identity = (r) => `${r.band}:${r.mode}:${r.fen}:${r.arg}:${r.opening}`;

/* --------------------------------------------------------------- rebuild */

const post = async (route, body) => {
	const res = await fetch(`${ORIGIN}${route}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`${route} → ${res.status} ${await res.text()}`);
	return res.json();
};

const analyse = (fen) => post('/api/engine', { op: 'analyse', fen });

/** Engine lines → coach candidates, exactly as the game does it. */
function toCandidates(fen, lines, playerColor) {
	const stm = new Chess(fen).turn();
	return lines.map((l, i) => ({
		rank: i + 1,
		moveSan: pvToSan(fen, [l.moveUci], 1)[0] ?? l.moveUci,
		moveUci: l.moveUci,
		cp: Math.round(fromWhiteCp(toWhiteCp(l, stm), playerColor)),
		mate: l.mate,
		pvSan: pvToSan(fen, l.pvUci, 6)
	}));
}

/** Mirrors `terminalCp` in the game state: a finished position has no eval. */
const terminalCp = (chess, player) =>
	chess.isCheckmate() ? (chess.turn() === player ? -10_000 : 10_000) : 0;

/*
 * The full move number is the one input a key cannot give back.
 *
 * `normalisedFen` drops the halfmove and fullmove clocks so transpositions
 * share a row, and the clocks are immaterial to the position — but the move
 * number is not quite immaterial to the *payload*: `phase` uses it to separate
 * an opening from a middlegame, and `yourKingStillInCentre` only fires from
 * move ten. Guessing it would mean writing rows the app would never have
 * written, under keys that look authoritative. So it is recovered instead, two
 * ways, and a position that survives neither is left alone.
 *
 * The first way is exact. Every feedback key names the move the player made
 * from that position, so the rows describe a graph: play the stored move, try
 * each legal reply, and any position that lands on another stored row is that
 * row, one move later. Walking out from the opening position numbers every
 * position the games passed through — which is most of the table, because most
 * of it came from games rather than one-off lookups.
 *
 * The walk breaks wherever a game passed through a position that was already
 * cached, because a hit writes no row and leaves a hole in the chain. So a
 * second pass steps a full move out of every dated position over *all* legal
 * moves rather than the stored ones, and dates any stored position it lands
 * on. That is an inference and not a proof — it says the position is one move
 * past a dated one, where the exact pass says the game played this move from
 * here. For openings, where the pieces pin the count tightly, the two agree;
 * the distinction is reported either way.
 *
 * The last resort, for positions neither pass reaches: build the payload at
 * both extremes of the move number and compare. If they match, this position
 * never consults it and any number will do.
 */
const EARLY = '0 1';
const LATE = '0 60';

const START = new Chess().fen();
const normalise = (fen) => fen.split(' ').slice(0, 4).join(' ');

/**
 * Stored position → the full move number it was reached on.
 *
 * Seeded with the opening position and everything one move from it, so a game
 * played as black is numbered from its own first decision.
 */
function recoverMoveNumbers(requests) {
	const known = new Set([...requests.values()].map((r) => r.fen));

	/** Stored moves out of a position, as SAN. */
	const played = new Map();
	for (const r of requests.values()) {
		if (r.mode !== 'feedback') continue;
		if (!played.has(r.fen)) played.set(r.fen, new Set());
		played.get(r.fen).add(r.arg);
	}

	const moveNumber = new Map();
	const inferred = new Set();
	const seed = (fen, n) => {
		if (known.has(fen) && !moveNumber.has(fen)) moveNumber.set(fen, n);
	};

	/** Every stored position one full move out of `fen`, played `moves` from it. */
	const step = function* (fen, n, moves) {
		const from = new Chess(`${fen} 0 ${n}`);
		for (const san of moves ?? from.moves()) {
			const board = new Chess(from.fen());
			try {
				board.move(san);
			} catch {
				continue;
			}
			if (board.isGameOver()) continue;
			for (const reply of board.moves()) {
				const next = new Chess(board.fen());
				next.move(reply);
				const key = normalise(next.fen());
				if (known.has(key)) yield [key, next.moveNumber()];
			}
		}
	};

	const opening = new Chess(START);
	seed(normalise(START), 1);
	for (const first of opening.moves()) {
		const c = new Chess(START);
		c.move(first);
		seed(normalise(c.fen()), 1);
	}

	// Breadth-first over the moves the games actually played. A position is only
	// numbered from a position that is already numbered, so nothing here is a
	// guess.
	const conflicts = new Set();
	const walk = (queue, moves, mark) => {
		while (queue.length) {
			const fen = queue.shift();
			const n = moveNumber.get(fen);
			for (const [key, reached] of step(fen, n, moves?.(fen))) {
				const seen = moveNumber.get(key);
				if (seen === undefined) {
					moveNumber.set(key, reached);
					if (mark) inferred.add(key);
					queue.push(key);
				} else if (seen !== reached && !inferred.has(key)) {
					// Two routes of different lengths, neither more authoritative than
					// the other. Fall through to the payload test instead of picking.
					conflicts.add(key);
				}
			}
		}
	};

	walk([...moveNumber.keys()], (fen) => [...(played.get(fen) ?? [])], false);
	for (const key of conflicts) moveNumber.delete(key);

	// Second pass: bridge the holes left by cache hits, over all legal moves.
	walk([...moveNumber.keys()], undefined, true);

	return { moveNumber, inferred };
}

async function rebuild(req, moveNumber) {
	const band = BANDS.find((b) => b.id === req.band);
	if (!band) return { skip: `unknown band ${req.band}` };
	if (req.opening !== '-' && !OPENING_NAMES.has(req.opening))
		return { skip: `opening "${req.opening}" is not in the book — unreachable row` };

	const clocks = moveNumber === undefined ? EARLY : `0 ${moveNumber}`;
	const fen = `${req.fen} ${clocks}`;

	let chess;
	try {
		chess = new Chess(fen);
	} catch {
		return { skip: 'invalid position' };
	}
	if (chess.isGameOver()) return { skip: 'position is already finished' };

	const playerColor = chess.turn();
	const playerElo = Math.max(band.min, 400);
	const openingName = req.opening === '-' ? null : req.opening;

	const { lines } = await analyse(fen);
	if (!lines.length) return { skip: 'engine returned no lines' };
	const candidates = toCandidates(fen, lines, playerColor);

	const base = {
		playerElo,
		playerColor,
		fen,
		openingName,
		candidates: candidates.slice(0, band.candidateMoves)
	};

	const finish = (request) => withFacts(request, req, band, playerColor, clocks, moveNumber);

	if (req.mode === 'hint') {
		const hintLevel = Number(req.arg);
		if (![1, 2, 3].includes(hintLevel)) return { skip: `bad hint level ${req.arg}` };
		return finish({ ...base, mode: 'hint', hintLevel });
	}

	// Feedback: replay the move to find what it cost, the same two evaluations
	// the game takes either side of a player move.
	let move;
	try {
		move = chess.move(req.arg);
	} catch {
		return { skip: `move ${req.arg} is not legal here` };
	}

	const cpBefore = candidates[0].cp;
	let cpAfter;
	if (chess.isGameOver()) {
		cpAfter = terminalCp(chess, playerColor);
	} else {
		const after = await analyse(chess.fen());
		if (!after.lines.length) return { skip: 'engine returned no lines after the move' };
		cpAfter = Math.round(
			fromWhiteCp(toWhiteCp(after.lines[0], chess.turn()), playerColor)
		);
	}

	const cpLoss = Math.max(0, Math.round(cpBefore - cpAfter));
	const best = candidates[0];

	return finish({
		...base,
		mode: 'feedback',
		playedMove: {
			san: move.san,
			uci: move.from + move.to,
			cpBefore: Math.round(cpBefore),
			cpAfter: Math.round(cpAfter),
			cpLoss,
			grade: gradeMove(cpLoss, band),
			bestSan: best && best.moveSan !== move.san ? best.moveSan : null,
			bestPvSan: best ? best.pvSan : [],
			captured: move.captured ?? null,
			givesCheck: chess.isCheck()
		}
	});
}

/**
 * Attach the facts.
 *
 * With the move number recovered from the games, this is just extraction. With
 * it unknown, the payload has to be shown not to depend on it before the row
 * can be written at all.
 */
function withFacts(request, req, band, playerColor, clocks, moveNumber) {
	const factsAt = (at) => filterFactsForBand(extractFacts(`${req.fen} ${at}`, playerColor), band.id);
	const built = { ...request, facts: factsAt(clocks) };

	if (moveNumber !== undefined) return { request: built, exact: true };

	if (buildUserMessage({ ...request, facts: factsAt(EARLY) }) !==
		buildUserMessage({ ...request, facts: factsAt(LATE) }))
		return { skip: 'move number is neither recoverable from the games nor irrelevant here' };

	return { request: built, exact: false };
}

/* ------------------------------------------------------------------ main */

const before = new Set(await allKeys());
console.log(`${before.size} rows in the table`);

const requests = new Map();
for (const key of before) {
	const parsed = parseKey(key);
	if (parsed) requests.set(identity(parsed), parsed);
	else console.warn(`unparsed key, skipping: ${key}`);
}
console.log(`${requests.size} distinct requests behind them`);

const { moveNumber: moveNumbers, inferred } = recoverMoveNumbers(requests);
const positions = new Set([...requests.values()].map((r) => r.fen)).size;
console.log(
	`${moveNumbers.size} of ${positions} positions dated ` +
		`(${moveNumbers.size - inferred.size} from the moves the games played, ${inferred.size} one move out from those)\n`
);

// Fail early and clearly rather than one confusing ECONNREFUSED per request.
try {
	await analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
} catch (err) {
	console.error(`No dev server at ${ORIGIN} — start one with \`npm run dev\`.\n  ${err.message}`);
	process.exit(1);
}

let done = 0;
const skipped = [];
const failed = [];

for (const req of requests.values()) {
	if (done >= LIMIT) break;
	const label = `${req.band}/${req.mode} ${req.arg} ${req.fen.split(' ')[0].slice(0, 28)}…`;

	let built;
	try {
		built = await rebuild(req, moveNumbers.get(req.fen));
	} catch (err) {
		failed.push([label, err.message]);
		console.log(`  fail  ${label} — ${err.message}`);
		continue;
	}

	if (built.skip) {
		skipped.push([label, built.skip]);
		console.log(`  skip  ${label} — ${built.skip}`);
		continue;
	}

	const dated = !built.exact
		? 'move number immaterial'
		: `move ${moveNumbers.get(req.fen)}${inferred.has(req.fen) ? ' (inferred)' : ''}`;

	if (!WRITE) {
		console.log(`  plan  ${label} — ${dated}`);
		done++;
		continue;
	}

	const startedAt = Date.now();
	try {
		const res = await post('/api/coach', built.request);
		const ms = Date.now() - startedAt;
		// A fallback body means the coach call failed inside the endpoint. It is
		// deliberately never cached, so the row is still missing.
		if (res.fallback) {
			failed.push([label, 'endpoint fell back to heuristics — nothing cached']);
			console.log(`  fail  ${label} — heuristic fallback, not cached`);
		} else {
			console.log(`  ok    ${label} (${ms}ms)`);
			done++;
		}
	} catch (err) {
		failed.push([label, err.message]);
		console.log(`  fail  ${label} — ${err.message}`);
	}
}

console.log();
if (!WRITE) {
	console.log(`Dry run. ${done} request(s) would be sent, ${skipped.length} skipped.`);
	console.log('Re-run with --write to fill them in.');
} else {
	const after = await allKeys();
	const added = after.filter((k) => !before.has(k));
	console.log(`${done} request(s) sent, ${added.length} new row(s) written:`);
	for (const key of added) console.log(`  ${key}`);
	console.log(`\n${skipped.length} skipped, ${failed.length} failed.`);
}
for (const [label, why] of failed) console.log(`  failed: ${label} — ${why}`);

await vite.close();
