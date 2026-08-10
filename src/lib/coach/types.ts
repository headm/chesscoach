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
	/*
	 * No move number: it varies between transpositions to the same position and
	 * would split the response cache for no benefit. See `buildUserMessage`.
	 */
	openingName: string | null;
	candidates: CandidateLine[];
	facts: PositionFacts;
	/** Only present for `feedback`. */
	playedMove?: PlayedMoveInfo;
	/** Only meaningful for `hint`: 1 = nudge, 2 = concrete, 3 = tell me the move. */
	hintLevel?: 1 | 2 | 3;
}

export interface CoachResponse {
	/**
	 * One short line, shown bold at the top of a hint card.
	 *
	 * Absent in feedback mode: that card is titled with the move's grade, which
	 * the app computes itself, so there is no headline to write and the schema
	 * for that mode does not ask for one.
	 */
	headline?: string;
	/** The actual coaching. Two or three sentences at most. */
	body: string;
	/** Squares worth lighting up on the board. May be empty. */
	highlightSquares: string[];
	/** Populated only when the coach is allowed to give the move away. */
	revealedMove: string | null;
	/** True when this came from the heuristic fallback rather than Claude. */
	fallback?: boolean;
}

/*
 * JSON schema handed to the API as a structured-output constraint.
 *
 * Note the API's schema restrictions: every object needs
 * `additionalProperties: false` and a complete `required` list, and string
 * length/pattern constraints are not supported.
 */

const BODY = {
	type: 'string',
	description:
		'The coaching itself. Two or three sentences maximum, in the voice specified for this rating band.'
} as const;

const HIGHLIGHT_SQUARES = {
	type: 'array',
	items: { type: 'string' },
	description:
		'Algebraic squares to highlight on the board, e.g. ["e5","c4"]. Empty array if nothing specific. Never more than 4.'
} as const;

const REVEALED_MOVE = {
	type: ['string', 'null'],
	description:
		'The recommended move in SAN, but only when the instructions permit revealing it. Otherwise null.'
} as const;

/** Hints are titled by a line the model writes. */
const HINT_SCHEMA = {
	type: 'object',
	properties: {
		headline: {
			type: 'string',
			description: 'A single short sentence, under 60 characters. No trailing period.'
		},
		body: BODY,
		highlightSquares: HIGHLIGHT_SQUARES,
		revealedMove: REVEALED_MOVE
	},
	required: ['headline', 'body', 'highlightSquares', 'revealedMove'],
	additionalProperties: false
} as const;

/**
 * Feedback has no headline field at all.
 *
 * That card is titled with the move's grade, which is computed from the
 * evaluation rather than written. Asking for a headline anyway would be asking
 * the model to write something the prompt has already told it is never shown —
 * a contradiction between the schema and the instructions, and tokens spent on
 * output that is thrown away.
 */
const FEEDBACK_SCHEMA = {
	type: 'object',
	properties: {
		body: BODY,
		highlightSquares: HIGHLIGHT_SQUARES,
		revealedMove: REVEALED_MOVE
	},
	required: ['body', 'highlightSquares', 'revealedMove'],
	additionalProperties: false
} as const;

export function coachSchema(mode: CoachMode) {
	return mode === 'hint' ? HINT_SCHEMA : FEEDBACK_SCHEMA;
}
