import { generateRound, splitChart, resolveDirection } from './chart.js';
import { applyMatchResult, recordRound, getGuestPublic } from './store.js';
import { getMode } from './gameModes.js';
import { makeBotOpponent, opponentFromProfile } from './opponents.js';

const PHASES = { GUESS: 'guess', REVEAL: 'reveal', RESULTS: 'results', COMPLETE: 'complete' };

// Four players, two a side.
//
// A round is scored per TEAM as the sum of its members' calls: both right is
// +2, both wrong is -2, and one of each cancels to 0. That is just the sum of
// two +1/-1 calls, so no special case is needed — the rule falls out of the
// arithmetic. A hold or a timeout contributes 0, so a lone correct call with a
// silent partner is +1.
//
// Deliberately separate from Match rather than folding four seats into it:
// Match carries the Survival, Blitz and Gauntlet rules across two seats and is
// covered by most of the suite. Duos needs only the Classic ruleset — minimum
// rounds, then win by two — so a focused class is far less code than
// generalising that one, and cannot break the five modes already working.
export class TeamMatch {
  /**
   * @param seats  four { guestId, identity } in team order: 0,1 are team A and
   *               2,3 are team B. A seat with a null guestId is an AI.
   * @param onChange fires on every state change; the caller broadcasts it
   */
  constructor(seats, onChange, options = {}) {
    this.mode = getMode(options.mode);
    this.wager = options.wager ?? 0;
    this.onChange = onChange;

    this.seats = seats.map((s, i) => ({
      guestId: s.guestId ?? null,
      isBot: !s.guestId,
      team: i < 2 ? 0 : 1,
      identity: s.guestId ? opponentFromProfile(getGuestPublic(s.guestId)) : makeBotOpponent(),
      guess: null,
      lastDelta: 0,
    }));

    this.teams = [
      { score: 0, members: this.seats.filter((s) => s.team === 0) },
      { score: 0, members: this.seats.filter((s) => s.team === 1) },
    ];

    this.round = 0;
    this.timer = null;
    this.results = {};
    this.matchResult = null;
    this.endReason = null;
    this.mutedViewers = new Set();
    this.lastRoundOutcome = null;

    // Silent first phase: onChange would otherwise fire before the caller's
    // `new TeamMatch(...)` assignment completes (HANDOFF section 10).
    this._startRound({ silent: true });
  }

  destroy() {
    clearTimeout(this.timer);
  }

  get isPvp() {
    return this.seats.some((s) => !s.isBot && s.guestId);
  }

  get participants() {
    return this.seats.filter((s) => s.guestId).map((s) => s.guestId);
  }

  _seatFor(guestId) {
    return this.seats.find((s) => s.guestId === guestId) ?? null;
  }

  get botAccuracy() {
    return this.mode.botAccuracy ?? 0.5;
  }

  _startRound(opts = {}) {
    this.round += 1;
    const round = generateRound();
    this.candles = round.candles;
    this.history = round.history ?? [];
    this.chartMeta = round.meta;
    this.visible = splitChart(this.candles).visible;
    this.lastRoundOutcome = null;
    for (const s of this.seats) {
      s.guess = null;
      s.lastDelta = 0;
    }
    this._setPhase(PHASES.GUESS, this.mode.guessMs, opts);
  }

