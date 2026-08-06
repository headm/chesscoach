import type { PositionFacts } from '$lib/chess/facts';
import type { MoveGrade } from './levels';

/** One engine candidate, already normalised and converted to SAN. */
export interface CandidateLine {
	rank: number;
	moveSan: string;
	moveUci: string;
	/** Centipawns from the player's point of view. Positive = good for the player. */
	cp: number;
	mate: number | null;
	/** Principal variation in SAN, truncated. */
	pvSan: string[];
}

export interface PlayedMoveInfo {
	san: string;
	uci: string;
	/** Eval before the move, player's POV. */
	cpBefore: number;
	/** Eval after the move, player's POV. */
	cpAfter: number;
	/** How much the move gave away, in centipawns. Never negative. */
	cpLoss: number;
	grade: MoveGrade;
	/** The move the engine preferred, if different. */
	bestSan: string | null;
	bestPvSan: string[];
	captured: string | null;
	givesCheck: boolean;
}

export type CoachMode = 'hint' | 'feedback';

export interface CoachRequest {
	mode: CoachMode;
	playerElo: number;
	playerColor: 'w' | 'b';
	fen: string;
	moveNumber: number;
	openingName: string | null;
	candidates: CandidateLine[];
	facts: PositionFacts;
	/** Only present for `feedback`. */
	playedMove?: PlayedMoveInfo;
	/** Only meaningful for `hint`: 1 = nudge, 2 = concrete, 3 = tell me the move. */
	hintLevel?: 1 | 2 | 3;
}

export interface CoachResponse {
	/** One short line, shown bold at the top of the card. */
	headline: string;
	/** The actual coaching. Two or three sentences at most. */
	body: string;
	/** Squares worth lighting up on the board. May be empty. */
	highlightSquares: string[];
	/** Populated only when the coach is allowed to give the move away. */
	revealedMove: string | null;
	/** True when this came from the heuristic fallback rather than Claude. */
	fallback?: boolean;
}

/**
 * JSON schema handed to the API as a structured-output constraint.
 * Note the API's schema restrictions: every object needs
 * `additionalProperties: false` and a complete `required` list, and string
 * length/pattern constraints are not supported.
 */
export const COACH_SCHEMA = {
	type: 'object',
	properties: {
		headline: {
			type: 'string',
			description: 'A single short sentence, under 60 characters. No trailing period.'
		},
		body: {
			type: 'string',
			description:
				'The coaching itself. Two or three sentences maximum, in the voice specified for this rating band.'
		},
		highlightSquares: {
			type: 'array',
			items: { type: 'string' },
			description:
				'Algebraic squares to highlight on the board, e.g. ["e5","c4"]. Empty array if nothing specific. Never more than 4.'
		},
		revealedMove: {
			type: ['string', 'null'],
			description:
				'The recommended move in SAN, but only when the instructions permit revealing it. Otherwise null.'
		}
	},
	required: ['headline', 'body', 'highlightSquares', 'revealedMove'],
	additionalProperties: false
} as const;
