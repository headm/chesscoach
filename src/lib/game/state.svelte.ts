/**
 * Game orchestration: two engine instances, the move loop, and the coach calls.
 *
 * Two Stockfish workers run side by side — an analyst at full strength whose
 * output feeds the coach, and an opponent throttled to the player's ELO. The
 * coaching has to be correct even when the opponent is playing at 800, so they
 * cannot be the same instance.
 */

import { Chess, type Color, type Square } from 'chess.js';

import { extractFacts, filterFactsForBand, pvToSan } from '$lib/chess/facts';
import { openingName } from '$lib/chess/openings';
import { Engine, fromWhiteCp, toWhiteCp, type EngineLine } from '$lib/engine/uci';
import { ANALYST_DEPTH, ANALYST_OPTIONS, opponentConfig, pickOpponentMove } from '$lib/engine/strength';
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

	private analyst: Engine | null = null;
	private opponent: Engine | null = null;
	/** Analysis of the current position with the player to move. */
	private currentAnalysis: EngineLine[] = [];

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
		this.resultText = null;
		this.status = 'booting';

		this.analyst?.destroy();
		this.opponent?.destroy();

		this.analyst = new Engine();
		this.opponent = new Engine();

		const cfg = opponentConfig(elo);
		await Promise.all([
			this.analyst.setOptions({ ...ANALYST_OPTIONS, MultiPV: 3 }),
			this.opponent.setOptions(cfg.options)
		]);

		if (color === 'b') {
			this.status = 'thinking';
			await this.engineMove();
		}
		await this.refreshAnalysis();
		if (!this.checkGameOver()) this.status = 'player-turn';
	}

	destroy() {
		this.analyst?.destroy();
		this.opponent?.destroy();
		this.analyst = null;
		this.opponent = null;
	}

	/** Re-analyse the current position from the player's side and cache the result. */
	private async refreshAnalysis() {
		if (!this.analyst || this.chess.isGameOver()) return;
		this.currentAnalysis = await this.analyst.analyse(this.chess.fen(), {
			multipv: 3,
			depth: ANALYST_DEPTH
		});
		const top = this.currentAnalysis[0];
		if (top) this.evalWhiteCp = toWhiteCp(top, this.chess.turn());
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
				moveNumber: this.chess.moveNumber(),
				openingName: openingName(this.chess.history()),
				candidates: candidatesBefore.slice(0, this.band.candidateMoves),
				facts: filterFactsForBand(extractFacts(fenBefore, this.playerColor), this.band.id),
				playedMove: played
			},
			(res) => {
				this.coach = res;
				this.coachLoading = false;
			}
		);

		if (this.checkGameOver()) return true;

		this.status = 'thinking';
		await this.engineMove();
		if (this.checkGameOver()) return true;

		await this.refreshAnalysis();
		this.status = 'player-turn';
		return true;
	}

	private async engineMove() {
		if (!this.opponent || this.chess.isGameOver()) return;
		const cfg = opponentConfig(this.elo);

		let uci: string;
		if (cfg.multipv > 1) {
			const lines = await this.opponent.analyse(this.chess.fen(), {
				multipv: cfg.multipv,
				movetime: cfg.movetime
			});
			uci = pickOpponentMove(lines, cfg);
		} else {
			uci = await this.opponent.bestMove(this.chess.fen(), cfg.movetime);
		}

		const from = uci.slice(0, 2) as Square;
		const to = uci.slice(2, 4) as Square;
		const move = this.chess.move({
			from,
			to,
			promotion: uci.length > 4 ? uci[4] : undefined
		});
		if (!move) return;

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
	}

	async requestHint() {
		if (!this.isPlayerTurn || this.hintLoading) return;
		const next = Math.min(3, this.hintLevel + 1) as 1 | 2 | 3;
		this.hintLevel = next;
		this.hintLoading = true;

		const fen = this.chess.fen();
		this.requestCoach(
			{
				mode: 'hint',
				playerElo: this.elo,
				playerColor: this.playerColor,
				fen,
				moveNumber: this.chess.moveNumber(),
				openingName: openingName(this.chess.history()),
				candidates: this.toCandidates(fen, this.currentAnalysis).slice(0, this.band.candidateMoves),
				facts: filterFactsForBand(extractFacts(fen, this.playerColor), this.band.id),
				hintLevel: next
			},
			(res) => {
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
