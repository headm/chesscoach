/**
 * The engine endpoint. Everything Stockfish-shaped happens behind here.
 *
 * Two operations, deliberately coarse:
 *   analyse       — full-strength MultiPV analysis, used for evaluation,
 *                   move grading and the coach's candidate list
 *   opponent-move — one move at the player's rating
 *
 * The client never picks a depth, a MultiPV count or a skill level. Those are
 * server-side constants precisely so a hostile client cannot ask for `go depth
 * 40` on a shared process.
 */

import { Chess } from 'chess.js';
import { error, json, type RequestHandler } from '@sveltejs/kit';

import { getEngine } from '$lib/server/engine/stockfish';
import {
	ANALYST_DEPTH,
	ANALYST_OPTIONS,
	opponentConfig,
	pickOpponentMove
} from '$lib/engine/strength';

/** Candidate lines the coach can be shown. The widest band asks for 3. */
const ANALYST_MULTIPV = 3;

const ELO_MIN = 400;
const ELO_MAX = 2800;

/**
 * Re-serialise the FEN through chess.js before it reaches the engine.
 *
 * This is the injection boundary. UCI is newline-delimited, so a "FEN"
 * containing a newline would let a caller append arbitrary engine commands to
 * `position fen ...`. Parsing and re-emitting means only chess.js's own output
 * is ever sent.
 */
function safeFen(value: unknown): { fen: string; chess: Chess } {
	if (typeof value !== 'string' || value.length > 120) error(400, 'invalid fen');
	try {
		const chess = new Chess(value);
		return { fen: chess.fen(), chess };
	} catch {
		error(400, 'invalid fen');
	}
}

function safeElo(value: unknown): number {
	const elo = Number(value);
	if (!Number.isFinite(elo)) error(400, 'invalid elo');
	return Math.min(ELO_MAX, Math.max(ELO_MIN, Math.round(elo)));
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { op?: string; fen?: unknown; elo?: unknown };
	const { fen, chess } = safeFen(body.fen);

	// A finished position has no move to make and nothing to evaluate; the
	// engine would sit there until the timeout.
	if (chess.isGameOver()) return json({ lines: [], uci: null });

	const engine = getEngine();

	if (body.op === 'analyse') {
		const lines = await engine.analyse(fen, {
			multipv: ANALYST_MULTIPV,
			depth: ANALYST_DEPTH,
			options: ANALYST_OPTIONS
		});
		return json({ lines });
	}

	if (body.op === 'opponent-move') {
		const cfg = opponentConfig(safeElo(body.elo));
		const lines = await engine.analyse(fen, {
			multipv: cfg.multipv,
			movetime: cfg.movetime,
			options: cfg.options
		});
		if (lines.length === 0) error(502, 'engine returned no move');
		return json({ uci: pickOpponentMove(lines, cfg) });
	}

	error(400, 'unknown op');
};
