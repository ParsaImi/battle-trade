import { generateChart, splitChart, resolveDirection } from './chart.js';
import { applyMatchResult, recordRound } from './store.js';
import { getMode } from './gameModes.js';

const PHASES = { GUESS: 'guess', REVEAL: 'reveal', RESULTS: 'results', COMPLETE: 'complete' };

// The opponent calls the round correctly with probability `accuracy`.
// At 0.5 that's a plain coin flip; higher values make a sharper rival.
function botGuessFor(direction, accuracy) {
  if (direction === 'flat') return Math.random() < 0.5 ? 'up' : 'down';
  const gotItRight = Math.random() < accuracy;
  if (gotItRight) return direction;
  return direction === 'up' ? 'down' : 'up';
}

export class Match {
  constructor(guestId, onChange, options = {}) {
    this.guestId = guestId;
    this.onChange = onChange;
    this.mode = getMode(options.mode);
    this.wager = options.wager ?? 0;

    this.round = 0;
    this.playerScore = 0;
    this.botScore = 0;
    this.timer = null;
    this.matchResult = null;
    this.endReason = null;

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

  get currentStage() {
    return this.mode.stages ? this.mode.stages[this.stageIndex] : null;
  }

  get botAccuracy() {
    return this.currentStage?.botAccuracy ?? this.mode.botAccuracy ?? 0.5;
  }

  _startRound(opts = {}) {
    this.round += 1;
    this.stageRound += 1;
    this.candles = generateChart();
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

  _resolveRound() {
    const direction = resolveDirection(this.candles);
    const held = this.playerGuess === 'hold';

    // 'hold' (or no guess at all — the guess timer ran out) risks nothing
    // and earns nothing: only an 'up'/'down' call scores +1 or -1.
    let playerDelta = 0;
    if (this.playerGuess === 'up' || this.playerGuess === 'down') {
      const playerCorrect = direction !== 'flat' && this.playerGuess === direction;
      playerDelta = playerCorrect ? 1 : -1;
    }

    let botDelta = 0;
    if (!this.mode.solo) {
      this.botGuess = botGuessFor(direction, this.botAccuracy);
      const botCorrect = direction !== 'flat' && this.botGuess === direction;
      botDelta = botCorrect ? 1 : -1;
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

    recordRound(this.guestId, { playerDelta, held });

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
    if (this.stagePlayerScore === this.stageBotScore) return; // tie → extra round

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

  _completeMatch() {
    const m = this.mode;
    let outcome;
    let payoutOverride = null;

    if (m.suddenDeath) {
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

    const applied = applyMatchResult(this.guestId, outcome, {
      mode: m.id,
      payoutOverride,
      wager: this.wager,
      affectsStreak: m.affectsStreak !== false,
      score: m.suddenDeath ? this.survivalScore : this.playerScore,
    });

    this.matchResult = {
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
      playerScore: this.playerScore,
      botScore: this.botScore,
      survivalScore: this.survivalScore,
      stagesCleared: this.stagesCleared,
      stagesTotal: m.stages?.length ?? 0,
      wager: this.wager,
      rounds: this.round,
    };
    this.phase = PHASES.COMPLETE;
    this.onChange?.();
  }

  submitGuess(direction) {
    if (this.phase !== PHASES.GUESS) return false;
    const allowed = direction === 'up' || direction === 'down' || (direction === 'hold' && this.mode.holdAllowed !== false);
    if (!allowed) return false;
    if (this.playerGuess) return false;
    this.playerGuess = direction;
    clearTimeout(this.timer);
    this._advance();
    return true;
  }

  publicState() {
    const m = this.mode;
    return {
      mode: m.id,
      modeName: m.name,
      modeIcon: m.icon,
      solo: !!m.solo,
      holdAllowed: m.holdAllowed !== false,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      round: this.round,
      minRounds: m.minRounds ?? m.roundsPerStage ?? 0,
      overtime: !!(m.minRounds && this.round > m.minRounds),
      playerScore: this.playerScore,
      botScore: this.botScore,
      survivalScore: this.survivalScore,
      deadline: this.deadline,
      wager: this.wager,
      stageIndex: this.stageIndex,
      stageName: this.currentStage?.name ?? null,
      stagesCleared: this.stagesCleared,
      stagesTotal: m.stages?.length ?? 0,
      stagePlayerScore: this.stagePlayerScore,
      stageBotScore: this.stageBotScore,
      candles: this.phase === PHASES.GUESS ? this.visible : this.candles,
      roundOutcome: this.phase === PHASES.REVEAL || this.phase === PHASES.RESULTS ? this.lastRoundOutcome : null,
      matchResult: this.matchResult,
    };
  }
}
