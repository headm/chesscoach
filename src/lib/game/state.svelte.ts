/**
 * Game orchestration: the move loop, the analysis calls, and the coach calls.
 *
 * Nothing here computes chess. Stockfish runs on the server behind
 * /api/engine — this class asks it to evaluate a position or to produce an
 * opponent move at the player's rating, and owns everything around those two
 * answers: grading, the move list, and when to talk to the coach.
 */

import { Chess, type Color, type Square } from 'chess.js';

import { extractFacts, filterFactsForBand, pvToSan } from '$lib/chess/facts';
import { openingName } from '$lib/chess/openings';
import { analyse, opponentMove } from '$lib/engine/client';
import { fromWhiteCp, toWhiteCp, type EngineLine } from '$lib/engine/uci';
import { bandFor, gradeMove, type MoveGrade } from '$lib/coach/levels';
import type { CandidateLine, CoachRequest, CoachResponse, PlayedMoveInfo } from '$lib/coach/types';

export interface MoveRecord {
	ply: number;
	san: string;
	color: Color;
	grade: MoveGrade | null;
	cpLoss: number | null;
	evalAfterWhiteCp: number;
}

export type Status = 'idle' | 'booting' | 'player-turn' | 'thinking' | 'coaching' | 'game-over';

export class Game {
	// ---- configuration ----
	elo = $state(1200);
	playerColor = $state<Color>('w');

	// ---- board ----
	private chess = new Chess();
	fen = $state(new Chess().fen());
	lastMove = $state<[Square, Square] | null>(null);
	moves = $state<MoveRecord[]>([]);
	status = $state<Status>('idle');
	resultText = $state<string | null>(null);

	// ---- evaluation ----
	evalWhiteCp = $state(0);

	// ---- coaching ----
	coach = $state<CoachResponse | null>(null);
	coachLoading = $state(false);
	hintLevel = $state(0);
	hint = $state<CoachResponse | null>(null);
	hintLoading = $state(false);

	/** Analysis of the current position with the player to move. */
	private currentAnalysis: EngineLine[] = [];
	/** Set once the component owning this game is gone, so late replies are dropped. */
	private disposed = false;

	get band() {
		return bandFor(this.elo);
	}

	get isPlayerTurn() {
		return this.turn === this.playerColor && this.status === 'player-turn';
	}

	/*
	 * Everything the board renders from is derived off `fen`, which is $state.
	 * Reading `this.chess` directly here would look correct but would never
	 * update: chess.js instances are not reactive, so a getter over one has no
	 * dependencies and Svelte computes it exactly once.
	 */
	turn: Color = $derived((this.fen.split(' ')[1] as Color) ?? 'w');

	inCheck = $derived.by(() => new Chess(this.fen).isCheck());

