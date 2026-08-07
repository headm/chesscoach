/**
 * UCI vocabulary: the shapes and the pure functions that read them.
 *
 * Deliberately free of any engine plumbing. The engine itself runs server-side
 * (see `$lib/server/engine/stockfish.ts`), but `EngineLine` crosses the wire to
 * the browser and the score conversions below are needed on both ends, so this
 * module has to stay importable from either.
 */

export interface EngineLine {
	multipv: number;
	depth: number;
	/** Centipawns from the side-to-move's point of view. Null when it's a mate score. */
	cp: number | null;
	/** Mate in N (positive = side to move mates). Null when it's a cp score. */
	mate: number | null;
	moveUci: string;
	pvUci: string[];
}

/** Parse a single `info ...` line into a candidate line, or null if unusable. */
export function parseInfo(line: string): EngineLine | null {
	const tokens = line.split(/\s+/);
	let depth = 0;
	let multipv = 1;
	let cp: number | null = null;
	let mate: number | null = null;
	let pv: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		switch (tokens[i]) {
			case 'depth':
				depth = Number(tokens[++i]);
				break;
			case 'multipv':
				multipv = Number(tokens[++i]);
				break;
			case 'score':
				if (tokens[i + 1] === 'cp') {
					cp = Number(tokens[i + 2]);
					i += 2;
				} else if (tokens[i + 1] === 'mate') {
					mate = Number(tokens[i + 2]);
					i += 2;
				}
				break;
			case 'pv':
				pv = tokens.slice(i + 1);
				i = tokens.length;
				break;
		}
	}

	// `info` lines without a pv are progress chatter (currmove, nps, hashfull).
	if (pv.length === 0 || (cp === null && mate === null)) return null;
	return { multipv, depth, cp, mate, moveUci: pv[0], pvUci: pv };
}

/** Convert a side-to-move-relative score into centipawns from White's side. */
export function toWhiteCp(line: EngineLine, sideToMove: 'w' | 'b'): number {
	const raw = line.mate !== null ? (line.mate > 0 ? 10_000 - line.mate * 10 : -10_000 - line.mate * 10) : (line.cp ?? 0);
	return sideToMove === 'w' ? raw : -raw;
}

/** Convert a White-relative score into centipawns from `color`'s side. */
export function fromWhiteCp(whiteCp: number, color: 'w' | 'b'): number {
	return color === 'w' ? whiteCp : -whiteCp;
}

/** Human-readable eval, always from White's point of view. */
export function formatEval(whiteCp: number): string {
	if (Math.abs(whiteCp) >= 9000) {
		const mateIn = Math.round((10_000 - Math.abs(whiteCp)) / 10);
		return `${whiteCp > 0 ? '' : '-'}M${Math.max(1, mateIn)}`;
	}
	const pawns = whiteCp / 100;
	return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
