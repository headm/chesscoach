/**
 * Heuristic coach — used when ANTHROPIC_API_KEY is not configured.
 *
 * This is deliberately kept: it makes the app runnable without credentials, and
 * it doubles as the failure path if the API call errors or times out mid-game.
 * It is noticeably more robotic than the model-backed coach, which is the whole
 * argument for the model-backed coach.
 */

import { bandFor, type Band } from './levels';
import type { CoachRequest, CoachResponse } from './types';

export function heuristicCoach(req: CoachRequest): CoachResponse {
	const band = bandFor(req.playerElo);
	return req.mode === 'hint' ? hint(req, band) : feedback(req, band);
}

function hint(req: CoachRequest, band: Band): CoachResponse {
	const level = req.hintLevel ?? 1;
	const best = req.candidates[0];
	const theirs = req.facts.theirLoosePieces[0];
	const yours = req.facts.yourLoosePieces[0];

	if (level >= 3 && best) {
		return {
			headline: `Play ${best.moveSan}`,
			body: `The engine's choice is ${best.moveSan}${
				best.pvSan.length > 1 ? `, with the line continuing ${best.pvSan.slice(0, 4).join(' ')}` : ''
			}. It evaluates the position at ${fmt(best.cp)} after it.`,
			highlightSquares: [best.moveUci.slice(0, 2), best.moveUci.slice(2, 4)],
			revealedMove: best.moveSan,
			fallback: true
		};
	}

	if (yours) {
		return {
			headline: `Your ${yours.piece} on ${yours.square} is in danger`,
			body:
				level >= 2
					? `It is ${yours.undefended ? 'undefended' : 'attacked by a cheaper piece'} and can be taken by ${yours.attackedBy.join(' or ')}. Move it, defend it, or create a bigger threat.`
					: `Before you commit to a plan, check whether every one of your pieces is safe.`,
			highlightSquares: [yours.square],
			revealedMove: null,
			fallback: true
		};
	}

	if (theirs) {
		return {
			headline: `Something of theirs is loose on ${theirs.square}`,
			body:
				level >= 2
					? `Their ${theirs.piece} on ${theirs.square} is ${theirs.undefended ? 'undefended' : 'underdefended'}. Look for a way to attack it — or take it, if you can do so safely.`
					: `Scan the opponent's pieces before you move. One of them is not as safe as it looks.`,
			highlightSquares: [theirs.square],
			revealedMove: null,
			fallback: true
		};
	}

	if (req.facts.development && req.facts.development.undevelopedMinors > 0) {
		return {
			headline: 'Finish developing',
			body: `You still have ${req.facts.development.undevelopedMinors} minor piece${
				req.facts.development.undevelopedMinors === 1 ? '' : 's'
			} on the back rank${req.facts.development.castled ? '' : ' and your king has not castled'}. Getting them out is worth more than any single attacking idea right now.`,
			highlightSquares: [],
			revealedMove: null,
			fallback: true
		};
	}

	return {
		headline: 'No immediate tactics — improve a piece',
		body: `Nothing is hanging for either side. Find your worst-placed piece and give it a better square${
			req.facts.openFiles.length && band.id !== 'beginner'
				? `; the ${req.facts.openFiles.join(' and ')} file${req.facts.openFiles.length === 1 ? ' is' : 's are'} open for a rook`
				: ''
		}.`,
		highlightSquares: [],
		revealedMove: null,
		fallback: true
	};
}

/*
 * No headline on any of these: the feedback card is titled with the move's
 * grade, which is computed rather than written, so a headline here would be
 * text nothing renders. The body has to stand on its own, exactly as the
 * model-backed prompt requires of it.
 */
function feedback(req: CoachRequest, band: Band): CoachResponse {
	const m = req.playedMove;
	if (!m) {
		return {
			body: 'No analysis available for this move.',
			highlightSquares: [],
			revealedMove: null,
			fallback: true
		};
	}

	if (m.grade === 'best') {
		return {
			body: `That is exactly what the engine plays here. The position is now ${fmt(m.cpAfter)} from your side.`,
			highlightSquares: [],
			revealedMove: null,
			fallback: true
		};
	}

	if (m.grade === 'good') {
		return {
			body: `It keeps the evaluation at ${fmt(m.cpAfter)}. ${
				m.bestSan && m.bestSan !== m.san && band.id !== 'beginner'
					? `The engine marginally prefers ${m.bestSan}, but the difference is not something to worry about at this level.`
					: 'Nothing to fix here.'
			}`,
			highlightSquares: [],
			revealedMove: null,
			fallback: true
		};
	}

	const lost = (m.cpLoss / 100).toFixed(1);
	const risk = req.facts.yourLoosePieces[0];
	const label =
		m.grade === 'blunder' ? 'a blunder' : m.grade === 'mistake' ? 'a mistake' : 'an inaccuracy';

	return {
		body: `The evaluation moved from ${fmt(m.cpBefore)} to ${fmt(m.cpAfter)}.${
			m.bestSan ? ` ${m.bestSan} was the move${m.bestPvSan.length > 1 ? `, with ${m.bestPvSan.slice(0, 4).join(' ')} to follow` : ''}.` : ''
		}${risk ? ` Your ${risk.piece} on ${risk.square} is now loose.` : ''}`,
		highlightSquares: risk ? [risk.square] : [],
		revealedMove: m.bestSan,
		fallback: true
	};
}

function fmt(cp: number): string {
	const pawns = cp / 100;
	return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
