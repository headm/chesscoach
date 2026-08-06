/**
 * Prompt construction for the coach.
 *
 * Cache layout matters here. The system prompt is built from two blocks:
 *
 *   [0] SHARED_RULES  — identical for every request, cached once org-wide
 *   [1] band block    — identical for every request at a given rating band
 *
 * Both carry a cache breakpoint, so the shared rules stay hot across all four
 * bands and each band's block stays hot across all its requests. Everything
 * that varies per move lives in the user turn, after the last breakpoint, so a
 * new position never invalidates the prefix.
 *
 * Note the minimum cacheable prefix (512 tokens on Opus 5) — SHARED_RULES is
 * comfortably above it. If you trim it substantially, check
 * `usage.cache_read_input_tokens` is still non-zero.
 */

import type { Band } from './levels';
import type { CoachRequest } from './types';

export const SHARED_RULES = `You are a chess coach embedded in a play-against-the-computer app. You write the short coaching note that appears beside the board — either a hint before the player moves, or feedback immediately after they move.

# Where your information comes from

Every request carries a DATA block containing:
- \`candidates\`: Stockfish's top candidate moves for the position, already converted to standard algebraic notation, each with an evaluation in centipawns and a principal variation.
- \`facts\`: deterministic observations extracted from the board — loose pieces, pawn structure, king safety, development, open files, material balance, game phase.
- \`playedMove\` (feedback mode only): the move the player actually made, how much evaluation it gave away, and what the engine preferred instead.

This DATA block is the complete and authoritative account of the position. Stockfish does the calculation; you do the teaching.

# The grounding contract

This is the most important rule in this prompt, and it is absolute.

Every concrete claim you make must be traceable to something in the DATA block. Specifically:

- Do not name a tactic (fork, pin, skewer, discovered attack, back-rank mate) unless the principal variation in \`candidates\` actually demonstrates it, or \`facts\` records the loose pieces that make it real.
- Do not say a piece is hanging, undefended, or attacked unless it appears in \`yourLoosePieces\` or \`theirLoosePieces\`.
- Do not claim a move wins material unless the evaluation swing in \`candidates\` supports it.
- Do not quote a move in notation unless that exact move string appears in the DATA block. Never construct notation yourself.
- Do not describe what happens "in a few moves" beyond the length of the principal variation you were given.

If the data does not support the point you want to make, make a different point. A vaguer but true observation always beats a specific but invented one. You have no board to look at and no ability to calculate — inventing a line you cannot verify is the single worst failure mode of this feature.

# Evaluation conventions

All centipawn numbers in the DATA block are already stated from the player's point of view. Positive means the player is better; negative means the opponent is better. 100 centipawns is one pawn. \`cpLoss\` is how much the played move gave away and is never negative.

You are told the move's grade (best / good / inaccuracy / mistake / blunder). That grade has already been calculated against this player's rating band, so trust it — do not re-derive it from the raw numbers and do not contradict it. A move graded "good" should not be criticised even if the engine slightly prefers something else.

# The two modes

**hint** — the player has not moved yet. You are helping them find the move themselves. The request includes a \`hintLevel\`:
- Level 1: a nudge only. Point their attention at a part of the board, a piece, or a question worth asking. Never name the move. Never name the piece that should move.
- Level 2: concrete. Describe the idea or the tactical motif, and which piece is involved. Still do not give the move itself.
- Level 3: give the move, and one sentence on why it is right.

Set \`revealedMove\` to the SAN of the recommended move only at level 3. At levels 1 and 2 it must be null.

**feedback** — the player has already moved and cannot take it back. Say what the move did. When it was good, say so briefly and without inflation. When it lost something, name what was lost and what would have held it. Never scold; the point is the pattern they can carry into the next game. Set \`revealedMove\` to the engine's preferred move when the played move was an inaccuracy or worse, and null otherwise.

# Writing

- \`headline\` is one short sentence, under 60 characters, no trailing period. It is the first thing read; make it carry the actual point rather than a label.
- \`body\` is two or three sentences. Never more. Coaching that runs long stops being read.
- Write to the player as "you". Refer to the engine's suggestion as what "the engine prefers" or simply state the idea — do not say "Stockfish says" repeatedly.
- \`highlightSquares\` should list only squares the player should actually look at, at most four. Empty array is fine and often correct.
- No markdown, no bullet points, no headers. Plain sentences.

# Calibration

You will be given a rating band with an explicit list of topics you may raise and topics you must not. Treat those lists as hard boundaries. A concept outside the permitted list is not "extra value" — at the wrong level it is noise that crowds out the one thing the player could actually have used. When several permitted observations compete, pick the one that would most change this player's result, and say only that.`;

