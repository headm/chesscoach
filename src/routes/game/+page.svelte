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

	const highlight = $derived(game.hint?.highlightSquares ?? game.coach?.highlightSquares ?? []);
	const cgColor = (c: Color) => (c === 'w' ? 'white' : 'black');
</script>

<main class="mx-auto flex max-w-6xl flex-col gap-6 p-4 lg:flex-row lg:p-6">
	<div class="flex flex-1 flex-col gap-4">
		<div class="flex items-center justify-between">
			<a href="/" class="text-sm text-slate-400 transition hover:text-slate-200">← New game</a>
			<span class="text-xs text-slate-500">
				{game.status === 'thinking'
					? 'Computer is thinking…'
					: game.status === 'player-turn'
						? 'Your move'
						: game.status === 'booting'
							? 'Loading engines…'
							: game.status === 'game-over'
								? 'Game over'
								: 'Reviewing…'}
			</span>
		</div>

		<div class="flex gap-3">
			<EvalBar whiteCp={game.evalWhiteCp} orientation={playerColor} />
			<!-- The board is aspect-square, so capping its width also caps its height.
			     Without this it fills the column and pushes the move list off-screen
			     on a laptop-height viewport. -->
			<div class="min-w-0 flex-1 lg:max-w-[calc(100vh-13rem)]">
				<Board
					fen={game.fen}
					orientation={cgColor(playerColor)}
					turnColor={cgColor(game.turn)}
					movableColor={game.isPlayerTurn ? cgColor(playerColor) : undefined}
					dests={game.dests}
					lastMove={game.lastMove}
					check={game.inCheck}
					{highlight}
					onMove={(from, to) => game.playerMove(from as never, to as never)}
				/>
			</div>
		</div>

		<MoveList moves={game.moves} />
		<EngineCredit />
	</div>

	<CoachPanel {game} />
</main>
