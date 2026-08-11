#!/usr/bin/env node
/**
 * Delete coach cache rows that no request can reach any more.
 *
 * A key carries a hash of the prompt that produced the note, so every edit to
 * SHARED_RULES or to a band leaves its rows stranded: still in the table, never
 * hit again. This deletes them.
 *
 * There is one live prefix per band, not one per table — `promptVersion` hashes
 * SHARED_RULES together with that band's own block and the payload shape, so
 * editing the shared rules moves all four and editing one band's topics moves
 * only that one. A sweep written against a single hash would delete three
 * bands' live rows, which is why this is a script and not a one-line delete.
 *
 *   node scripts/sweep-coach-cache.mjs            # plan only
 *   node scripts/sweep-coach-cache.mjs --write
 *
 * Deletion is irreversible, and the rows are worth what was paid for them, so
 * the plan prints the live prefixes and a count per doomed prefix. Check the
 * live ones against what the app is actually writing — `[coach] cache=miss`
 * lines in the dev log name the key — before passing --write.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

process.loadEnvFile(path.join(ROOT, '.env'));
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
	console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env — nothing to sweep.');
	process.exit(1);
}

const SB = {
	headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` }
};

async function allKeys() {
	const keys = [];
	for (let offset = 0; ; offset += 1000) {
		const res = await fetch(
			`${SUPABASE_URL}/rest/v1/coach_cache?select=key&order=key&offset=${offset}&limit=1000`,
			SB
		);
		if (!res.ok) throw new Error(`supabase read failed: ${res.status} ${await res.text()}`);
		const page = await res.json();
		keys.push(...page.map((r) => r.key));
		if (page.length < 1000) return keys;
	}
}

const vite = await createServer({
	root: ROOT,
	configFile: false,
	logLevel: 'error',
	appType: 'custom',
	server: { middlewareMode: true },
	resolve: { alias: { $lib: path.join(ROOT, 'src/lib') } }
});
const { promptVersion } = await vite.ssrLoadModule('/src/lib/server/coach/version.ts');
const { BANDS } = await vite.ssrLoadModule('/src/lib/coach/levels.ts');
await vite.close();

// The app's own function, not a copy of it. A sweep that computed the live
// prefixes its own way would be one edit away from deleting the rows it is
// meant to protect.
const live = new Map(BANDS.map((b) => [`v${promptVersion(b)}`, b.id]));

console.log('Live prefixes:');
for (const [prefix, band] of live) console.log(`  ${prefix}  ${band}`);

const keys = await allKeys();
const doomed = keys.filter((k) => !live.has(k.split(':')[0]));

const byPrefix = new Map();
for (const key of doomed) {
	const prefix = key.split(':')[0];
	byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
}

console.log(`\n${keys.length} rows, ${keys.length - doomed.length} live, ${doomed.length} stale:`);
for (const [prefix, n] of [...byPrefix].sort((a, b) => b[1] - a[1]))
	console.log(`  ${String(n).padStart(4)}  ${prefix}`);

if (!doomed.length) {
	console.log('\nNothing to sweep.');
	process.exit(0);
}

// A sweep that empties the table has misidentified the live prefixes — the app
// has been writing rows under one of them, so at least one must match.
if (doomed.length === keys.length) {
	console.error(
		'\nEvery row looks stale, including anything just written. Refusing to delete: the ' +
			'live prefixes above are probably wrong. Compare them against a `cache=miss` line ' +
			'in the dev log before going further.'
	);
	process.exit(1);
}

if (!WRITE) {
	console.log(`\nDry run. Re-run with --write to delete ${doomed.length} row(s).`);
	process.exit(0);
}

// Deleted by explicit key rather than by a `not like` over the live prefixes:
// the list above is what was reviewed, and a filter re-evaluated server-side
// could match something that arrived in between.
let deleted = 0;
for (let i = 0; i < doomed.length; i += 100) {
	const batch = doomed.slice(i, i + 100);
	const inList = batch.map((k) => `"${k.replaceAll('"', '\\"')}"`).join(',');
	const res = await fetch(
		`${SUPABASE_URL}/rest/v1/coach_cache?key=in.(${encodeURIComponent(inList)})`,
		{ method: 'DELETE', headers: { ...SB.headers, Prefer: 'return=representation' } }
	);
	if (!res.ok) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
	deleted += (await res.json()).length;
}

const left = await allKeys();
console.log(`\nDeleted ${deleted} row(s). ${left.length} remain.`);
