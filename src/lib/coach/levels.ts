/**
 * The ELO layer.
 *
 * A single band definition drives three things at once:
 *   1. how strong the engine opponent plays        (see engine/strength.ts)
 *   2. which findings the coach is allowed to raise (`topics`)
 *   3. how a move is graded                         (`thresholds`)
 *
 * Keeping them in one table is deliberate: a 1000 player and a 1900 player
 * should get different opponents *and* different lessons *and* a different
 * definition of "that was a bad move".
 */

export type BandId = 'beginner' | 'developing' | 'intermediate' | 'advanced';

/**
 * Centipawn-loss bands. One hard rule across every level: `inaccuracy` must sit
 * BELOW 100. A clean pawn loss is worth ~100cp, and "you just dropped a pawn"
 * is worth saying to a 900 player and a 2200 player alike — only the wording
 * should differ. Setting the beginner bar above a pawn (it was 120) makes the
 * coach call the Wing Gambit "a good move", which is exactly the kind of thing
 * that teaches players to stop trusting it.
 */
export interface Thresholds {
	/** Centipawn loss at or above which a move is called an inaccuracy. */
	inaccuracy: number;
	mistake: number;
	blunder: number;
}

export interface Band {
	id: BandId;
	label: string;
	/** Inclusive lower bound. The last band absorbs everything above it. */
	min: number;
	max: number;
	thresholds: Thresholds;
	/** Concepts the coach may talk about. Anything outside this list is noise at this level. */
	topics: string[];
	/** Concepts explicitly held back — mentioning them would overwhelm. */
	avoid: string[];
	/** How many candidate moves to compare when giving a hint. */
	candidateMoves: number;
	/** Register + vocabulary guidance handed to the model verbatim. */
	voice: string;
	/** How much of the engine line to reveal. */
	depthGuidance: string;
}

export const BANDS: Band[] = [
	{
		id: 'beginner',
		label: 'Beginner',
		min: 0,
		max: 1099,
		thresholds: { inaccuracy: 90, mistake: 200, blunder: 350 },
		topics: [
			'pieces that can be captured for free (yours and theirs)',
			'one-move tactics: forks, pins, skewers, back-rank mates',
			'getting out of check safely',
			'basic checkmate patterns',
			'counting material before trading'
		],
		avoid: [
			'pawn structure',
			'prophylaxis',
			'long-term positional compensation',
			'move-order subtleties',
			'opening theory beyond "develop and castle"'
		],
		candidateMoves: 1,
		voice:
			'Warm and encouraging. Plain English only — no chess jargon unless you define it in the same sentence. One idea per response, never two. Assume the player still loses pieces by accident and that is the single most valuable thing to fix.',
		depthGuidance:
			'Look exactly one move ahead. Say what happens immediately after the move, never a five-move line.'
	},
	{
		id: 'developing',
		label: 'Developing',
		min: 1100,
		max: 1449,
		thresholds: { inaccuracy: 70, mistake: 150, blunder: 280 },
		topics: [
			'hanging pieces and loose pieces',
			'two-move tactics and simple combinations',
			'development, castling early, not moving the same piece twice',
			'controlling the centre',
			'king safety once the centre opens',
			'simple endgame technique (king activity, passed pawns)'
		],
		avoid: ['deep positional imbalances', 'prophylaxis', 'subtle move-order points'],
		candidateMoves: 2,
		voice:
			'Direct and practical. Standard chess terms are fine (development, centre, outpost) but explain anything more advanced. Two ideas maximum. Point out the pattern, not just the move — the player should recognise it next game.',
		depthGuidance:
			'Two to three ply. You may compare the best move against the played move, but keep lines short.'
	},
	{
		id: 'intermediate',
		label: 'Intermediate',
		min: 1450,
		max: 1799,
		thresholds: { inaccuracy: 50, mistake: 110, blunder: 220 },
		topics: [
			'candidate move comparison',
			'pawn structure: doubled, isolated, backward, passed pawns',
			'piece activity and bad bishops',
			'open and semi-open files for rooks',
			'when to trade and when to avoid trades',
			'king safety and attacking chances',
			'plans, not just moves'
		],
		avoid: ['spoon-feeding one-move tactics the player would spot unaided'],
		candidateMoves: 3,
		voice:
			'Peer-level and analytical. Assume full standard vocabulary. Compare candidate moves rather than announcing a single answer. Ask the player a pointed question when it would sharpen their thinking.',
		depthGuidance:
			'Three to four ply. Give the critical line when it changes the assessment, and say what the resulting position is like.'
	},
	{
		id: 'advanced',
		label: 'Advanced',
		min: 1800,
		max: 9999,
		thresholds: { inaccuracy: 35, mistake: 80, blunder: 170 },
		topics: [
			'imbalances and long-term compensation',
			'prophylaxis and preventing counterplay',
			'precise move order',
			'small evaluation differences between near-equal moves',
			'typical middlegame plans arising from the structure',
			'concrete endgame evaluation'
		],
		avoid: ['restating anything obvious', 'praise for routine moves'],
		candidateMoves: 3,
		voice:
			'Terse. Assume everything. No praise for finding the obvious. Lead with the disagreement or the subtlety — if the engine prefers something by 0.3, say why in one sentence and give the line.',
		depthGuidance:
			'Full principal variation where it matters. Cite evaluations numerically; the player can read them.'
	}
];

export function bandFor(elo: number): Band {
	return BANDS.find((b) => elo >= b.min && elo <= b.max) ?? BANDS[BANDS.length - 1];
}

export type MoveGrade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/**
 * Grade a move against the *band's* expectation, not against Stockfish.
 * An 80cp slip is a perfectly reasonable move for a 900 player and a real
 * error for a 1900 player, and the app should say so.
 */
export function gradeMove(cpLoss: number, band: Band): MoveGrade {
	const t = band.thresholds;
	if (cpLoss <= 10) return 'best';
	if (cpLoss < t.inaccuracy) return 'good';
	if (cpLoss < t.mistake) return 'inaccuracy';
	if (cpLoss < t.blunder) return 'mistake';
	return 'blunder';
}

export const GRADE_LABEL: Record<MoveGrade, string> = {
	best: 'Best move',
	good: 'Good move',
	inaccuracy: 'Inaccuracy',
	mistake: 'Mistake',
	blunder: 'Blunder'
};

export const GRADE_COLOR: Record<MoveGrade, string> = {
	best: 'text-emerald-400',
	good: 'text-emerald-300',
	inaccuracy: 'text-amber-300',
	mistake: 'text-orange-400',
	blunder: 'text-red-400'
};
