/**
 * Copies the Stockfish WASM build out of node_modules into static/stockfish/,
 * renaming it to a stable `stockfish.js` / `stockfish.wasm` pair.
 *
 * The rename is load-bearing, not cosmetic. In a worker the engine locates its
 * own wasm by taking `self.location.pathname` and swapping `.js` for `.wasm`.
 * So the two files must sit side by side and share a basename — an
 * `importScripts` shim under a different name makes it look for a wasm that
 * isn't there, and it fails silently with no error and no messages.
 *
 * We deliberately pick the SINGLE-THREADED build: the multi-threaded one needs
 * SharedArrayBuffer, which means serving COOP/COEP headers everywhere. Not worth
 * it for the analysis depth this app uses.
 *
 * Run: node scripts/setup-stockfish.mjs
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('node_modules/stockfish/bin');
const DEST = path.resolve('static/stockfish');

if (!existsSync(SRC)) {
	console.error(`Could not find ${SRC}. Run npm install first.`);
	process.exit(1);
}

const entries = await readdir(SRC);
const candidates = entries.filter(
	(f) =>
		f.endsWith('.js') &&
		f.includes('single') && // single-threaded: no SharedArrayBuffer, no COOP/COEP
		!f.includes('asm') && // asm.js fallback is far slower than wasm
		!f.includes('worker')
);

// Prefer the lite build — a ~7MB NNUE rather than ~113MB, and still far stronger
// than anything this app throttles the opponent down to.
const chosen = candidates.find((f) => f.includes('lite')) ?? candidates[0];

if (!chosen) {
	console.error('No usable Stockfish build found in', SRC);
	console.error('Files present:', entries.join(', '));
	process.exit(1);
}

const wasm = chosen.replace(/\.js$/, '.wasm');
if (!entries.includes(wasm)) {
	console.error(`Found ${chosen} but no matching ${wasm}.`);
	process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(path.join(SRC, chosen), path.join(DEST, 'stockfish.js'));
await cp(path.join(SRC, wasm), path.join(DEST, 'stockfish.wasm'));

console.log(`Stockfish ready: ${chosen} -> static/stockfish/stockfish.js (+ .wasm)`);
