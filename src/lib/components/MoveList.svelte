<script lang="ts">
	import { GRADE_COLOR } from '$lib/coach/levels';
	import type { MoveRecord } from '$lib/game/state.svelte';

	interface Props {
		moves: MoveRecord[];
	}
	let { moves }: Props = $props();

	// Pair plies into numbered move rows.
	const rows = $derived.by(() => {
		const out: { no: number; white?: MoveRecord; black?: MoveRecord }[] = [];
		for (const m of moves) {
			const no = Math.ceil(m.ply / 2);
			let row = out.find((r) => r.no === no);
			if (!row) {
				row = { no };
				out.push(row);
			}
			if (m.color === 'w') row.white = m;
			else row.black = m;
		}
		return out;
	});

	let scroller = $state<HTMLDivElement>();
	$effect(() => {
		moves.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<div class="rounded-lg border border-slate-800 bg-slate-900/60">
	<h3 class="border-b border-slate-800 px-3 py-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
		Moves
	</h3>
	<div bind:this={scroller} class="max-h-56 overflow-y-auto px-3 py-2 font-mono text-xs">
		{#if rows.length === 0}
			<p class="py-2 text-slate-600">No moves yet.</p>
		{/if}
		{#each rows as row (row.no)}
			<div class="flex gap-2 py-0.5">
				<span class="w-6 shrink-0 text-slate-600">{row.no}.</span>
				<span class="w-16 {row.white?.grade ? GRADE_COLOR[row.white.grade] : 'text-slate-300'}">
					{row.white?.san ?? ''}
				</span>
				<span class="w-16 {row.black?.grade ? GRADE_COLOR[row.black.grade] : 'text-slate-300'}">
					{row.black?.san ?? ''}
				</span>
			</div>
		{/each}
	</div>
</div>
