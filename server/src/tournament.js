// Eight-player single-elimination brackets.
//
// Entry costs 10% of whatever coins you have, every entry goes into one pot,
// and the player who wins three matches takes the lot. Because the fee scales
// with what you own, a rich player risks more to enter than a new one, and the
// pot is worth roughly what the field brought to it.
//
// This holds the bracket only. It does not create or run matches: index.js
// owns match lifecycles, asks this what the current pairings are, and reports
// winners back. Keeping the two apart is what stops a tournament from turning
// into a second, competing scheduler.

import { log } from './logger.js';
import { makeBotOpponent, opponentFromProfile } from './opponents.js';
import { getGuestPublic } from './store.js';

export const SIZE = 8;
export const ROUNDS = 3; // 8 -> 4 -> 2 -> 1
export const ENTRY_FRACTION = 0.1;
export const MIN_ENTRY = 10;

// What entering costs this player. Floored, with a small minimum so a player
// with almost nothing still has some skin in it.
export function entryFeeFor(coins) {
  return Math.max(MIN_ENTRY, Math.floor((coins ?? 0) * ENTRY_FRACTION));
}

const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'];

let nextId = 1;

export class Tournament {
  /**
   * @param entrants up to SIZE of { guestId, fee }. Any shortfall is filled
   *                 with AI, who pay nothing into the pot.
   */
  constructor(entrants) {
    this.id = `t${nextId++}`;
    this.createdAt = Date.now();
    this.prize = entrants.reduce((sum, e) => sum + (e.fee ?? 0), 0);

    // Shuffle so the bracket is not simply arrival order — otherwise two
    // players who queued together always meet in the first round.
    const seats = [...entrants];
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    while (seats.length < SIZE) seats.push({ guestId: null, fee: 0 });

    this.players = seats.map((s, i) => ({
      seat: i,
      guestId: s.guestId ?? null,
      isBot: !s.guestId,
      identity: s.guestId ? opponentFromProfile(getGuestPublic(s.guestId)) : makeBotOpponent(),
      out: false,
    }));

    this.roundIndex = 0;
    // Each round is a list of { a, b, winner } holding player indexes.
    this.rounds = [this._pairUp(this.players.map((p) => p.seat))];
    log.info(`tournament ${this.id}: ${entrants.length} human entrants, pot ${this.prize}`);
  }

  _pairUp(seatIds) {
    const ties = [];
    for (let i = 0; i < seatIds.length; i += 2) {
      ties.push({ a: seatIds[i], b: seatIds[i + 1], winner: null });
    }
    return ties;
  }

  get roundName() {
    return ROUND_NAMES[this.roundIndex] ?? `Round ${this.roundIndex + 1}`;
  }

  get currentTies() {
    return this.rounds[this.roundIndex] ?? [];
  }

  player(seat) {
    return this.players[seat];
  }

  /** The tie this player is in for the current round, or null if they are out. */
  tieFor(guestId) {
    const me = this.players.find((p) => p.guestId === guestId);
    if (!me || me.out) return null;
    return this.currentTies.find((t) => t.a === me.seat || t.b === me.seat) ?? null;
  }

  /** Record who won a tie. Returns true if that completed the round. */
  reportWinner(tie, winnerSeat) {
    if (tie.winner !== null) return false;
    tie.winner = winnerSeat;
    const loser = winnerSeat === tie.a ? tie.b : tie.a;
    this.players[loser].out = true;
    return this.currentTies.every((t) => t.winner !== null);
  }

  /** A tie with no human in it is decided here rather than played out. */
  decideBotTie(tie) {
    const a = this.players[tie.a];
    const b = this.players[tie.b];
    if (!a.isBot || !b.isBot) return false;
    return this.reportWinner(tie, Math.random() < 0.5 ? tie.a : tie.b);
  }

  /** Move to the next round. Returns false once the final has been played. */
  advance() {
    if (!this.currentTies.every((t) => t.winner !== null)) return true;
    if (this.roundIndex >= ROUNDS - 1) return false;
    const winners = this.currentTies.map((t) => t.winner);
    this.roundIndex += 1;
    this.rounds[this.roundIndex] = this._pairUp(winners);
    return true;
  }

  get isComplete() {
    return this.roundIndex >= ROUNDS - 1 && this.currentTies.every((t) => t.winner !== null);
  }

  get champion() {
    if (!this.isComplete) return null;
    return this.players[this.currentTies[0].winner];
  }

  /** Every human still standing. */
  get liveHumans() {
    return this.players.filter((p) => p.guestId && !p.out);
  }

  /** Knock a player out — they disconnected, or walked away. */
  eliminate(guestId) {
    const me = this.players.find((p) => p.guestId === guestId);
    if (!me || me.out) return null;
    const tie = this.tieFor(guestId);
    me.out = true;
    if (tie && tie.winner === null) {
      // Their opponent goes through.
      const other = tie.a === me.seat ? tie.b : tie.a;
      tie.winner = other;
    }
    return tie;
  }

  /** Client-facing bracket. Safe to send to anyone: it is only names and results. */
  publicState(viewerId = null) {
    const seatView = (seat) => {
      const p = this.players[seat];
      return {
        seat,
        nickname: p.identity?.nickname ?? 'Trader',
        avatar: p.identity?.avatar ?? null,
        isBot: p.isBot,
        you: !!viewerId && p.guestId === viewerId,
        out: p.out,
      };
    };

    return {
      id: this.id,
      size: SIZE,
      prize: this.prize,
      roundIndex: this.roundIndex,
      roundName: this.roundName,
      totalRounds: ROUNDS,
      complete: this.isComplete,
      champion: this.isComplete ? seatView(this.currentTies[0].winner) : null,
      rounds: this.rounds.map((ties) =>
        ties.map((t) => ({
          a: seatView(t.a),
          b: seatView(t.b),
          winner: t.winner === null ? null : t.winner,
        })),
      ),
    };
  }
}
