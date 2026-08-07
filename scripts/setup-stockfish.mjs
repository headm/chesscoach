/**
 * Install-time check + attribution for the bundled Stockfish build.
 *
 * The engine used to be copied into static/ and downloaded by every visitor.
 * It now runs server-side (src/lib/server/engine/stockfish.ts), loaded straight
 * out of node_modules, so nothing needs copying into the web root any more.
 * What this script still does:
 *
 *   1. Asserts the exact build the server hard-codes is present, so a bad or
 *      partial install fails at `npm install` rather than on the first move.
 *   2. Guards the version quoted in the UI against the installed one.
 *   3. Writes the licence text and a source pointer to static/stockfish/, which
 *      is what the attribution in the footer links to.
 *
 * The build is pinned to the SINGLE-THREADED LITE flavour, matching
 * `stockfish.ts`. Single-threaded because the multi-threaded one wants
 * SharedArrayBuffer; lite because @vercel/nft copies the .wasm into the
 * serverless function and ~7MB is a very different proposition from ~113MB.
 *
 * Run: node scripts/setup-stockfish.mjs
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PKG = path.resolve('node_modules/stockfish');
const DEST = path.resolve('static/stockfish');
const ATTRIBUTION = path.resolve('src/lib/engine/attribution.ts');

/** Must match the two `require.resolve` literals in the server engine module. */
const BUILD = 'stockfish-18-lite-single';

if (!existsSync(PKG)) {
	console.error(`Could not find ${PKG}. Run npm install first.`);
	process.exit(1);
}

for (const ext of ['.js', '.wasm']) {
	const file = path.join(PKG, 'bin', BUILD + ext);
	if (!existsSync(file)) {
		console.error(
			`Missing ${file}.\n` +
				`src/lib/server/engine/stockfish.ts loads this build by name; without it ` +
				`the engine endpoint cannot start.`
		);
		process.exit(1);
	}
}

/*
 * Guard against the quoted version drifting from the installed one. The UI
 * tells users which engine build backs the analysis and where to get its
 * source; if that claim goes stale it stops being useful attribution.
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

const licenseFile = ['Copying.txt', 'COPYING', 'LICENSE'].find((f) =>
	existsSync(path.join(PKG, f))
);
if (!licenseFile) {
	console.error(`No licence file found in ${PKG}.`);
	process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(path.join(PKG, licenseFile), path.join(DEST, 'COPYING.txt'));

await writeFile(
	path.join(DEST, 'SOURCE.txt'),
	[
		'Stockfish.js — a WebAssembly build of the Stockfish chess engine.',
		'',
		'This app runs the engine on its own server and sends only the resulting',
		'analysis to the browser. The engine binary is not distributed to visitors.',
		'',
		`Version:  stockfish npm ${installedVersion} (Stockfish 18)`,
		`Build:    ${BUILD}.js / ${BUILD}.wasm`,
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

console.log(`Stockfish ${installedVersion} ready: bin/${BUILD}.js (server-side).`);
console.log('Attribution written to static/stockfish/ (COPYING.txt, SOURCE.txt).');
