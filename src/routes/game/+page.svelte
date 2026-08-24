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

	No fixed max-width: the board is already bounded by viewport height, so the
	widest this can get is self-limiting, and a fixed cap would only clamp the
	columns on a wide screen and take that width back off the board. `max-w-full`
	still has to be spelled out — `w-fit` alone resolves to the content's
	max-content width here and will happily run past the viewport, which shows up
	as a horizontal scrollbar rather than as the columns shrinking.
-->
<main class="mx-auto flex w-full flex-col gap-4 p-4 lg:w-fit lg:max-w-full lg:p-6">
	<!-- App title, spanning both columns. The coaching panel below is untitled;
	     this is the heading for the whole screen. -->
	<header class="flex items-center justify-between border-b border-slate-800 pb-3">
		<h1 class="text-lg font-semibold tracking-tight text-slate-100">Chessmate</h1>
		<div class="flex items-center gap-4">
			<span class="text-xs text-slate-400">{game.band.label} · {game.elo}</span>
			<a
				href="/new"
				class="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
			>
				New game
			</a>
		</div>
	</header>

	<div class="flex flex-col gap-6 lg:flex-row lg:justify-center">
		<!--
			The board is aspect-square, so its width is also its height, and the width
			it gets is whatever this column has left after the things beside it. The
			cap therefore lives on the column rather than on the board: a column that
			took all the leftover width instead left a hole between the board and the
			coaching panel whenever the height cap bit. Flex-shrink takes over when
			the row is too narrow for the full width, and the row centres the rest.

			The column is the board plus 15.25rem — the history panel, the eval bar,
			and the two gaps, all of which sit to the board's left. The board itself
			is the viewport height less 9.25rem of chrome above and below it: the
			header, the engine credit, and the page's own padding. History used to be
			under the board and cost another 5.5rem of that budget; beside it, the
			board keeps the height instead.

			The `max()` floors the board at 20rem — 40px squares, a shade wider than
			the 303px a 375px phone gets, and about the point below which the squares
			stop being comfortable to hit. Short windows scroll past the fold instead
			of shrinking further: a board too small to play on is worse than one you
			have to scroll to.

			The 9.25rem holds for a one-line engine credit. Under about 560px of
			height the column is narrow enough that the credit wraps, and the page
			runs a dozen or so pixels past the fold. Buying that back would mean
			taking a permanent 1rem off every board to spare a short window a small
			scroll, which is the wrong way round.
		-->
		<div class="flex w-full flex-col gap-4 lg:w-[max(35.25rem,calc(100vh-9.25rem+15.25rem))]">
			<!--
				History sits left of the board on a wide screen and below it once the
				layout stacks, where a 12rem column beside the board would leave the
				board unplayable. `order` does that with one instance of the component
				rather than two.
			-->
			<div class="flex flex-col gap-4 lg:flex-row lg:gap-3">
				<div class="order-2 lg:order-1 lg:w-48 lg:shrink-0">
					<MoveList moves={game.moves} />
				</div>

				<div class="order-1 flex gap-3 lg:order-2 lg:min-w-0 lg:flex-1">
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
			</div>

			<EngineCredit />
		</div>

		<CoachPanel {game} />
	</div>
</main>
