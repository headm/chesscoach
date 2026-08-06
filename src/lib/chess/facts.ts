/**
 * Structured facts about a position, derived deterministically from the board.
 *
 * These are the *only* concrete claims the coach is allowed to make. Stockfish
 * supplies the evaluation, this file supplies the observations, and the model's
 * job is to decide which of them matter at the player's level and how to say
 * it. That split is what stops the coach confidently describing a fork that
 * isn't on the board.
 */

import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<PieceSymbol, string> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
	k: 'king'
};

export interface LoosePiece {
	square: Square;
	piece: string;
	value: number;
	/** No friendly piece defends it. */
	undefended: boolean;
	/** The cheapest attacker is worth less than the piece — a losing exchange. */
	losingExchange: boolean;
	attackedBy: string[];
}

export interface PawnStructure {
	doubledFiles: string[];
	isolatedPawns: Square[];
	passedPawns: Square[];
}

export interface KingSafety {
	square: Square | null;
	castled: boolean;
	/** Pawns remaining on the king's file and its two neighbours. */
	shieldPawns: number;
	/** Files adjacent to the king with no pawns of either colour. */
	openFilesNearKing: string[];
}

export interface DevelopmentInfo {
	undevelopedMinors: number;
	castled: boolean;
	queenOutEarly: boolean;
}

