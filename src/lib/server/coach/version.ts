/**
 * The prompt version that appears at the front of every cache key.
 *
 * A short hash of everything that decides what the model writes: the shared
 * rules, the band's own block, and the shape of the payload the request carries.
 * The prompt is edited often, and a cached note that outlives the instructions
 * that produced it is worse than no cache at all — it is a silent regression
 * with no failing request to point at. Hashing all three means any such edit
 * rolls the affected keys on the next deploy, and the stranded rows sit unread
 * until swept; see scripts/sweep-coach-cache.mjs.
 *
 * Per band, not per table. SHARED_RULES is shared, so editing it moves all four
 * versions; a band's topics, voice or thresholds move only that band's. Anything
 * sweeping stale rows has to account for four live prefixes rather than one.
 *
 * This lives apart from the store it serves so that tooling can compute a key
 * without pulling in a module that reads $env at load — the sweep script's whole
 * job is deciding which prefixes are live, and it should not have to reimplement
 * this recipe to do it.
 */

import { createHash } from 'node:crypto';

import type { Band } from '$lib/coach/levels';
import { PAYLOAD_SHAPE, SHARED_RULES, bandBlock } from '$lib/coach/prompt';

const versions = new Map<string, string>();

export function promptVersion(band: Band): string {
	const known = versions.get(band.id);
	if (known) return known;
	const version = createHash('sha256')
		.update(SHARED_RULES)
		.update(' ')
		.update(bandBlock(band))
		.update(' ')
		.update(PAYLOAD_SHAPE)
		.digest('hex')
		.slice(0, 12);
	versions.set(band.id, version);
	return version;
}
