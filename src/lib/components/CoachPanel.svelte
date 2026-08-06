<script lang="ts">
	import { GRADE_COLOR, GRADE_LABEL, type Band } from '$lib/coach/levels';
	import type { CoachResponse } from '$lib/coach/types';
	import type { Game } from '$lib/game/state.svelte';

	interface Props {
		game: Game;
	}
	let { game }: Props = $props();

	const band: Band = $derived(game.band);
	const lastPlayerMove = $derived(
		[...game.moves].reverse().find((m) => m.color === game.playerColor) ?? null
	);

	const hintButtonLabel = $derived(
		game.hintLevel === 0
			? 'Get a hint'
			: game.hintLevel === 1
				? 'I need more'
				: game.hintLevel === 2
					? 'Just tell me the move'
					: 'Move revealed'
	);
</script>

{#snippet card(res: CoachResponse, tone: 'hint' | 'feedback')}
	<div
		class="rounded-lg border p-4 {tone === 'hint'
			? 'border-sky-500/30 bg-sky-500/5'
			: 'border-slate-700 bg-slate-900/60'}"
	>
		<p class="text-sm font-semibold text-slate-100">{res.headline}</p>
		<p class="mt-1.5 text-sm leading-relaxed text-slate-300">{res.body}</p>
		{#if res.revealedMove}
			<p class="mt-2.5 inline-block rounded bg-slate-800 px-2 py-1 font-mono text-sm text-emerald-300">
				{res.revealedMove}
			</p>
		{/if}
		{#if res.fallback}
			<p class="mt-2 text-[11px] text-amber-400/70">
				Heuristic coaching — set ANTHROPIC_API_KEY for the full coach.
			</p>
		{/if}
	</div>
{/snippet}

<aside class="flex w-full flex-col gap-4 lg:w-96">
	<header class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
		<div class="flex items-baseline justify-between">
			<h2 class="text-sm font-semibold tracking-wide text-slate-200 uppercase">Coach</h2>
			<span class="text-xs text-slate-400">{band.label} · {game.elo}</span>
		</div>
		<p class="mt-1 text-xs text-slate-500">
			Tuned for {band.label.toLowerCase()} play — {band.topics.length} topics in scope,
			errors flagged from {band.thresholds.inaccuracy}cp.
		</p>
	</header>

	{#if game.status === 'booting'}
		<div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
			Starting the engines…
		</div>
	{/if}

	{#if game.status === 'game-over'}
		<div class="rounded-lg border border-slate-600 bg-slate-800/60 p-4">
			<p class="text-sm font-semibold text-slate-100">{game.resultText}</p>
			{#if game.mistakes.length}
				<p class="mt-2 text-xs text-slate-400">Your costliest moves this game:</p>
				<ul class="mt-1.5 space-y-1">
					{#each game.mistakes as m (m.ply)}
						<li class="flex justify-between text-xs">
							<span class="font-mono text-slate-300">{Math.ceil(m.ply / 2)}. {m.san}</span>
							<span class={GRADE_COLOR[m.grade!]}>
								{GRADE_LABEL[m.grade!]} · −{((m.cpLoss ?? 0) / 100).toFixed(1)}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-xs text-emerald-400">No mistakes or blunders. Clean game.</p>
			{/if}
			<a
				href="/"
				class="mt-4 inline-block rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white"
			>
				New game
			</a>
		</div>
	{/if}

	<!-- Hint -->
	{#if game.status !== 'game-over'}
		<section class="space-y-3">
			<button
				onclick={() => game.requestHint()}
				disabled={!game.isPlayerTurn || game.hintLoading || game.hintLevel >= 3}
				class="w-full rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
			>
				{game.hintLoading ? 'Thinking…' : hintButtonLabel}
				{#if game.hintLevel > 0 && game.hintLevel < 3}
					<span class="ml-1 text-xs text-sky-400/70">({game.hintLevel}/3)</span>
				{/if}
			</button>

			{#if game.hint}
				{@render card(game.hint, 'hint')}
			{/if}
		</section>
	{/if}

	<!-- Feedback on the last move -->
	<section class="space-y-2">
		<h3 class="text-xs font-semibold tracking-wide text-slate-400 uppercase">Your last move</h3>
		{#if game.coachLoading}
			<div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
				<div class="flex items-center gap-2 text-sm text-slate-400">
					<span class="h-2 w-2 animate-pulse rounded-full bg-sky-400"></span>
					Reviewing {lastPlayerMove?.san ?? 'your move'}…
				</div>
			</div>
		{:else if game.coach}
			{#if lastPlayerMove?.grade}
				<p class="text-xs font-medium {GRADE_COLOR[lastPlayerMove.grade]}">
					{GRADE_LABEL[lastPlayerMove.grade]}
					{#if lastPlayerMove.cpLoss && lastPlayerMove.cpLoss > 10}
						<span class="text-slate-500">· −{(lastPlayerMove.cpLoss / 100).toFixed(2)}</span>
					{/if}
				</p>
			{/if}
			{@render card(game.coach, 'feedback')}
		{:else}
			<div class="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
				Play a move and I'll tell you what it did.
			</div>
		{/if}
	</section>
</aside>
