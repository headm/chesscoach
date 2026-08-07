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

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PKG = path.resolve('node_modules/stockfish');
const SRC = path.join(PKG, 'bin');
const DEST = path.resolve('static/stockfish');
const ATTRIBUTION = path.resolve('src/lib/engine/attribution.ts');

if (!existsSync(SRC)) {
	console.error(`Could not find ${SRC}. Run npm install first.`);
	process.exit(1);
}

/*
 * Guard against the quoted version drifting from the installed one. The UI
 * tells users which engine build they received and where to get its source;
 * if that claim goes stale it stops being useful attribution.
 */
const installedVersion = JSON.parse(await readFile(path.join(PKG, 'package.json'), 'utf8')).version;
const recordedVersion = (await readFile(ATTRIBUTION, 'utf8')).match(/npmVersion: '([^']+)'/)?.[1];
if (recordedVersion && recordedVersion !== installedVersion) {
	console.error(
		`Version drift: stockfish ${installedVersion} is installed but ` +
			`src/lib/engine/attribution.ts still says ${recordedVersion}.\n` +
			`Update ENGINE.npmVersion (and engineVersion if the generation changed).`
	);
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

/*
 * GPLv3 compliance. Serving the compiled engine to a browser is conveying it,
 * so the licence text has to travel with the binary and recipients need to be
 * told where the corresponding source is. Copying only the .js/.wasm — as this
 * script originally did — ships the engine without its licence.
 */
const licenseFile = ['Copying.txt', 'COPYING', 'LICENSE'].find((f) =>
	existsSync(path.join(PKG, f))
);
if (!licenseFile) {
	console.error(`No licence file found in ${PKG}. Refusing to ship the engine without it.`);
	process.exit(1);
}
await cp(path.join(PKG, licenseFile), path.join(DEST, 'COPYING.txt'));

await writeFile(
	path.join(DEST, 'SOURCE.txt'),
	[
		'Stockfish.js — a WebAssembly build of the Stockfish chess engine.',
		'',
		`Version:  stockfish npm ${installedVersion} (Stockfish 18)`,
		`Build:    ${chosen}`,
		'License:  GNU General Public License v3 or later (see COPYING.txt)',
		'',
		'Corresponding source for this build:',
		'  https://github.com/nmrugg/stockfish.js',
		'Upstream Stockfish:',
		'  https://github.com/official-stockfish/Stockfish',
		'',
		'Stockfish.js (c) Chess.com, LLC.',
		'Stockfish (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and contributors.',
		''
	].join('\n')
);

console.log(`Stockfish ready: ${chosen} -> static/stockfish/stockfish.js (+ .wasm)`);
console.log(`GPLv3: COPYING.txt and SOURCE.txt written alongside the engine.`);
