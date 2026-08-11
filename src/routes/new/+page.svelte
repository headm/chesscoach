<script lang="ts">
	import { goto } from '$app/navigation';
	import EngineCredit from '$lib/components/EngineCredit.svelte';
	import { bandFor } from '$lib/coach/levels';

	let elo = $state(1200);
	let color = $state<'w' | 'b' | 'random'>('w');

	const band = $derived(bandFor(elo));

	function start() {
		const resolved = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
		goto(`/game?elo=${elo}&color=${resolved}`);
	}
</script>

<main class="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-8 p-6">
	<header>
		<h1 class="text-3xl font-semibold tracking-tight">New Game</h1>
	</header>

	<section class="space-y-3">
		<div class="flex items-baseline justify-between">
			<label for="elo" class="text-sm font-medium text-slate-200">Your rating</label>
			<span class="font-mono text-2xl tabular-nums text-sky-300">{elo}</span>
		</div>
		<input
			id="elo"
			type="range"
			min="600"
			max="2200"
			step="50"
			bind:value={elo}
			class="w-full accent-sky-400"
		/>
		<div class="flex justify-between text-[11px] text-slate-500">
			<span>600</span><span>1400</span><span>2200</span>
		</div>

		<!--
			`band.description` and not `band.voice`: the latter is the register
			instruction handed to the model, so the box used to tell the player
			"Assume full standard vocabulary" — addressed to somebody else entirely.

			The rows below stay label-and-value. Spelling the numbers out in prose —
			"anything costing 0.7 of a pawn or more" — reads oddly here: a definition
			list wants a figure to put beside the term, not a clause.
		-->
		<div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
			<p class="text-sm font-medium text-slate-200">{band.label}</p>
			<p class="mt-1 text-xs leading-relaxed text-slate-400">{band.description}</p>
			<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
				<dt class="text-slate-500">Flags errors from</dt>
				<dd class="text-slate-300">{band.thresholds.inaccuracy} centipawns</dd>
				<dt class="text-slate-500">Candidate moves shown</dt>
				<dd class="text-slate-300">{band.candidateMoves}</dd>
			</dl>
		</div>
	</section>

	<section class="space-y-2">
		<span class="text-sm font-medium text-slate-200">Play as</span>
		<div class="grid grid-cols-3 gap-2">
			{#each [{ v: 'w', l: 'White' }, { v: 'b', l: 'Black' }, { v: 'random', l: 'Random' }] as opt (opt.v)}
				<button
					onclick={() => (color = opt.v as typeof color)}
					class="rounded-md border px-3 py-2 text-sm transition {color === opt.v
						? 'border-sky-400 bg-sky-500/15 text-sky-200'
						: 'border-slate-700 text-slate-300 hover:border-slate-500'}"
				>
					{opt.l}
				</button>
			{/each}
		</div>
	</section>

	<button
		onclick={start}
		class="rounded-md bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white"
	>
		Start game
	</button>

	<footer class="border-t border-slate-800 pt-4">
		<EngineCredit />
	</footer>
</main>