export interface PositionFacts {
	fen: string;
	sideToMove: Color;
	moveNumber: number;
	phase: 'opening' | 'middlegame' | 'endgame';
	inCheck: boolean;
	legalMoveCount: number;
	materialBalance: number;
	/** Player's pieces that can be won. */
	yourLoosePieces: LoosePiece[];
	/** Opponent pieces the player could win. */
	theirLoosePieces: LoosePiece[];
	yourPawnStructure: PawnStructure;
	theirPawnStructure: PawnStructure;
	yourKing: KingSafety;
	theirKing: KingSafety;
	development: DevelopmentInfo | null;
	/** Files with no pawns at all — rook targets. */
	openFiles: string[];
	yourKnightsOnRim: Square[];
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

function allPieces(chess: Chess, color: Color) {
	const out: { square: Square; type: PieceSymbol }[] = [];
	for (const row of chess.board()) {
		for (const sq of row) {
			if (sq && sq.color === color) out.push({ square: sq.square, type: sq.type });
		}
	}
	return out;
}

/**
 * Static-exchange-lite: a piece is "loose" if it is attacked and either
 * undefended, or attacked by something cheaper than itself.
 *
 * This deliberately does not simulate the full capture sequence. It catches the
 * overwhelming majority of what actually loses material at club level, and
 * anything subtler will show up in the engine evaluation instead.
 */
export function loosePieces(chess: Chess, color: Color): LoosePiece[] {
	const enemy = other(color);
	const out: LoosePiece[] = [];

	for (const { square, type } of allPieces(chess, color)) {
		if (type === 'k') continue;
		const attackers = chess.attackers(square, enemy);
		if (attackers.length === 0) continue;

		const defenders = chess.attackers(square, color).filter((s) => s !== square);
		const attackerTypes = attackers.map((s) => chess.get(s)?.type).filter(Boolean) as PieceSymbol[];
		const cheapestAttacker = Math.min(...attackerTypes.map((t) => PIECE_VALUE[t] || 99));
		const value = PIECE_VALUE[type];

		const undefended = defenders.length === 0;
		const losingExchange = cheapestAttacker < value;
		if (!undefended && !losingExchange) continue;

		out.push({
			square,
			piece: PIECE_NAME[type],
			value,
			undefended,
			losingExchange,
			attackedBy: attackerTypes.map((t) => PIECE_NAME[t])
		});
	}

	// Most valuable first — that's the one worth talking about.
	return out.sort((a, b) => b.value - a.value);
}

export function pawnStructure(chess: Chess, color: Color): PawnStructure {
	const pawns = allPieces(chess, color).filter((p) => p.type === 'p');
	const enemyPawns = allPieces(chess, other(color)).filter((p) => p.type === 'p');
	const fileOf = (sq: Square) => sq[0];
	const rankOf = (sq: Square) => Number(sq[1]);

	const byFile = new Map<string, Square[]>();
	for (const p of pawns) {
		const f = fileOf(p.square);
		byFile.set(f, [...(byFile.get(f) ?? []), p.square]);
	}

	const doubledFiles = [...byFile.entries()].filter(([, sqs]) => sqs.length > 1).map(([f]) => f);

	const isolatedPawns: Square[] = [];
	const passedPawns: Square[] = [];

	for (const p of pawns) {
		const f = fileOf(p.square);
		const fi = FILES.indexOf(f);
		const neighbours = [FILES[fi - 1], FILES[fi + 1]].filter(Boolean);

		if (!neighbours.some((n) => byFile.has(n))) isolatedPawns.push(p.square);

		const forward = color === 'w' ? 1 : -1;
		const rank = rankOf(p.square);
		const blockers = enemyPawns.filter((e) => {
			const ef = fileOf(e.square);
			if (ef !== f && !neighbours.includes(ef)) return false;
			const er = rankOf(e.square);
			return forward === 1 ? er > rank : er < rank;
		});
		if (blockers.length === 0) passedPawns.push(p.square);
	}

	return { doubledFiles, isolatedPawns, passedPawns };
}

export function kingSafety(chess: Chess, color: Color): KingSafety {
	const king = allPieces(chess, color).find((p) => p.type === 'k');
	if (!king) return { square: null, castled: false, shieldPawns: 0, openFilesNearKing: [] };

	const sq = king.square;
	const f = sq[0];
	const fi = FILES.indexOf(f);
	const nearFiles = [FILES[fi - 1], f, FILES[fi + 1]].filter(Boolean);

	const ownPawns = allPieces(chess, color).filter((p) => p.type === 'p');
	const allPawns = [...ownPawns, ...allPieces(chess, other(color)).filter((p) => p.type === 'p')];

	const shieldPawns = ownPawns.filter((p) => nearFiles.includes(p.square[0])).length;
	const openFilesNearKing = nearFiles.filter((nf) => !allPawns.some((p) => p.square[0] === nf));

	const homeSquare = color === 'w' ? 'e1' : 'e8';
	const castledSquares = color === 'w' ? ['g1', 'c1', 'b1', 'h1'] : ['g8', 'c8', 'b8', 'h8'];

	return {
		square: sq,
		castled: castledSquares.includes(sq),
		shieldPawns,
		openFilesNearKing
	};
}

export function developmentInfo(chess: Chess, color: Color): DevelopmentInfo {
	const backRank = color === 'w' ? '1' : '8';
	const minors = allPieces(chess, color).filter((p) => p.type === 'n' || p.type === 'b');
	const startSquares =
		color === 'w' ? ['b1', 'g1', 'c1', 'f1'] : ['b8', 'g8', 'c8', 'f8'];

	const undevelopedMinors = minors.filter((p) => startSquares.includes(p.square)).length;
	const queen = allPieces(chess, color).find((p) => p.type === 'q');
	const queenHome = color === 'w' ? 'd1' : 'd8';
	const queenOutEarly =
		!!queen && queen.square !== queenHome && queen.square[1] !== backRank && undevelopedMinors >= 2;

	return { undevelopedMinors, castled: kingSafety(chess, color).castled, queenOutEarly };
}

export function openFiles(chess: Chess): string[] {
	const pawns = [...allPieces(chess, 'w'), ...allPieces(chess, 'b')].filter((p) => p.type === 'p');
	return FILES.filter((f) => !pawns.some((p) => p.square[0] === f));
}

function nonPawnMaterial(chess: Chess): number {
	let total = 0;
	for (const color of ['w', 'b'] as Color[]) {
		for (const p of allPieces(chess, color)) {
			if (p.type !== 'p' && p.type !== 'k') total += PIECE_VALUE[p.type];
		}
	}
	return total;
}

export function materialBalance(chess: Chess, color: Color): number {
	let score = 0;
	for (const c of ['w', 'b'] as Color[]) {
		for (const p of allPieces(chess, c)) {
			score += (c === color ? 1 : -1) * PIECE_VALUE[p.type];
		}
	}
	return score;
}

export function phaseOf(chess: Chess): 'opening' | 'middlegame' | 'endgame' {
	const material = nonPawnMaterial(chess);
	if (material < 20) return 'endgame';
	if (material >= 50 && chess.moveNumber() <= 12) return 'opening';
	return 'middlegame';
}

const RIM_FILES = ['a', 'h'];

/**
 * Build the full fact set from `player`'s point of view.
 */
export function extractFacts(fen: string, player: Color): PositionFacts {
	const chess = new Chess(fen);
	const phase = phaseOf(chess);

	return {
		fen,
		sideToMove: chess.turn(),
		moveNumber: chess.moveNumber(),
		phase,
		inCheck: chess.isCheck(),
		legalMoveCount: chess.moves().length,
		materialBalance: materialBalance(chess, player),
		yourLoosePieces: loosePieces(chess, player),
		theirLoosePieces: loosePieces(chess, other(player)),
		yourPawnStructure: pawnStructure(chess, player),
		theirPawnStructure: pawnStructure(chess, other(player)),
		yourKing: kingSafety(chess, player),
		theirKing: kingSafety(chess, other(player)),
		development: phase === 'opening' ? developmentInfo(chess, player) : null,
		openFiles: openFiles(chess),
		yourKnightsOnRim: allPieces(chess, player)
			.filter((p) => p.type === 'n' && RIM_FILES.includes(p.square[0]))
			.map((p) => p.square)
	};
}

/** Convert a UCI principal variation into SAN so the coach can quote real notation. */
export function pvToSan(fen: string, pvUci: string[], limit = 6): string[] {
	const chess = new Chess(fen);
	const san: string[] = [];
	for (const uci of pvUci.slice(0, limit)) {
		try {
			const move = chess.move({
				from: uci.slice(0, 2),
				to: uci.slice(2, 4),
				promotion: uci.length > 4 ? uci[4] : undefined
			});
			if (!move) break;
			san.push(move.san);
		} catch {
			break;
		}
	}
	return san;
}

/**
 * Trim the fact set down to what a given band is allowed to hear about.
 * Filtering before the model sees the data is more reliable than asking it to
 * ignore things it can see.
 */
export function filterFactsForBand(facts: PositionFacts, bandId: string): PositionFacts {
	if (bandId !== 'beginner' && bandId !== 'developing') return facts;

	const trimmed: PositionFacts = {
		...facts,
		yourPawnStructure: { doubledFiles: [], isolatedPawns: [], passedPawns: facts.yourPawnStructure.passedPawns },
		theirPawnStructure: { doubledFiles: [], isolatedPawns: [], passedPawns: [] },
		openFiles: [],
		yourKnightsOnRim: []
	};

	if (bandId === 'beginner') {
		// A 900 player does not need to hear about the opponent's king shelter.
		trimmed.theirKing = { ...facts.theirKing, openFilesNearKing: [], shieldPawns: 0 };
		trimmed.yourPawnStructure = { doubledFiles: [], isolatedPawns: [], passedPawns: [] };
	}

	return trimmed;
}
