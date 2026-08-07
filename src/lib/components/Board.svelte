<script lang="ts">
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import { onDestroy } from 'svelte';

	interface Props {
		fen: string;
		orientation: Color;
		turnColor: Color;
		/** undefined disables dragging entirely (engine's turn, game over). */
		movableColor: Color | undefined;
		dests: Map<string, string[]>;
		lastMove: [string, string] | null;
		check: boolean;
		onMove: (from: string, to: string) => void;
	}

	let { fen, orientation, turnColor, movableColor, dests, lastMove, check, onMove }: Props =
		$props();

	let api: Api | null = null;
	let resizeObserver: ResizeObserver | null = null;

	function board(node: HTMLDivElement) {
		api = Chessground(node, {
			fen,
			orientation,
			turnColor,
			check,
			lastMove: (lastMove ?? undefined) as Key[] | undefined,
			movable: {
				free: false,
				color: movableColor,
				dests: dests as Map<Key, Key[]>,
				showDests: true,
				events: { after: (from: Key, to: Key) => onMove(from, to) }
			},
			animation: { enabled: true, duration: 180 },
			highlight: { lastMove: true, check: true },
			drawable: { enabled: false }
		});

		// Chessground caches the board's bounding box and hit-tests clicks against
		// it. If the element hasn't been laid out when Chessground() runs — which
		// is the normal case inside an aspect-ratio container — those bounds are
		// zero and every click maps to no square: pieces render, nothing is
		// clickable, and no error is raised. redrawAll() clears the cache.
		resizeObserver = new ResizeObserver(() => api?.redrawAll());
		resizeObserver.observe(node);
		requestAnimationFrame(() => api?.redrawAll());

		return {
			destroy() {
				resizeObserver?.disconnect();
				resizeObserver = null;
				api?.destroy();
				api = null;
			}
		};
	}

	// Push game state into chessground whenever it changes underneath us.
	$effect(() => {
		if (!api) return;
		api.set({
			fen,
			orientation,
			turnColor,
			check,
			lastMove: (lastMove ?? undefined) as Key[] | undefined,
			movable: {
				free: false,
				color: movableColor,
				dests: dests as Map<Key, Key[]>
			},
			highlight: { lastMove: true, check: true }
		});
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		api?.destroy();
	});
</script>

<!--
	`use:board` goes on the sized element itself. Chessground reads the CSS
	width/height of `.cg-wrap` to compute its bounds, and `cg-container` inside it
	is absolutely positioned at 100%/100% — so the wrap must have a definite size
	of its own. A nested `h-full` div resolves to zero height here and the board
	becomes unclickable while still rendering.
-->
<div
	use:board
	class="aspect-square w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-slate-700/60 select-none"
></div>