  _setPhase(phase, durationMs, { silent = false } = {}) {
    this.phase = phase;
    this.phaseEndsAt = Date.now() + durationMs;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._advance(), durationMs);
    if (!silent) this.onChange?.();
  }

  _advance() {
    if (this.phase === PHASES.GUESS) {
      this._resolveRound();
      this._setPhase(PHASES.REVEAL, this.mode.revealMs);
      return;
    }
    if (this.phase === PHASES.REVEAL) {
      this._setPhase(PHASES.RESULTS, this.mode.resultsMs);
      return;
    }
    if (this._shouldPlayAnotherRound()) this._startRound();
    else this._completeMatch();
  }

  _shouldPlayAnotherRound() {
    if (this.round >= (this.mode.maxRounds ?? 11)) return false;
    if (this.round < this.mode.minRounds) return true;
    return Math.abs(this.teams[0].score - this.teams[1].score) < 2;
  }

  // Only an up/down call scores. Hold and "never answered" are both 0.
  _deltaFor(guess, direction) {
    if (guess !== 'up' && guess !== 'down') return 0;
    return direction !== 'flat' && guess === direction ? 1 : -1;
  }

  _botGuess(direction) {
    if (direction === 'flat') return Math.random() < 0.5 ? 'up' : 'down';
    const right = Math.random() < this.botAccuracy;
    if (right) return direction;
    return direction === 'up' ? 'down' : 'up';
  }

  _resolveRound() {
    const direction = resolveDirection(this.candles);

    for (const s of this.seats) {
      if (s.isBot) s.guess = this._botGuess(direction);
      s.lastDelta = this._deltaFor(s.guess, direction);
      if (s.guestId) {
        recordRound(s.guestId, { playerDelta: s.lastDelta, held: s.guess === 'hold' });
      }
    }

    // The whole team rule, in one line: sum the side's calls.
    const deltas = this.teams.map((t) => t.members.reduce((sum, s) => sum + s.lastDelta, 0));
    this.teams[0].score += deltas[0];
    this.teams[1].score += deltas[1];

    this.lastRoundOutcome = { direction, teamDeltas: deltas };
  }

  submitGuess(direction, guestId) {
    if (this.phase !== PHASES.GUESS) return false;
    const seat = this._seatFor(guestId);
    if (!seat || seat.guess) return false;
    const allowed =
      direction === 'up' || direction === 'down' || (direction === 'hold' && this.mode.holdAllowed !== false);
    if (!allowed) return false;

    seat.guess = direction;

    // Resolve as soon as every human has called; the AI seats answer at
    // resolution, so they are never something to wait on.
    const humansPending = this.seats.some((s) => !s.isBot && s.guestId && !s.guess);
    if (humansPending) {
      this.onChange?.();
      return true;
    }
    clearTimeout(this.timer);
    this._advance();
    return true;
  }

  // A player dropping out costs their team the match; the other side takes it.
  forfeit(guestId) {
    if (this.phase === PHASES.COMPLETE) return;
    const seat = this._seatFor(guestId);
    if (!seat) return;
    clearTimeout(this.timer);
    this.endReason = 'opponent_left';
    this._completeMatch({ forfeitedTeam: seat.team });
  }

  _completeMatch({ forfeitedTeam = null } = {}) {
    const m = this.mode;
    const [a, b] = this.teams.map((t) => t.score);

    let winner; // 0, 1, or null for a draw
    if (forfeitedTeam !== null) winner = forfeitedTeam === 0 ? 1 : 0;
    else if (a > b) winner = 0;
    else if (b > a) winner = 1;
    else winner = null;

    for (const seat of this.seats) {
      if (!seat.guestId) continue;
      const outcome = winner === null ? 'draw' : seat.team === winner ? 'win' : 'loss';
      const mine = this.teams[seat.team].score;
      const theirs = this.teams[seat.team === 0 ? 1 : 0].score;

      const applied = applyMatchResult(seat.guestId, outcome, {
        mode: m.id,
        wager: this.wager,
        affectsStreak: m.affectsStreak !== false,
        score: mine,
      });

      this.results[seat.guestId] = {
        mode: m.id,
        modeName: m.name,
        outcome,
        endReason: this.endReason,
        delta: applied.delta,
        streak: applied.streak,
        multiplier: applied.multiplier,
        leveledUpTo: applied.leveledUpTo,
        newAchievements: applied.newAchievements,
        newBest: applied.newBest,
        playerScore: mine,
        botScore: theirs,
        survivalScore: 0,
        stagesCleared: 0,
        stagesTotal: 0,
        wager: this.wager,
        rounds: this.round,
        pvp: this.isPvp,
        team: true,
        // Who was on your side, so the result can say "you and X".
        teammate: this.teams[seat.team].members.find((s) => s !== seat)?.identity?.nickname ?? null,
      };
    }

    this.matchResult = this.results[this.seats.find((s) => s.guestId)?.guestId] ?? null;
    this.phase = PHASES.COMPLETE;
    this.onChange?.();
  }

  _chartMetaFor(phase) {
    const meta = this.chartMeta;
    if (!meta) return null;
    if (phase !== PHASES.GUESS) return meta;
    // Instrument and timeframe are fine mid-round; the date is the lookup key.
    const { date, ...safe } = meta;
    return safe;
  }

  publicState(viewerId) {
    const m = this.mode;
    const seat = this._seatFor(viewerId);
    // A viewer with no seat (should not happen) is shown team A's side.
    const myTeam = seat?.team ?? 0;
    const theirTeam = myTeam === 0 ? 1 : 0;

    const side = (t) =>
      this.teams[t].members.map((s) => ({
        nickname: s.identity?.nickname ?? 'Trader',
        avatar: s.identity?.avatar ?? null,
        isBot: s.isBot,
        you: s.guestId != null && s.guestId === viewerId,
        // Whether they have called, never what they called.
        lockedIn: this.phase === PHASES.GUESS ? !!s.guess : false,
      }));

    const o = this.lastRoundOutcome;
    const roundOutcome =
      o && (this.phase === PHASES.REVEAL || this.phase === PHASES.RESULTS)
        ? {
            direction: o.direction,
            playerGuess: seat?.guess ?? null,
            botGuess: null,
            playerDelta: o.teamDeltas[myTeam],
            botDelta: o.teamDeltas[theirTeam],
          }
        : null;

    return {
      mode: m.id,
      modeName: m.name,
      modeIcon: m.icon,
      solo: false,
      pvp: this.isPvp,
      team: true,
      holdAllowed: m.holdAllowed !== false,
      // Both line-ups, from this viewer's point of view.
      yourTeam: side(myTeam),
      theirTeam: side(theirTeam),
      opponent: this.teams[theirTeam].members[0]?.identity ?? null,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      round: this.round,
      minRounds: m.minRounds ?? 0,
      overtime: !!(m.minRounds && this.round > m.minRounds),
      playerScore: this.teams[myTeam].score,
      botScore: this.teams[theirTeam].score,
      yourGuess: this.phase === PHASES.GUESS ? (seat?.guess ?? null) : null,
      opponentLockedIn: false,
      survivalScore: 0,
      deadline: null,
      wager: this.wager,
      stagesCleared: 0,
      stagesTotal: 0,
      stagePlayerScore: 0,
      stageBotScore: 0,
      candles: [...this.history, ...(this.phase === PHASES.GUESS ? this.visible : this.candles)],
      historyCount: this.history.length,
      chartMeta: this._chartMetaFor(this.phase),
      roundOutcome,
      matchResult: this.results[viewerId] ?? null,
    };
  }
}
