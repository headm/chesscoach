/**
 * Minimal UCI driver for stockfish.wasm running in a Web Worker.
 *
 * Two instances are created by the app: an "analyst" at full strength (whose
 * output feeds the coach) and an "opponent" throttled to the player's ELO.
 * Keeping them separate avoids thrashing UCI options between every move.
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

export interface AnalysisOptions {
	multipv?: number;
	depth?: number;
	movetime?: number;
}

type Listener = (line: string) => void;

export class Engine {
	private worker: Worker;
	private listeners = new Set<Listener>();
	/** Serialises commands — UCI is a single-conversation protocol. */
	private queue: Promise<unknown> = Promise.resolve();
	private booted: Promise<void>;

	constructor(scriptUrl = '/stockfish/stockfish.js') {
		this.worker = new Worker(scriptUrl);
		this.worker.onmessage = (e: MessageEvent) => {
			const raw = typeof e.data === 'string' ? e.data : (e.data?.data ?? '');
			if (typeof raw !== 'string') return;
			for (const l of [...this.listeners]) l(raw);
		};
		this.booted = this.waitFor('uci', (line) => line.startsWith('uciok'));
	}

	private send(cmd: string) {
		this.worker.postMessage(cmd);
	}

	/** Send `cmd` and resolve when `match` sees the line it's waiting for. */
	private waitFor(cmd: string, match: (line: string) => boolean, timeoutMs = 20_000): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.listeners.delete(listener);
				reject(new Error(`UCI timeout waiting after "${cmd}"`));
			}, timeoutMs);
			const listener: Listener = (line) => {
				if (!match(line)) return;
				clearTimeout(timer);
				this.listeners.delete(listener);
				resolve();
			};
			this.listeners.add(listener);
			this.send(cmd);
		});
	}

	/** Run `fn` once every previously queued command has settled. */
	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.queue.then(fn, fn);
		// Keep the chain alive even if a command rejects.
		this.queue = next.catch(() => undefined);
		return next;
	}

	async ready(): Promise<void> {
		await this.booted;
	}

	async setOptions(options: Record<string, string | number | boolean>): Promise<void> {
		await this.booted;
		return this.enqueue(async () => {
			for (const [name, value] of Object.entries(options)) {
				this.send(`setoption name ${name} value ${value}`);
			}
			await this.waitFor('isready', (l) => l.startsWith('readyok'));
		});
	}

	/**
	 * Analyse `fen` and return one line per MultiPV slot, best first.
	 *
	 * Scores are side-to-move relative, exactly as the engine reports them.
	 * Callers normalise to whichever point of view they need.
	 */
	analyse(fen: string, opts: AnalysisOptions = {}): Promise<EngineLine[]> {
		const { multipv = 1, depth, movetime } = opts;
		return this.enqueue(async () => {
			await this.waitFor('isready', (l) => l.startsWith('readyok'));
			this.send(`setoption name MultiPV value ${multipv}`);
			this.send(`position fen ${fen}`);

			const best = new Map<number, EngineLine>();
			const go = movetime ? `go movetime ${movetime}` : `go depth ${depth ?? 14}`;

			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					this.listeners.delete(listener);
					reject(new Error('UCI timeout during analysis'));
				}, 30_000);
				const listener: Listener = (line) => {
					if (line.startsWith('info ')) {
						const parsed = parseInfo(line);
						// Keep the deepest result for each MultiPV slot.
						if (parsed && (!best.has(parsed.multipv) || parsed.depth >= best.get(parsed.multipv)!.depth)) {
							best.set(parsed.multipv, parsed);
						}
					} else if (line.startsWith('bestmove')) {
						clearTimeout(timer);
						this.listeners.delete(listener);
						resolve();
					}
				};
				this.listeners.add(listener);
				this.send(go);
			});

			return [...best.values()].sort((a, b) => a.multipv - b.multipv);
		});
	}

	/** Ask for a single move. Used by the throttled opponent when MultiPV is 1. */
	async bestMove(fen: string, movetime: number): Promise<string> {
		const lines = await this.analyse(fen, { multipv: 1, movetime });
		if (lines[0]) return lines[0].moveUci;
		throw new Error('engine produced no move');
	}

	destroy() {
		try {
			this.send('quit');
		} catch {
			/* worker may already be gone */
		}
		this.listeners.clear();
		this.worker.terminate();
	}
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
