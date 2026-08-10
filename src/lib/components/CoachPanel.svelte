<script lang="ts">
	import { GRADE_COLOR, GRADE_LABEL } from '$lib/coach/levels';
	import type { CoachResponse } from '$lib/coach/types';
	import type { Game } from '$lib/game/state.svelte';

	interface Props {
		game: Game;
	}
	let { game }: Props = $props();

	const lastPlayerMove = $derived(
		[...game.moves].reverse().find((m) => m.color === game.playerColor) ?? null
	);

	// The first hint arrives on its own at the start of every turn, so the panel
	// only ever offers the two escalations past it.
	const canEscalate = $derived(game.isPlayerTurn && !game.hintLoading);

	/*
	 * True until the player makes their first move. `coach` is only ever
	 * replaced after that, never cleared, so this flips exactly once — which is
	 * what the feedback section and the hint's heading both key off. Deriving it
	 * from `moves` instead would flicker: the move is appended a beat after the
	 * coaching request starts.
	 */
	const beforeFirstMove = $derived(!game.coach && !game.coachLoading);
</script>

{#snippet card(res: CoachResponse, tone: 'hint' | 'feedback')}
	<div
		class="rounded-lg border p-4 {tone === 'hint'
			? 'border-sky-500/30 bg-sky-500/5'
			: 'border-slate-700 bg-slate-900/60'}"
	>
		<!--
			Feedback is titled by the move's grade rather than by the model's headline.
			The two said the same thing twice — a "Best move" label above a "Best move —
			straight into the centre" headline — and the grade is the half that is
			computed rather than written, so it is the half that can be trusted to be
			consistent. The headline is not rendered in this mode; the body carries the
			point. A missing grade (dropped analysis) falls back to the headline.
		-->
		{#if tone === 'feedback' && lastPlayerMove?.grade}
			<p class="text-sm font-semibold {GRADE_COLOR[lastPlayerMove.grade]}">
				{GRADE_LABEL[lastPlayerMove.grade]}
				{#if lastPlayerMove.cpLoss && lastPlayerMove.cpLoss > 10}
					<span class="font-normal text-slate-500">
						· −{(lastPlayerMove.cpLoss / 100).toFixed(2)}
					</span>
				{/if}
			</p>
		{:else}
			<p class="text-sm font-semibold text-slate-100">{res.headline}</p>
		{/if}
		<p class="mt-1.5 text-sm leading-relaxed text-slate-300">{res.body}</p>
		{#if res.revealedMove}
			<p class="mt-2.5 flex items-center gap-2">
				<!-- In feedback the move is what should have been played, not what to
				     play now — label it so the two cards can't be read the same way. -->
				{#if tone === 'feedback'}
					<span class="text-xs text-slate-500">Better was</span>
				{/if}
				<span class="inline-block rounded bg-slate-800 px-2 py-1 font-mono text-sm text-emerald-300">
					{res.revealedMove}
				</span>
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
	{#if game.status === 'booting'}
		<div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
			Warming up the engine…
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

	<!--
		Feedback on the last move comes first: it closes off the move just played
		before the panel turns to the move ahead. Everything forward-looking lives
		in the hint below. There is no empty state — until the player has moved
		there is no last move to review, so the section is simply absent.
	-->
	{#if !beforeFirstMove}
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
				{@render card(game.coach, 'feedback')}
			{/if}
		</section>
	{/if}

	<!-- Hint. Level 1 is automatic; the buttons only escalate. -->
	{#if game.status !== 'game-over'}
		<section class="space-y-3">
			<div class="flex items-baseline justify-between">
				<h3 class="text-xs font-semibold tracking-wide text-slate-400 uppercase">
					{beforeFirstMove ? 'Opening move' : 'This position'}
				</h3>
				{#if game.hintLevel > 0}
					<span class="text-xs text-sky-400/70">Hint {game.hintLevel}/3</span>
				{/if}
			</div>

			{#if game.hintLoading}
				<div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
					<div class="flex items-center gap-2 text-sm text-sky-200/70">
						<span class="h-2 w-2 animate-pulse rounded-full bg-sky-400"></span>
						Looking at the position…
					</div>
				</div>
			{:else if game.hint}
				{@render card(game.hint, 'hint')}
			{:else}
				<div class="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
					A hint appears here as soon as it's your move.
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2">
				<button
					onclick={() => game.requestHint(2)}
					disabled={!canEscalate || game.hintLevel >= 2}
					class="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
				>
					I need more
				</button>
				<button
					onclick={() => game.requestHint(3)}
					disabled={!canEscalate || game.hintLevel >= 3}
					class="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Show me the move
				</button>
			</div>
		</section>
	{/if}
</aside>