	/** Legal destinations keyed by origin square, in the shape chessground wants. */
	dests = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const m of new Chess(this.fen).moves({ verbose: true })) {
			map.set(m.from, [...(map.get(m.from) ?? []), m.to]);
		}
		return map;
	});

	async start(elo: number, color: Color) {
		this.elo = elo;
		this.playerColor = color;
		this.chess = new Chess();
		this.fen = this.chess.fen();
		this.moves = [];
		this.lastMove = null;
		this.evalWhiteCp = 0;
		this.coach = null;
		this.hint = null;
		this.hintLevel = 0;
		this.hintLoading = false;
		this.resultText = null;
		this.status = 'booting';

		if (color === 'b') {
			this.status = 'thinking';
			if (!(await this.engineMove())) return;
		}
		await this.refreshAnalysis();
		if (!this.checkGameOver() && !this.disposed) this.beginPlayerTurn();
	}

	destroy() {
		this.disposed = true;
	}

	/** Re-analyse the current position from the player's side and cache the result. */
	private async refreshAnalysis() {
		if (this.chess.isGameOver()) return;
		const fen = this.chess.fen();
		let lines: EngineLine[];
		try {
			lines = await analyse(fen);
		} catch {
			// A dropped analysis costs this move's grade and hint, not the game.
			return;
		}
		// The board may have moved on while the request was in flight.
		if (this.disposed || this.chess.fen() !== fen) return;
		this.currentAnalysis = lines;
		const top = this.currentAnalysis[0];
		if (top) this.evalWhiteCp = toWhiteCp(top, this.chess.turn());
	}

	/**
	 * Hand control back to the player and open with a hint.
	 *
	 * The first hint is not something the player has to ask for — it is the
	 * point of the app. The buttons in the panel only exist to escalate past it.
	 */
	private beginPlayerTurn() {
		this.status = 'player-turn';
		this.requestHint(1);
	}

	/** Best evaluation of the current position, from the player's point of view. */
	private currentPlayerCp(): number {
		const top = this.currentAnalysis[0];
		if (!top) return 0;
		return fromWhiteCp(toWhiteCp(top, this.chess.turn()), this.playerColor);
	}

	async playerMove(from: Square, to: Square, promotion: string = 'q'): Promise<boolean> {
		if (!this.isPlayerTurn) return false;

		const fenBefore = this.chess.fen();
		const cpBefore = this.currentPlayerCp();
		const candidatesBefore = this.toCandidates(fenBefore, this.currentAnalysis);

		let move;
		try {
			move = this.chess.move({ from, to, promotion });
		} catch {
			return false;
		}
		if (!move) return false;

		this.fen = this.chess.fen();
		this.lastMove = [from, to];
		this.hint = null;
		this.hintLevel = 0;
		// Any hint still in flight is for the position the player just left; its
		// reply will be discarded, so clear the spinner here rather than waiting.
		this.hintLoading = false;
		this.status = 'coaching';
		this.coachLoading = true;

		// Evaluate the resulting position to see what the move actually cost.
		await this.refreshAnalysis();
		const cpAfter = this.chess.isGameOver()
			? terminalCp(this.chess, this.playerColor)
			: fromWhiteCp(this.evalWhiteCp, this.playerColor);
		const cpLoss = Math.max(0, Math.round(cpBefore - cpAfter));
		const grade = gradeMove(cpLoss, this.band);

		const best = candidatesBefore[0];
		this.moves = [
			...this.moves,
			{
				ply: this.moves.length + 1,
				san: move.san,
				color: move.color,
				grade,
				cpLoss,
				evalAfterWhiteCp: this.evalWhiteCp
			}
		];

		const played: PlayedMoveInfo = {
			san: move.san,
			uci: from + to,
			cpBefore: Math.round(cpBefore),
			cpAfter: Math.round(cpAfter),
			cpLoss,
			grade,
			bestSan: best && best.moveSan !== move.san ? best.moveSan : null,
			bestPvSan: best ? best.pvSan : [],
			captured: move.captured ?? null,
			givesCheck: this.chess.isCheck()
		};

		// Feedback is about the position *before* the move, so the candidate list
		// and facts both come from `fenBefore`.
		this.requestCoach(
			{
				mode: 'feedback',
				playerElo: this.elo,
				playerColor: this.playerColor,
				fen: fenBefore,
				openingName: openingName(this.chess.history()),
				candidates: candidatesBefore.slice(0, this.band.candidateMoves),
				facts: filterFactsForBand(extractFacts(fenBefore, this.playerColor), this.band.id),
				playedMove: played
			},
			(res) => {
				if (this.disposed) return;
				this.coach = res;
				this.coachLoading = false;
			}
		);

		if (this.checkGameOver()) return true;

		this.status = 'thinking';
		if (!(await this.engineMove())) return true;
		if (this.checkGameOver()) return true;

		await this.refreshAnalysis();
		if (!this.disposed) this.beginPlayerTurn();
		return true;
	}

	/** Play the opponent's reply. Returns false when the game can't continue. */
	private async engineMove(): Promise<boolean> {
		if (this.chess.isGameOver()) return true;

		let uci: string | null;
		try {
			uci = await opponentMove(this.chess.fen(), this.elo);
		} catch {
			this.status = 'game-over';
			this.resultText = 'The engine stopped responding — start a new game to continue.';
			return false;
		}
		if (this.disposed) return false;
		if (!uci) return true;

		const from = uci.slice(0, 2) as Square;
		const to = uci.slice(2, 4) as Square;
		const move = this.chess.move({
			from,
			to,
			promotion: uci.length > 4 ? uci[4] : undefined
		});
		if (!move) return true;

		this.fen = this.chess.fen();
		this.lastMove = [from, to];
		this.moves = [
			...this.moves,
			{
				ply: this.moves.length + 1,
				san: move.san,
				color: move.color,
				grade: null,
				cpLoss: null,
				evalAfterWhiteCp: this.evalWhiteCp
			}
		];
		return true;
	}

	/**
	 * Fetch the hint for `level`, or the next one up if no level is given.
	 *
	 * Level 1 is fired automatically at the start of every player turn; 2 and 3
	 * are the "I need more" and "show me the move" buttons. Asking for a level
	 * at or below the one already on screen is a no-op — the panel would flicker
	 * back to a vaguer hint.
	 */
	requestHint(level?: 1 | 2 | 3) {
		const next = level ?? (Math.min(3, this.hintLevel + 1) as 1 | 2 | 3);
		if (!this.isPlayerTurn || this.hintLoading || next <= this.hintLevel) return;
		this.hintLevel = next;
		this.hintLoading = true;

		const fen = this.chess.fen();
		this.requestCoach(
			{
				mode: 'hint',
				playerElo: this.elo,
				playerColor: this.playerColor,
				fen,
				openingName: openingName(this.chess.history()),
				candidates: this.toCandidates(fen, this.currentAnalysis).slice(0, this.band.candidateMoves),
				facts: filterFactsForBand(extractFacts(fen, this.playerColor), this.band.id),
				hintLevel: next
			},
			(res) => {
				// Hints are now fired automatically, so one is almost always in flight
				// when the player moves. Dropping replies whose position has gone
				// keeps a stale hint off the board.
				if (this.disposed || this.chess.fen() !== fen) return;
				this.hint = res;
				this.hintLoading = false;
			}
		);
	}

	private requestCoach(req: CoachRequest, done: (res: CoachResponse) => void) {
		fetch('/api/coach', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(req)
		})
			.then((r) => r.json())
			.then(done)
			.catch(() => {
				done({
					headline: 'Coach unavailable',
					body: 'Could not reach the coaching service. Play on — analysis will resume shortly.',
					highlightSquares: [],
					revealedMove: null,
					fallback: true
				});
			});
	}

	/** Engine lines → coach-facing candidates, scored from the player's side. */
	private toCandidates(fen: string, lines: EngineLine[]): CandidateLine[] {
		const stm = new Chess(fen).turn();
		return lines.map((l, i) => ({
			rank: i + 1,
			moveSan: pvToSan(fen, [l.moveUci], 1)[0] ?? l.moveUci,
			moveUci: l.moveUci,
			cp: Math.round(fromWhiteCp(toWhiteCp(l, stm), this.playerColor)),
			mate: l.mate,
			pvSan: pvToSan(fen, l.pvUci, 6)
		}));
	}

	private checkGameOver(): boolean {
		if (!this.chess.isGameOver()) return false;
		this.status = 'game-over';
		if (this.chess.isCheckmate()) {
			const winner = this.chess.turn() === this.playerColor ? 'Computer' : 'You';
			this.resultText = `Checkmate — ${winner} won`;
		} else if (this.chess.isStalemate()) this.resultText = 'Draw by stalemate';
		else if (this.chess.isThreefoldRepetition()) this.resultText = 'Draw by repetition';
		else if (this.chess.isInsufficientMaterial()) this.resultText = 'Draw — insufficient material';
		else this.resultText = 'Draw by the fifty-move rule';
		return true;
	}

	/** Blunder summary for the end-of-game card. */
	get mistakes(): MoveRecord[] {
		return this.moves.filter(
			(m) => m.color === this.playerColor && (m.grade === 'mistake' || m.grade === 'blunder')
		);
	}
}

function terminalCp(chess: Chess, player: Color): number {
	if (chess.isCheckmate()) return chess.turn() === player ? -10_000 : 10_000;
	return 0;
}
