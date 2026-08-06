/**
 * Mapping a target ELO onto Stockfish settings.
 *
 * Stockfish's own UCI_Elo floor is ~1320 (SF 16+). Below that we fall back to
 * `Skill Level` plus deliberate weak-move selection, because a throttled engine
 * otherwise plays near-perfectly and then hangs a rook at random — which reads
 * as "cheating computer" rather than "1000-rated human".
 *
 * This module is intentionally the only place that knows about engine internals.
 * Swapping in Maia (human-like Leela weights) later means replacing
 * `pickOpponentMove` and nothing else.
 */

import type { EngineLine } from './uci';

export const UCI_ELO_FLOOR = 1320;
export const UCI_ELO_CEILING = 3190;

export interface OpponentConfig {
	/** UCI options to apply to the opponent engine instance. */
	options: Record<string, string | number | boolean>;
	/** Milliseconds to think. Kept low so the game feels responsive. */
	movetime: number;
	/** How many candidate lines to generate so we can pick a weaker one. */
	multipv: number;
	/**
	 * Probability of *not* playing the engine's top choice. Scales inversely with
	 * rating, and is zero once UCI_Elo can do the throttling honestly.
	 */
	weakMoveChance: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function opponentConfig(elo: number): OpponentConfig {
	if (elo >= UCI_ELO_FLOOR) {
		return {
			options: {
				UCI_LimitStrength: true,
				UCI_Elo: clamp(Math.round(elo), UCI_ELO_FLOOR, UCI_ELO_CEILING),
				MultiPV: 1
			},
			// Stronger opponents get a little more time — it reads as "thinking".
			movetime: clamp(Math.round(200 + (elo - UCI_ELO_FLOOR) * 0.35), 200, 900),
			multipv: 1,
			weakMoveChance: 0
		};
	}

	// Sub-1320: Skill Level 0-20 is coarse but monotonic. Map 600->0, 1300->8.
	const skill = clamp(Math.round(((elo - 600) / 700) * 8), 0, 8);

	// 600 -> ~0.38, 1300 -> ~0.10. This is what produces the occasional real
	// blunder instead of uniformly mediocre play.
	const weakMoveChance = clamp(0.38 - ((elo - 600) / 700) * 0.28, 0.08, 0.45);

	return {
		options: {
			'Skill Level': skill,
			UCI_LimitStrength: false,
			MultiPV: 3
		},
		movetime: 250,
		multipv: 3,
		weakMoveChance
	};
}

/**
 * Choose the opponent's move from its candidate lines.
 *
 * With `weakMoveChance` probability we take the 2nd or 3rd line instead of the
 * best one — weighted so the 2nd choice is far likelier than the 3rd.
 */
export function pickOpponentMove(lines: EngineLine[], cfg: OpponentConfig, rng = Math.random): string {
	const sorted = [...lines].sort((a, b) => a.multipv - b.multipv);
	if (sorted.length === 0) throw new Error('engine returned no candidate lines');
	if (sorted.length === 1 || rng() >= cfg.weakMoveChance) return sorted[0].moveUci;

	// 70% second-best, 30% third-best (when a third exists).
	if (sorted.length >= 3 && rng() > 0.7) return sorted[2].moveUci;
	return sorted[1].moveUci;
}

/**
 * Analysis settings for the coach. Always full strength — the coaching must be
 * correct even when the opponent is playing at 800.
 */
export const ANALYST_OPTIONS = {
	UCI_LimitStrength: false,
	'Skill Level': 20
} as const;

export const ANALYST_DEPTH = 14;
