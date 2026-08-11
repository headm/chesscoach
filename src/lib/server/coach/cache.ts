/**
 * Shared cache of coaching notes, in Supabase.
 *
 * A note is a pure function of the prompt, the band, and the position: the
 * analyst runs at a fixed depth, the facts are extracted deterministically, and
 * everything else in the payload is derived from those. So a stored row can
 * serve the exact bytes a fresh call would have produced. This buys cost, not
 * quality — nothing here changes a word the player reads.
 *
 * One tier, deliberately. Every instance and every visitor reads the same
 * table, and it outlives deploys: one player walking into the Italian pays for
 * it, and everyone after them reads it back. An in-process tier in front of
 * this would save a round trip on hot keys, but a round trip is nothing beside
 * the Claude call it stands in for, and holding local copies would mean a bad
 * row could not be retracted — deleting it here would leave every warm instance
 * still serving it. One store, one place to look, one place to fix.
 *
 * The store is optional. With no credentials configured the app behaves exactly
 * as it did before it had a cache, so a local checkout still needs nothing but
 * an Anthropic key. Every failure — unreachable, slow, misconfigured — is
 * treated as a miss and logged; the cache is never allowed to take coaching
 * down with it.
 */

import { createHash } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

import type { Band } from '$lib/coach/levels';
import { SHARED_RULES, bandBlock } from '$lib/coach/prompt';
import type { CoachRequest, CoachResponse } from '$lib/coach/types';

const TABLE = 'coach_cache';

/*
 * Both budgets are far larger than the round trip, on purpose.
 *
 * Measured against this project, the same query takes 170–560ms from an idle
 * process but 500–3000ms from inside the app. The difference is not the
 * network: Stockfish is a single-threaded WASM build running in this very
 * process, and `AbortSignal.timeout` is delivered through the event loop, so a
 * depth-14 search starves the timer and the response together. An abort here
 * measures how busy the engine is, not how slow Supabase is.
 *
 * A tight budget is worse than useless because of what it falls back to. Giving
 * up on a read that would have landed in three seconds buys a Claude call that
 * takes longer than that, so the turn gets slower *and* costs money. These
 * numbers exist only to stop a genuinely hung connection hanging forever; the
 * cost of waiting is always less than the cost of missing.
 */
const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 5_000;

/**
 * The client, or null when the store is not configured.
 *
 * The secret key (`sb_secret_…`), not the publishable one. The table has
 * row-level security on with no policies, so the publishable key — which acts
 * as the `anon` role and is subject to RLS — can neither read nor write it;
 * the secret key acts as `service_role` and bypasses RLS. That asymmetry is the
 * point: a cache anyone can write to is a way to put words in the coach's mouth
 * for every later player who reaches that position. This module lives under
 * `$lib/server`, which SvelteKit refuses to bundle into client code, so the key
 * cannot leak through an import.
 */
let client: SupabaseClient | null | undefined;
function getClient(): SupabaseClient | null {
	if (client !== undefined) return client;
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_SECRET_KEY;
	client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
	return client;
}

/**
 * A short hash of every instruction the response was written under.
 *
 * The prompt is edited often, and a cached note that outlives the rules that
 * produced it is worse than no cache at all — it is a silent regression with no
 * failing request to point at. Hashing both blocks means editing SHARED_RULES
 * or any part of a band (its topics, its voice, its thresholds) rolls that
 * band's keys over on the next deploy. The old rows sit there unread until
 * swept; see the migration for the two queries that do it.
 */
const versions = new Map<string, string>();
function promptVersion(band: Band): string {
	const known = versions.get(band.id);
	if (known) return known;
	const version = createHash('sha256')
		.update(SHARED_RULES)
		.update(' ')
		.update(bandBlock(band))
		.digest('hex')
		.slice(0, 12);
	versions.set(band.id, version);
	return version;
}

/**
 * Placement, side to move, castling rights, en passant square.
 *
 * Dropping the halfmove and fullmove clocks is what lets transpositions share
 * a row: the same position reached by a different move order is the same
 * position to coach, but its full FEN differs in the counters alone.
 */
function normalisedFen(fen: string): string {
	return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * The cache key, or null when the request cannot be keyed safely.
 *
 * Everything the response depends on has to appear here, and nothing else:
 *
 * - The player's colour is absent because the normalised FEN already carries
 *   it. Hints only fire on the player's turn, and feedback is keyed on the
 *   position the player moved from, so in both modes the side to move *is* the
 *   player.
 * - Candidates and facts are absent because both are derived from the position
 *   and the band, which are already in the key.
 * - The opening name is present because it is not derived from the position:
 *   two move orders reaching the same FEN can carry different names, and the
 *   name reaches the model, so it has to reach the key too.
 * - The model is present for the plainest reason of all: it wrote the words.
 *   Without it, changing `COACH_MODEL` leaves every already-cached position
 *   answering in the old model's voice for as long as the row survives, and the
 *   table quietly becomes a mixture of two models' work with no way to tell
 *   which is which.
 */
export function coachCacheKey(req: CoachRequest, band: Band, model: string): string | null {
	const parts = [`v${promptVersion(band)}`, model, band.id, req.mode, normalisedFen(req.fen)];

	if (req.mode === 'hint') {
		parts.push(String(req.hintLevel ?? 1));
	} else if (req.playedMove) {
		parts.push(req.playedMove.san);
	} else {
		// Feedback with no played move has nothing to say and nothing to key on.
		return null;
	}

	parts.push(req.openingName ?? '-');
	return parts.join(':');
}

/** The stored note for `key`, or null on a miss or any failure reaching the store. */
export async function cachedCoaching(key: string): Promise<CoachResponse | null> {
	const supabase = getClient();
	if (!supabase) return null;

	const startedAt = Date.now();
	try {
		const { data, error } = await supabase
			.from(TABLE)
			.select('response')
			.eq('key', key)
			.abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
			.maybeSingle();

		if (env.NODE_ENV !== 'production') {
			console.log(`[coach] cache read ${Date.now() - startedAt}ms ${data ? 'hit' : 'miss'}`);
		}

		if (error) {
			console.error('[coach] cache read failed:', error.message);
			return null;
		}
		return data ? (data.response as CoachResponse) : null;
	} catch (err) {
		// Timeout, DNS, TLS — anything at all. A cache that cannot be read is a
		// miss, never an error the player sees.
		console.error(`[coach] cache read failed after ${Date.now() - startedAt}ms:`, err);
		return null;
	}
}

export async function cacheCoaching(key: string, res: CoachResponse): Promise<void> {
	/*
	 * Never store heuristic output. It is what the app serves when the API is
	 * unreachable or unconfigured, and caching it would pin that fallback in
	 * place for every later player who reaches the same position — long after
	 * the key came back or the outage ended.
	 */
	if (res.fallback) return;

	const supabase = getClient();
	if (!supabase) return;

	/*
	 * This returns a promise the caller is expected not to await — see the
	 * endpoint, which hands it to `waitUntil` instead. Nothing here may throw:
	 * a rejection nobody is waiting on is an unhandled rejection, which on some
	 * hosts takes the process with it.
	 */
	const startedAt = Date.now();
	try {
		const { error } = await supabase
			.from(TABLE)
			.upsert({ key, response: res }, { onConflict: 'key' })
			.abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
		if (error) console.error('[coach] cache write failed:', error.message);
		else if (env.NODE_ENV !== 'production') {
			console.log(`[coach] cache write ${Date.now() - startedAt}ms`);
		}
	} catch (err) {
		console.error(`[coach] cache write failed after ${Date.now() - startedAt}ms:`, err);
	}
}