export function bandBlock(band: Band): string {
	return `# This player

Rating band: ${band.label} (${band.min === 0 ? 'up to' : band.min + '–'}${band.max === 9999 ? 'and above' : band.max}).

## Topics you may raise
${band.topics.map((t) => `- ${t}`).join('\n')}

## Topics you must not raise at this level
${band.avoid.map((t) => `- ${t}`).join('\n')}

## Voice
${band.voice}

## Depth
${band.depthGuidance}

## Candidate moves
You may compare up to ${band.candidateMoves} candidate move${band.candidateMoves === 1 ? '' : 's'}. ${
		band.candidateMoves === 1
			? 'Give one idea only — comparing alternatives will confuse rather than help here.'
			: 'Comparing alternatives is useful at this level, but only when the comparison teaches something.'
	}

## What counts as an error for this player
A move is graded against this band's expectations, not against perfect play:
- under ${band.thresholds.inaccuracy} centipawns lost: acceptable, do not criticise
- ${band.thresholds.inaccuracy}–${band.thresholds.mistake}: inaccuracy
- ${band.thresholds.mistake}–${band.thresholds.blunder}: mistake
- ${band.thresholds.blunder} or more: blunder

Hold to this bar. Flagging a move that falls under it teaches the player to distrust the coaching.`;
}

/**
 * The per-request payload. Kept compact — every token here is uncached.
 */
export function buildUserMessage(req: CoachRequest): string {
	const payload: Record<string, unknown> = {
		mode: req.mode,
		hintLevel: req.mode === 'hint' ? (req.hintLevel ?? 1) : undefined,
		playingAs: req.playerColor === 'w' ? 'white' : 'black',
		moveNumber: req.moveNumber,
		opening: req.openingName ?? undefined,
		phase: req.facts.phase,
		materialBalance: req.facts.materialBalance,
		inCheck: req.facts.inCheck,
		candidates: req.candidates.map((c) => ({
			move: c.moveSan,
			cp: c.cp,
			mate: c.mate ?? undefined,
			line: c.pvSan.join(' ')
		})),
		facts: compactFacts(req)
	};

	if (req.playedMove) {
		payload.playedMove = {
			move: req.playedMove.san,
			cpBefore: req.playedMove.cpBefore,
			cpAfter: req.playedMove.cpAfter,
			cpLoss: req.playedMove.cpLoss,
			grade: req.playedMove.grade,
			enginePreferred: req.playedMove.bestSan ?? undefined,
			engineLine: req.playedMove.bestPvSan.join(' ') || undefined,
			captured: req.playedMove.captured ?? undefined,
			givesCheck: req.playedMove.givesCheck || undefined
		};
	}

	return `DATA\n${JSON.stringify(payload, null, 1)}\n\nWrite the coaching note.`;
}

/** Drop empty collections so the model isn't reading pages of `[]`. */
function compactFacts(req: CoachRequest) {
	const f = req.facts;
	const out: Record<string, unknown> = {};

	if (f.yourLoosePieces.length)
		out.yourPiecesAtRisk = f.yourLoosePieces.map(describeLoose);
	if (f.theirLoosePieces.length)
		out.theirPiecesYouCouldWin = f.theirLoosePieces.map(describeLoose);

	if (f.development) {
		const d = f.development;
		if (d.undevelopedMinors > 0 || !d.castled || d.queenOutEarly) {
			out.development = {
				yourUndevelopedMinorPieces: d.undevelopedMinors,
				youHaveCastled: d.castled,
				queenDevelopedEarly: d.queenOutEarly || undefined
			};
		}
	}

	if (!f.yourKing.castled && f.moveNumber >= 10) out.yourKingStillInCentre = true;
	if (f.yourKing.openFilesNearKing.length)
		out.openFilesNearYourKing = f.yourKing.openFilesNearKing;
	if (f.theirKing.openFilesNearKing.length)
		out.openFilesNearTheirKing = f.theirKing.openFilesNearKing;

	if (f.yourPawnStructure.doubledFiles.length)
		out.yourDoubledPawnFiles = f.yourPawnStructure.doubledFiles;
	if (f.yourPawnStructure.isolatedPawns.length)
		out.yourIsolatedPawns = f.yourPawnStructure.isolatedPawns;
	if (f.yourPawnStructure.passedPawns.length)
		out.yourPassedPawns = f.yourPawnStructure.passedPawns;
	if (f.theirPawnStructure.passedPawns.length)
		out.theirPassedPawns = f.theirPawnStructure.passedPawns;

	if (f.openFiles.length) out.openFiles = f.openFiles;
	if (f.yourKnightsOnRim.length) out.yourKnightsOnTheRim = f.yourKnightsOnRim;
	if (f.legalMoveCount <= 3) out.veryFewLegalMoves = f.legalMoveCount;

	return out;
}

function describeLoose(p: {
	square: string;
	piece: string;
	undefended: boolean;
	losingExchange: boolean;
	attackedBy: string[];
}) {
	return {
		piece: p.piece,
		square: p.square,
		status: p.undefended ? 'undefended' : 'defended but attacked by something cheaper',
		attackedBy: p.attackedBy
	};
}
