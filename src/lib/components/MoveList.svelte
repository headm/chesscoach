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

<!--
	`h-full` and the `flex-1` scroller let this fill whatever height it is given,
	which is the board's when it sits alongside it. The `max-h-56` still applies
	on the stacked layout, where it is below the board and nothing bounds it.
-->
<div class="flex h-full flex-col rounded-lg border border-slate-800 bg-slate-900/60">
	<h3 class="border-b border-slate-800 px-3 py-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
		History
	</h3>
	<div
		bind:this={scroller}
		class="max-h-56 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs lg:max-h-none"
	>
		{#if rows.length === 0}
			<p class="py-2 text-slate-600">No moves yet.</p>
		{/if}
		{#each rows as row (row.no)}
			<div class="flex gap-2 py-0.5">
				<span class="w-8 shrink-0 text-slate-600">{row.no}.</span>
				<span class="w-14 {row.white?.grade ? GRADE_COLOR[row.white.grade] : 'text-slate-300'}">
					{row.white?.san ?? ''}
				</span>
				<span class="w-14 {row.black?.grade ? GRADE_COLOR[row.black.grade] : 'text-slate-300'}">
					{row.black?.san ?? ''}
				</span>
			</div>
		{/each}
	</div>
</div>
