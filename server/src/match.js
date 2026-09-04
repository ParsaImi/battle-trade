import { generateRound, splitChart, resolveDirection } from './chart.js';
import { applyMatchResult, recordRound, getGuestPublic } from './store.js';
import { getMode } from './gameModes.js';
import { makeBotOpponent, opponentFromProfile } from './opponents.js';

const PHASES = { GUESS: 'guess', REVEAL: 'reveal', RESULTS: 'results', COMPLETE: 'complete' };

// A match has two seats. Seat "player" is always the human who created the
// match. Seat "opponent" is either the AI or a second human, and the code below
// keeps the wire field names (`botScore`, `botGuess`) for that seat in both
// cases so the client did not need rewriting — read "bot" as "the other seat",
// which in a PvP match is a person.
//
// publicState(viewerId) renders the match from one seat's point of view, so a
// PvP opponent reads their own score as `playerScore`. One player is never sent
// the other's unresolved call: during the guess phase only `opponentLockedIn`
// (a boolean) crosses the wire.

// The AI calls the round correctly with probability `accuracy`.
// At 0.5 that's a plain coin flip; higher values make a sharper rival.
function botGuessFor(direction, accuracy) {
  if (direction === 'flat') return Math.random() < 0.5 ? 'up' : 'down';
  const gotItRight = Math.random() < accuracy;
  if (gotItRight) return direction;
  return direction === 'up' ? 'down' : 'up';
}

function mirror(outcome) {
  if (outcome === 'win') return 'loss';
  if (outcome === 'loss') return 'win';
  return outcome;
}

export class Match {
  /**
   * @param guestId  seat "player" — the human who created the match
   * @param onChange fires whenever state changes; the caller broadcasts it
   * @param options  { mode, wager, opponent }
   *                 `opponent` is a real player's identity for PvP; omit it
   *                 (or pass null) to face the AI.
   */
  constructor(guestId, onChange, options = {}) {
    this.guestId = guestId;
    this.onChange = onChange;
    this.mode = getMode(options.mode);
    this.wager = options.wager ?? 0;

    // Identities resolve once, here, so they cannot drift mid-match.
    this.playerIdentity = opponentFromProfile(getGuestPublic(guestId));
    // A caller that already announced an opponent (the matchmaking "found"
    // card) passes it in, so the identity shown there is the identity played
    // against — bot or human alike.
    this.opponent = this.mode.solo ? null : (options.opponent ?? makeBotOpponent());
    this.isPvp = !!(this.opponent && !this.opponent.isBot);
    // Both sides stake the same amount in a wagered PvP match.
    this.opponentWager = this.isPvp ? this.wager : 0;

    this.round = 0;
    this.playerScore = 0;
    this.botScore = 0;
    this.timer = null;
    this.matchResult = null;
    this.endReason = null;
    // Per-seat results — payouts, streaks and level-ups differ per player.
    this.results = {};
    // Seats that should stop receiving frames: a player who walked out
    // forfeits, but should land back in the lobby rather than be shown the
    // completion screen they just chose to leave.
    this.mutedViewers = new Set();

    // Survival: how many rounds called correctly before dying.
    this.survivalScore = 0;
    // Blitz: whole-session clock.
    this.deadline = this.mode.totalTimeMs ? Date.now() + this.mode.totalTimeMs : null;
    // Gauntlet: which rival we're on, and the per-stage scoreline.
    this.stageIndex = 0;
    this.stageRound = 0;
    this.stagePlayerScore = 0;
    this.stageBotScore = 0;
    this.stagesCleared = 0;

    // Skip the onChange callback for this first phase — it would fire
    // synchronously here, before the caller's `new Match(...)` assignment
    // (and any closure over that variable) has completed.
    this._startRound({ silent: true });
  }

  destroy() {
    clearTimeout(this.timer);
  }

  // Every guestId seated in this match, for the caller to broadcast to.
  get participants() {
    return this.isPvp ? [this.guestId, this.opponent.guestId] : [this.guestId];
  }

  _seatFor(guestId) {
    if (guestId === this.guestId) return 'player';
    if (this.isPvp && guestId === this.opponent.guestId) return 'opponent';
    return null;
  }

  get currentStage() {
    return this.mode.stages ? this.mode.stages[this.stageIndex] : null;
  }

  get botAccuracy() {
    return this.currentStage?.botAccuracy ?? this.mode.botAccuracy ?? 0.5;
  }

  _startRound(opts = {}) {
    this.round += 1;
    this.stageRound += 1;
    // One chart per round, shared by both seats — a PvP pair must be looking
    // at exactly the same candles.
    const round = generateRound();
    this.candles = round.candles;
    // Which instrument and date this window came from. Withheld until the
    // round resolves: naming it during the guess phase would let a player
    // look up what the price actually did next.
    this.chartMeta = round.meta;
    this.visible = splitChart(this.candles).visible;
    this.playerGuess = null;
    this.botGuess = null;
    this.lastRoundOutcome = null;

    // In Blitz, never let a guess window outlive the session clock.
    let guessMs = this.mode.guessMs;
    if (this.deadline) guessMs = Math.max(1200, Math.min(guessMs, this.deadline - Date.now()));

    this._setPhase(PHASES.GUESS, guessMs, opts);
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
    if (this._shouldPlayAnotherRound()) {
      this._startRound();
    } else {
      this._completeMatch();
    }
  }

