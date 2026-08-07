/**
 * Server-side Stockfish.
 *
 * The engine used to run as two Web Workers in the visitor's browser, which
 * meant every player downloaded ~7MB of WASM before they could move and got
 * whatever strength their laptop happened to have. It now runs here, in the
 * Node process, behind /api/engine.
 *
 * One instance, not two. The browser build kept an "analyst" and an "opponent"
 * side by side to avoid thrashing UCI options between moves; here a second
 * instance would cost another ~170MB of resident memory in a serverless
 * function for the sake of saving one `isready` round-trip. Instead every call
 * states its full option set, so the engine's configuration is a function of
 * the request rather than of whatever ran before it.
 *
 * Commands are serialised through `enqueue` — UCI is a single-conversation
 * protocol, and this instance is shared by every visitor hitting the same
 * server process.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { parseInfo, type EngineLine } from '$lib/engine/uci';

const require = createRequire(import.meta.url);

export interface AnalysisOptions {
	multipv?: number;
	depth?: number;
	movetime?: number;
	/** Applied before the search. State every option the result depends on. */
	options?: Record<string, string | number | boolean>;
}

/**
 * The emscripten module object. We hand it in, the engine fills it out.
 *
 * `listener` receives every line the engine prints; `ccall` is how commands go
 * the other way. `_isReady` only exists on some builds, hence optional.
 */
interface StockfishModule {
	wasmBinary?: Uint8Array;
	locateFile?: (path: string) => string;
	listener: ((line: string) => void) | null;
	_isReady?: () => boolean;
	ccall(
		name: string,
		returnType: null,
		argTypes: string[],
		args: unknown[],
		opts?: { async?: boolean }
	): void;
}

type Listener = (line: string) => void;

/**
 * Load the engine.
 *
 * The two literal paths here are load-bearing for deployment, not just tidiness.
 * @vercel/nft traces the built server bundle to decide what to copy into the
 * serverless function, and it only emits a file when a literal specifier is
 * *consumed* by a call it recognises: `require(...)` for the JS, a `readFileSync`
 * around `require.resolve(...)` for the wasm. Resolving either path to a bare
 * variable — or letting the `stockfish` package build the path itself, which is
 * what its default loader does — traces nothing, and the function then dies on
 * its first request with a wasm that was never deployed.
 *
 * Reading the wasm ourselves and passing it as `wasmBinary` is the other half:
 * emscripten never has to locate the file, so there is no runtime path to get
 * wrong either.
 *
 * The build is pinned to single-threaded (no SharedArrayBuffer) and lite (a
 * ~7MB net rather than ~113MB, and still far stronger than anything this app
 * coaches). `scripts/setup-stockfish.mjs` asserts both files exist at install
 * time so a bad install fails there rather than here.
 */
function loadEngine(onLine: (line: string) => void): Promise<StockfishModule> {
	const enginePath = require.resolve('stockfish/bin/stockfish-18-lite-single.js');
	const initEngine = require('stockfish/bin/stockfish-18-lite-single.js') as () => (
		mod: StockfishModule
	) => Promise<unknown>;
	const wasmBinary = readFileSync(require.resolve('stockfish/bin/stockfish-18-lite-single.wasm'));

	const mod: StockfishModule = {
		wasmBinary,
		locateFile: () => enginePath,
		listener: onLine,
		ccall: () => undefined // replaced by the runtime during init
	};

	return initEngine()(mod).then(async () => {
		while (mod._isReady && !mod._isReady()) {
			await new Promise((r) => setTimeout(r, 10));
		}
		return mod;
	});
}

/**
 * Hand one UCI command to the engine.
 *
 * The `setImmediate` is what the upstream loader does and it matters: `ccall`
 * re-enters the WASM runtime, and dispatching it synchronously from inside a
 * listener (which is itself called from the runtime) reenters mid-search.
 * `go` is marked async so asyncify unwinds the search instead of blocking.
 */
function send(mod: StockfishModule, cmd: string) {
	setImmediate(() => {
		mod.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });
	});
}

class Engine {
	private listeners = new Set<Listener>();
	private queue: Promise<unknown> = Promise.resolve();
	private booted: Promise<StockfishModule>;
	private module: StockfishModule | null = null;

	constructor() {
		this.booted = this.boot();
	}

	private async boot(): Promise<StockfishModule> {
		this.module = await loadEngine((line) => {
			for (const l of [...this.listeners]) l(line);
		});
		await this.exchange(['uci'], (l) => l.startsWith('uciok'));
		return this.module;
	}

	/** Send `cmds` and resolve once `done` recognises a line. */
	private exchange(cmds: string[], done: (line: string) => boolean, timeoutMs = 30_000): Promise<string[]> {
		const mod = this.module;
		if (!mod) return Promise.reject(new Error('engine not booted'));

		return new Promise((resolve, reject) => {
			const out: string[] = [];
			const timer = setTimeout(() => {
				this.listeners.delete(listener);
				reject(new Error(`UCI timeout after "${cmds.at(-1)}"`));
			}, timeoutMs);
			const listener: Listener = (line) => {
				out.push(line);
				if (!done(line)) return;
				clearTimeout(timer);
				this.listeners.delete(listener);
				resolve(out);
			};
			// Subscribe before sending: the engine can print in the same tick the
			// command is dispatched, and a listener added afterwards misses the reply.
			this.listeners.add(listener);
			for (const cmd of cmds) send(mod, cmd);
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

	/**
	 * Analyse `fen` and return one line per MultiPV slot, best first.
	 *
	 * Scores are side-to-move relative, exactly as the engine reports them.
	 * Callers normalise to whichever point of view they need.
	 */
	analyse(fen: string, opts: AnalysisOptions = {}): Promise<EngineLine[]> {
		const { multipv = 1, depth, movetime, options = {} } = opts;
		return this.enqueue(async () => {
			await this.booted;

			const setup = Object.entries(options).map(([k, v]) => `setoption name ${k} value ${v}`);
			setup.push(`setoption name MultiPV value ${multipv}`);
			await this.exchange([...setup, 'isready'], (l) => l.startsWith('readyok'));

			const go = movetime ? `go movetime ${movetime}` : `go depth ${depth ?? 14}`;
			const out = await this.exchange([`position fen ${fen}`, go], (l) => l.startsWith('bestmove'));

			const best = new Map<number, EngineLine>();
			for (const line of out) {
				if (!line.startsWith('info ')) continue;
				const parsed = parseInfo(line);
				// Keep the deepest result for each MultiPV slot.
				if (parsed && (!best.has(parsed.multipv) || parsed.depth >= best.get(parsed.multipv)!.depth)) {
					best.set(parsed.multipv, parsed);
				}
			}
			return [...best.values()].sort((a, b) => a.multipv - b.multipv);
		});
	}
}

/*
 * Cached on globalThis rather than in module scope. In `vite dev` this module
 * is re-evaluated whenever anything it imports changes, and a fresh Engine per
 * reload would leak a ~170MB WASM heap each time.
 */
const CACHE_KEY = Symbol.for('chesscoach.stockfish');
type Cache = { engine?: Engine };
const cache = ((globalThis as Record<symbol, unknown>)[CACHE_KEY] ??= {}) as Cache;

export function getEngine(): Engine {
	return (cache.engine ??= new Engine());
}
