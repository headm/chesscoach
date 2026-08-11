import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';

import { bandFor } from '$lib/coach/levels';
import { heuristicCoach } from '$lib/coach/fallback';
import { SHARED_RULES, bandBlock, buildUserMessage } from '$lib/coach/prompt';
import { cacheCoaching, cachedCoaching, coachCacheKey } from '$lib/server/coach/cache';
import { coachSchema, type CoachRequest, type CoachResponse } from '$lib/coach/types';

/*
 * Sonnet 5 rather than Opus 5.
 *
 * A coaching note is ~100-130 output tokens and the player is watching a
 * spinner for all of them. Measured on identical requests, with the engine
 * idle so nothing else was competing: Opus 5 took 5.1-6.7s, Sonnet 5 took
 * 3.3-3.7s. Roughly half the wait, on a writing task that is handed its
 * candidates and its facts and asked for two or three sentences — the
 * reasoning that earns Opus its keep is doing very little here.
 */
const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Which models accept `output_config.effort`.
 *
 * It is not universal: the Opus 4.5-and-later line, Sonnet 4.6 and 5, and the
 * Fable/Mythos models take it, while Haiku 4.5 and Sonnet 4.5 reject the whole
 * request with a 400. `.env.example` offers Haiku as the cheap, fast option for
 * COACH_MODEL, so sending `effort` unconditionally made that documented setting
 * fail — and fail silently, because the catch below demotes any error to
 * heuristic coaching. The player just quietly got worse notes.
 *
 * An allowlist rather than a blocklist so an unfamiliar model degrades to no
 * effort hint instead of failing outright.
 */
const EFFORT_MODELS = [
	'claude-opus-5',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'claude-opus-4-6',
	'claude-opus-4-5',
	'claude-sonnet-5',
	'claude-sonnet-4-6',
	'claude-fable-5',
	'claude-mythos-5'
];

function outputConfig(model: string, mode: CoachRequest['mode']) {
	const format = { type: 'json_schema', schema: coachSchema(mode) } as const;
	// `low` effort keeps latency down for what is a short, well-scoped writing
	// task. Thinking is left at its default rather than disabled — disabling it
	// on Opus 5 risks internal tags leaking into the visible output, and low
	// effort already gets most of the speed back.
	return EFFORT_MODELS.includes(model) ? { effort: 'low' as const, format } : { format };
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
	if (!env.ANTHROPIC_API_KEY) return null;
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const receivedAt = Date.now();
	const req = (await request.json()) as CoachRequest;
	const band = bandFor(req.playerElo);
	const model = env.COACH_MODEL || DEFAULT_MODEL;

	/*
	 * The cache is consulted first, before the API key is even looked at. A hit
	 * returns the bytes an identical call already produced, so it is not an
	 * optimisation inside the Claude path — it stands in front of it. It also
	 * means a deployment with no key still serves real coaching for any position
	 * another visitor has already paid for, which beats the heuristics outright.
	 */
	const cacheKey = coachCacheKey(req, band, model);
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
			model,
			max_tokens: 1024,
			output_config: outputConfig(model, req.mode),
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

		/*
		 * Stored after the contract is enforced, so a hit and a miss return the
		 * same thing rather than the cache replaying an unclamped response — but
		 * deliberately not awaited. The player is waiting on this response and the
		 * write buys them nothing; it is for whoever reaches this position next.
		 *
		 * `waitUntil` is what makes not awaiting safe. A serverless instance can
		 * be frozen the moment it responds, and a write still on the wire is
		 * simply lost, so the position would be paid for again by every visitor
		 * after this one. Handing the promise to the host keeps the invocation
		 * alive for it without holding up the response. Where there is no
		 * `waitUntil` — `vite dev`, or any long-lived Node process — nothing
		 * freezes, so leaving it running is enough. `cacheCoaching` swallows its
		 * own failures, so neither path can produce an unhandled rejection.
		 */
		if (cacheKey) {
			const stored = cacheCoaching(cacheKey, parsed);
			if (platform?.context?.waitUntil) platform.context.waitUntil(stored);
		}

		if (env.NODE_ENV !== 'production') {
			console.log(`[coach] responded in ${Date.now() - receivedAt}ms`);
		}

		return json(parsed);
	} catch (err) {
		console.error('[coach] falling back to heuristics:', err);
		return json(heuristicCoach(req));
	}
};
