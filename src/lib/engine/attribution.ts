/**
 * Attribution for the chess engine behind the analysis.
 *
 * Stockfish.js is GPLv3. Now that the engine runs on our own server rather than
 * in the visitor's browser, we are no longer conveying it and the licence's
 * distribution obligations do not bite. The attribution stays anyway: players
 * are entitled to know what is grading their moves, and pointing at the licence
 * and the corresponding source costs two links.
 *
 * `scripts/setup-stockfish.mjs` checks ENGINE.npmVersion against the installed
 * package and fails loudly if they drift, so the version quoted to users can't
 * silently go stale. It also writes the licence text these links resolve to.
 */

export const ENGINE = {
	name: 'Stockfish.js',
	/** Upstream Stockfish generation this build is compiled from. */
	engineVersion: '18',
	/** Version of the `stockfish` npm package we compile into static/. */
	npmVersion: '18.0.8',
	license: 'GPL-3.0-or-later',
	/** Corresponding source, as required when conveying a GPLv3 work. */
	sourceUrl: 'https://github.com/nmrugg/stockfish.js',
	upstreamUrl: 'https://github.com/official-stockfish/Stockfish',
	/** Served copy of the licence text, written at install time. */
	licenseUrl: '/stockfish/COPYING.txt'
} as const;