  _shouldPlayAnotherRound() {
    if (this.round >= (this.mode.maxRounds ?? 11)) return false;

    // Survival: a wrong call (or a timeout) ends the run immediately.
    if (this.mode.suddenDeath) return !this.dead;

    // Blitz: keep going until the session clock runs out.
    if (this.deadline) return Date.now() < this.deadline - 800;

    // Gauntlet: stages of N rounds; you must be ahead to advance.
    if (this.mode.stages) {
      if (this.eliminated) return false;
      return this.stagesCleared < this.mode.stages.length;
    }

    // Classic / High Stakes: minimum rounds, then win by two.
    if (this.round < this.mode.minRounds) return true;
    return Math.abs(this.playerScore - this.botScore) < 2;
  }

  // Score one call. 'hold' and "never answered" both risk nothing and earn
  // nothing — only an up/down call moves the score.
  _deltaFor(guess, direction) {
    if (guess !== 'up' && guess !== 'down') return 0;
    return direction !== 'flat' && guess === direction ? 1 : -1;
  }

  _resolveRound() {
    const direction = resolveDirection(this.candles);

    const playerDelta = this._deltaFor(this.playerGuess, direction);

    let botDelta = 0;
    if (!this.mode.solo) {
      // In PvP the other seat's call is already in (or they ran out of time and
      // it stays null); only the AI needs one generated here.
      if (!this.isPvp) this.botGuess = botGuessFor(direction, this.botAccuracy);
      botDelta = this._deltaFor(this.botGuess, direction);
      this.botScore += botDelta;
      this.stageBotScore += botDelta;
    }

    this.playerScore += playerDelta;
    this.stagePlayerScore += playerDelta;

    if (this.mode.suddenDeath) {
      if (playerDelta > 0) {
        this.survivalScore += 1;
      } else {
        // A wrong call ends the run; so does letting the clock run out.
        this.dead = true;
        this.endReason = this.playerGuess ? 'wrong_call' : 'timeout';
      }
    }

    if (this.mode.stages) this._evaluateStage();

    recordRound(this.guestId, { playerDelta, held: this.playerGuess === 'hold' });
    if (this.isPvp) {
      recordRound(this.opponent.guestId, { playerDelta: botDelta, held: this.botGuess === 'hold' });
    }

    this.lastRoundOutcome = {
      direction,
      playerGuess: this.playerGuess,
      botGuess: this.botGuess,
      playerDelta,
      botDelta,
    };
  }

  // Gauntlet: after the minimum rounds for a stage, whoever leads takes it.
  _evaluateStage() {
    if (this.stageRound < this.mode.roundsPerStage) return;
    if (this.stagePlayerScore === this.stageBotScore) return; // tie -> extra round

    if (this.stagePlayerScore > this.stageBotScore) {
      this.stagesCleared += 1;
      this.stageIndex = Math.min(this.stageIndex + 1, this.mode.stages.length - 1);
    } else {
      this.eliminated = true;
      this.endReason = 'eliminated';
    }
    this.stageRound = 0;
    this.stagePlayerScore = 0;
    this.stageBotScore = 0;
  }

  // A PvP player disconnected or walked out. Whoever is still here takes the
  // win. An AI is never swapped in under the departed player's name — that
  // would be fabricating a person (HANDOFF section 11).
  forfeit(guestId) {
    if (this.phase === PHASES.COMPLETE) return;
    const seat = this._seatFor(guestId);
    if (!seat) return;
    clearTimeout(this.timer);
    this.endReason = 'opponent_left';
    this._completeMatch({ forfeitedBy: seat });
  }

  _completeMatch({ forfeitedBy = null } = {}) {
    const m = this.mode;
    let outcome;
    let payoutOverride = null;

    if (forfeitedBy) {
      // Whoever is left standing wins, whatever the scoreline said.
      outcome = forfeitedBy === 'player' ? 'loss' : 'win';
    } else if (m.suddenDeath) {
      // Survival pays per round survived, escalating.
      outcome = this.survivalScore > 0 ? 'win' : 'loss';
      let total = 0;
      for (let i = 1; i <= this.survivalScore; i++) total += m.payoutBase + i * m.payoutStep;
      payoutOverride = total;
    } else if (m.totalTimeMs) {
      // Blitz pays per net correct call.
      outcome = this.playerScore > 0 ? 'win' : 'loss';
      payoutOverride = Math.max(0, this.playerScore) * m.payoutPerPoint;
    } else if (m.stages) {
      const cleared = this.stagesCleared;
      outcome = cleared >= m.stages.length ? 'win' : 'loss';
      payoutOverride = cleared * m.stageBonus + (outcome === 'win' ? m.clearBonus : 0);
    } else {
      outcome = this.playerScore > this.botScore ? 'win' : this.playerScore < this.botScore ? 'loss' : 'draw';
    }

    this.results[this.guestId] = this._applyFor(this.guestId, outcome, {
      payoutOverride,
      wager: this.wager,
      score: m.suddenDeath ? this.survivalScore : this.playerScore,
      myScore: this.playerScore,
      theirScore: this.botScore,
    });

    if (this.isPvp) {
      this.results[this.opponent.guestId] = this._applyFor(this.opponent.guestId, mirror(outcome), {
        payoutOverride,
        wager: this.opponentWager,
        score: this.botScore,
        myScore: this.botScore,
        theirScore: this.playerScore,
      });
    }

    // Kept for solo callers and tests that read the creator's result directly.
    this.matchResult = this.results[this.guestId];
    this.phase = PHASES.COMPLETE;
    this.onChange?.();
  }

