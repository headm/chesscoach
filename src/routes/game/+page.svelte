<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import type { Color } from 'chess.js';

	import Board from '$lib/components/Board.svelte';
	import CoachPanel from '$lib/components/CoachPanel.svelte';
	import EngineCredit from '$lib/components/EngineCredit.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import MoveList from '$lib/components/MoveList.svelte';
	import { Game } from '$lib/game/state.svelte';

	const elo = Number(page.url.searchParams.get('elo') ?? 1200);
	const playerColor = (page.url.searchParams.get('color') ?? 'w') as Color;

	const game = new Game();

	onMount(() => {
		game.start(elo, playerColor);
	});
	onDestroy(() => game.destroy());

	const cgColor = (c: Color) => (c === 'w' ? 'white' : 'black');
</script>

<!--
	`lg:w-fit` shrink-wraps the page to the two columns below, so the title and
	its rule end exactly where the coaching panel does. Without it the header
	spans the full container and overhangs a board that is sized off viewport
	height. Below `lg` the columns stack and the page takes the full width.
-->
<main class="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:w-fit lg:p-6">
	<!-- App title, spanning both columns. The coaching panel below is untitled;
	     this is the heading for the whole screen. -->
	<header class="flex items-center justify-between border-b border-slate-800 pb-3">
		<h1 class="text-lg font-semibold tracking-tight text-slate-100">Coach</h1>
		<div class="flex items-center gap-4">
			<span class="text-xs text-slate-400">{game.band.label} · {game.elo}</span>
			<a
				href="/"
				class="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
			>
				New game
			</a>
		</div>
	</header>

	<div class="flex flex-col gap-6 lg:flex-row lg:justify-center">
		<!--
			The board is aspect-square, so capping its width also caps its height —
			without a cap it fills the column and pushes the move list off-screen on a
			laptop-height viewport. The cap lives on the column rather than on the
			board itself: a column that took all the leftover width instead left a
			hole between the board and the coaching panel whenever the height cap bit,
			and a move list that overhung the board's right edge. 2.5rem covers the
			eval bar and its gap; flex-shrink takes over when the row is too narrow
			for the full width, and the row centres whatever is left over.

			14rem = the 11.5rem of vertical chrome above and below the board, plus the
			2.5rem the column carries beyond the board's own width.

			The `max()` floors the board at 20rem — 40px squares, a shade wider than
			the 303px a 375px phone gets, and about the point below which the squares
			stop being comfortable to hit. Short windows scroll past the fold instead
			of shrinking further: a board too small to play on is worse than one you
			have to scroll to. The floor takes over below roughly 584px of height.
		-->
		<div class="flex w-full flex-col gap-4 lg:w-[max(22.5rem,calc(100vh-14rem))]">
			<div class="flex gap-3">
				<EvalBar whiteCp={game.evalWhiteCp} orientation={playerColor} />
				<div class="min-w-0 flex-1">
					<Board
						fen={game.fen}
						orientation={cgColor(playerColor)}
						turnColor={cgColor(game.turn)}
						movableColor={game.isPlayerTurn ? cgColor(playerColor) : undefined}
						dests={game.dests}
						lastMove={game.lastMove}
						check={game.inCheck}
						onMove={(from, to) => game.playerMove(from as never, to as never)}
					/>
				</div>
			</div>

			<MoveList moves={game.moves} />
			<EngineCredit />
		</div>

		<CoachPanel {game} />
	</div>
</main>
