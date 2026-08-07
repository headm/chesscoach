/**
 * Browser-side handle on the server engine.
 *
 * The whole of the client's relationship with Stockfish is these two calls.
 * Depth, MultiPV and skill settings live on the server (see
 * `src/routes/api/engine/+server.ts`) — the client only says which position and
 * which rating.
 */

import type { EngineLine } from './uci';

async function post<T>(body: unknown): Promise<T> {
	const res = await fetch('/api/engine', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`engine request failed: ${res.status}`);
	return (await res.json()) as T;
}

/** Full-strength analysis of `fen`, best line first. Scores are side-to-move relative. */
export async function analyse(fen: string): Promise<EngineLine[]> {
	const { lines } = await post<{ lines: EngineLine[] }>({ op: 'analyse', fen });
	return lines;
}

/** One opponent move in UCI notation, played at roughly `elo` strength. */
export async function opponentMove(fen: string, elo: number): Promise<string | null> {
	const { uci } = await post<{ uci: string | null }>({ op: 'opponent-move', fen, elo });
	return uci;
}
