import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';

import { bandFor } from '$lib/coach/levels';
import { heuristicCoach } from '$lib/coach/fallback';
import { SHARED_RULES, bandBlock, buildUserMessage } from '$lib/coach/prompt';
import { cacheCoaching, cachedCoaching, coachCacheKey } from '$lib/server/coach/cache';
import { COACH_SCHEMA, type CoachRequest, type CoachResponse } from '$lib/coach/types';

const DEFAULT_MODEL = 'claude-opus-5';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
	if (!env.ANTHROPIC_API_KEY) return null;
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client;
}

export const POST: RequestHandler = async ({ request }) => {
	const req = (await request.json()) as CoachRequest;
	const band = bandFor(req.playerElo);

	/*
	 * The cache is consulted first, before the API key is even looked at. A hit
	 * returns the bytes an identical call already produced, so it is not an
	 * optimisation inside the Claude path — it stands in front of it. It also
	 * means a deployment with no key still serves real coaching for any position
	 * another visitor has already paid for, which beats the heuristics outright.
	 */
	const cacheKey = coachCacheKey(req, band);
	if (cacheKey) {
		const hit = await cachedCoaching(cacheKey);
		if (hit) {
			if (env.NODE_ENV !== 'production') {
				console.log(`[coach] ${req.mode} elo=${req.playerElo} band=${band.id} cache=hit`);
			}
			return json(hit);
		}
	}

	// No credentials configured — the app stays playable on heuristic coaching.
	const anthropic = getClient();
	if (!anthropic) return json(heuristicCoach(req));

	try {
		const response = await anthropic.messages.create({
			model: env.COACH_MODEL || DEFAULT_MODEL,
			max_tokens: 1024,
			// `low` effort keeps latency down for what is a short, well-scoped
			// writing task. Thinking is left at its default (adaptive) rather than
			// disabled — disabling it on Opus 5 risks internal tags leaking into the
			// visible output, and low effort already gets most of the speed back.
			output_config: {
				effort: 'low',
				format: { type: 'json_schema', schema: COACH_SCHEMA }
			},
			system: [
				// Two cache breakpoints: the shared rules stay hot across every band,
				// the band block across every request at that band. Per-move data
				// lives in the user turn, after both, so it never invalidates them.
				{ type: 'text', text: SHARED_RULES, cache_control: { type: 'ephemeral' } },
				{ type: 'text', text: bandBlock(band), cache_control: { type: 'ephemeral' } }
			],
			messages: [{ role: 'user', content: buildUserMessage(req) }]
		});

		// Always check stop_reason before touching content — a refusal returns
		// HTTP 200 with an empty or partial content array.
		if (response.stop_reason === 'refusal') {
			return json(heuristicCoach(req));
		}

		if (env.NODE_ENV !== 'production') {
			const u = response.usage;
			console.log(
				`[coach] ${req.mode} elo=${req.playerElo} band=${band.id} cache=miss ` +
					`in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} ` +
					`cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`
			);
		}

		const text = response.content.find((b) => b.type === 'text');
		if (!text || text.type !== 'text') return json(heuristicCoach(req));

		const parsed = JSON.parse(text.text) as CoachResponse;

		// Enforce the hint-level contract server-side rather than trusting the model
		// not to spoil the answer.
		if (req.mode === 'hint' && (req.hintLevel ?? 1) < 3) parsed.revealedMove = null;
		parsed.highlightSquares = (parsed.highlightSquares ?? []).slice(0, 4);

		// Stored after the contract is enforced, so a hit and a miss return the
		// same thing rather than the cache replaying an unclamped response.
		if (cacheKey) await cacheCoaching(cacheKey, parsed);

		return json(parsed);
	} catch (err) {
		console.error('[coach] falling back to heuristics:', err);
		return json(heuristicCoach(req));
	}
};
