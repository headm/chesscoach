/**
 * Attribution for the bundled chess engine.
 *
 * Stockfish.js is GPLv3, and this app serves the compiled engine to every
 * visitor's browser — which is distribution, not mere use. That obliges us to
 * ship the licence text and tell recipients where to get the corresponding
 * source. These constants back the visible attribution in the UI; the licence
 * text itself is copied to /stockfish/COPYING.txt by scripts/setup-stockfish.mjs.
 *
 * `scripts/setup-stockfish.mjs` checks ENGINE.npmVersion against the installed
 * package and fails loudly if they drift, so the version quoted to users can't
 * silently go stale.
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
