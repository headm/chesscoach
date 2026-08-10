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

<main class="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
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

	<div class="flex flex-col gap-6 lg:flex-row">
		<div class="flex flex-1 flex-col gap-4">
			<div class="flex gap-3">
				<EvalBar whiteCp={game.evalWhiteCp} orientation={playerColor} />
				<!-- The board is aspect-square, so capping its width also caps its height.
				     Without this it fills the column and pushes the move list off-screen
				     on a laptop-height viewport. -->
				<div class="min-w-0 flex-1 lg:max-w-[calc(100vh-15rem)]">
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
