<script lang="ts">
	import { formatEval } from '$lib/engine/uci';

	interface Props {
		whiteCp: number;
		orientation: 'w' | 'b';
	}
	let { whiteCp, orientation }: Props = $props();

	// Squash centipawns into a 0-100% bar. The tanh-ish curve keeps small
	// advantages visible without letting +9 peg the bar instantly.
	const whitePercent = $derived.by(() => {
		const clamped = Math.max(-1000, Math.min(1000, whiteCp));
		const pct = 50 + 50 * Math.tanh(clamped / 400);
		return orientation === 'w' ? pct : 100 - pct;
	});

	const label = $derived(formatEval(whiteCp));
	const whiteAhead = $derived(whiteCp >= 0);
</script>

<div class="flex w-7 shrink-0 flex-col items-center gap-2">
	<div class="relative h-full w-5 overflow-hidden rounded-full bg-slate-900 ring-1 ring-slate-700">
		<div
			class="absolute inset-x-0 bottom-0 bg-slate-100 transition-[height] duration-500 ease-out"
			style="height: {whitePercent}%"
		></div>
	</div>
	<span
		class="rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums {whiteAhead
			? 'bg-slate-100 text-slate-900'
			: 'bg-slate-800 text-slate-200'}"
	>
		{label}
	</span>
</div>