  _applyFor(guestId, outcome, { payoutOverride, wager, score, myScore, theirScore }) {
    const m = this.mode;
    const applied = applyMatchResult(guestId, outcome, {
      mode: m.id,
      payoutOverride,
      wager,
      affectsStreak: m.affectsStreak !== false,
      score,
    });

    return {
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
      playerScore: myScore,
      botScore: theirScore,
      survivalScore: this.survivalScore,
      stagesCleared: this.stagesCleared,
      stagesTotal: m.stages?.length ?? 0,
      wager,
      rounds: this.round,
      pvp: this.isPvp,
    };
  }

  submitGuess(direction, guestId = this.guestId) {
    if (this.phase !== PHASES.GUESS) return false;
    const seat = this._seatFor(guestId);
    if (!seat) return false;

    const allowed =
      direction === 'up' || direction === 'down' || (direction === 'hold' && this.mode.holdAllowed !== false);
    if (!allowed) return false;

    if (seat === 'player') {
      if (this.playerGuess) return false;
      this.playerGuess = direction;
    } else {
      if (this.botGuess) return false;
      this.botGuess = direction;
    }

    // A solo/AI match resolves the moment the player calls it. A PvP round
    // waits for both seats, or for the timer, which scores a missing call as
    // a no-call.
    if (this.isPvp && !(this.playerGuess && this.botGuess)) {
      this.onChange?.();
      return true;
    }

    clearTimeout(this.timer);
    this._advance();
    return true;
  }

  publicState(viewerId = this.guestId) {
    const m = this.mode;
    const asOpponent = this.isPvp && viewerId === this.opponent.guestId;

    // Flip the scoreline so each player reads their own score as "yours".
    const mine = asOpponent ? this.botScore : this.playerScore;
    const theirs = asOpponent ? this.playerScore : this.botScore;
    const myStage = asOpponent ? this.stageBotScore : this.stagePlayerScore;
    const theirStage = asOpponent ? this.stagePlayerScore : this.stageBotScore;
    const myGuess = asOpponent ? this.botGuess : this.playerGuess;
    const theirGuess = asOpponent ? this.playerGuess : this.botGuess;

    const o = this.lastRoundOutcome;
    const roundOutcome =
      o && (this.phase === PHASES.REVEAL || this.phase === PHASES.RESULTS)
        ? {
            direction: o.direction,
            playerGuess: asOpponent ? o.botGuess : o.playerGuess,
            botGuess: asOpponent ? o.playerGuess : o.botGuess,
            playerDelta: asOpponent ? o.botDelta : o.playerDelta,
            botDelta: asOpponent ? o.playerDelta : o.botDelta,
          }
        : null;

    return {
      mode: m.id,
      modeName: m.name,
      modeIcon: m.icon,
      solo: !!m.solo,
      pvp: this.isPvp,
      holdAllowed: m.holdAllowed !== false,
      // Who the viewer is facing: the AI, or the player on the other seat.
      opponent: asOpponent ? this.playerIdentity : this.opponent,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      round: this.round,
      minRounds: m.minRounds ?? m.roundsPerStage ?? 0,
      overtime: !!(m.minRounds && this.round > m.minRounds),
      playerScore: mine,
      botScore: theirs,
      // Enough for "they've locked in" — never the call itself, which would
      // hand the viewer a free answer while their own guess is still open.
      yourGuess: this.phase === PHASES.GUESS ? myGuess : null,
      opponentLockedIn: this.isPvp && this.phase === PHASES.GUESS ? !!theirGuess : false,
      survivalScore: this.survivalScore,
      deadline: this.deadline,
      wager: asOpponent ? this.opponentWager : this.wager,
      stageIndex: this.stageIndex,
      stageName: this.currentStage?.name ?? null,
      stagesCleared: this.stagesCleared,
      stagesTotal: m.stages?.length ?? 0,
      stagePlayerScore: myStage,
      stageBotScore: theirStage,
      candles: this.phase === PHASES.GUESS ? this.visible : this.candles,
      // Only ever sent once the calls are locked in and the chart is revealed.
      chartMeta: this.phase === PHASES.GUESS ? null : this.chartMeta,
      roundOutcome,
      matchResult: this.results[viewerId] ?? null,
    };
  }
}
