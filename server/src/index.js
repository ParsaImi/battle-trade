import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

import { Match } from './match.js';
import { TeamMatch } from './teamMatch.js';
import { getMode, publicModeList } from './gameModes.js';
import { makeBotOpponent, opponentFromProfile } from './opponents.js';
import * as matchmaking from './matchmaking.js';
import * as rooms from './rooms.js';
import { Tournament, entryFeeFor, SIZE as TOURNAMENT_SIZE } from './tournament.js';
import * as marketData from './marketData.js';
import { log } from './logger.js';
import * as store from './store.js';
import * as accounts from './accounts.js';

const PORT = Number(process.env.PORT) || 8787;
// Comma-separated list, or "*" (the default) to allow any origin.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
// A game frame is tiny; anything larger is either a bug or an attack.
const MAX_PAYLOAD_BYTES = 16 * 1024;
const HEARTBEAT_MS = 30_000;
// Token bucket per connection: a burst allowance that refills steadily.
const RATE_BURST = 30;
const RATE_REFILL_PER_SEC = 12;
const START_MATCH_COOLDOWN_MS = 750;
// The VS card and 3/2/1 countdown between "opponent found" and round one.
// The server owns this so both sides of a PvP match start the same instant.
const PREMATCH_MS = Number(process.env.PREMATCH_MS) || 3_600;
// Auth attempts allowed on one connection per minute. The accounts module
// also locks out a username after repeated failures; this is the other half,
// stopping one socket from sweeping many usernames.
const AUTH_ATTEMPTS_PER_MIN = 10;
// Emotes are the one thing a player can push onto someone else's screen, so
// they are allowlisted and rate limited. Mirror of QUICK_EMOTES in the client.
const EMOTES = ['🐂', '🐻', '🎯', '💀', '🔥', '😭', '😂'];
const EMOTE_COOLDOWN_MS = 600;

store.load();
accounts.load();

// Start pulling real market history in the background. Matches fall back to
// the synthetic generator until the first batch lands, and whenever the feed
// is unreachable, so this never blocks startup.
marketData.start();

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS === '*' ? true : ALLOWED_ORIGINS.split(',') }));
app.use(express.json({ limit: '32kb' }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

const sockets = new Map(); // ws -> { guestId, match, tokens, lastRefill, lastStart, alive }
// guestId -> ws, so a PvP match can reach both of its players. A second
// connection for the same guest (another tab) replaces the first here.
const socketByGuest = new Map();
const startedAt = Date.now();

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    log.error('failed to send frame', err);
  }
}

function sendLobby(ws, guestId) {
  send(ws, {
    type: 'lobby',
    you: store.getGuestPublic(guestId),
    leaderboard: store.getWeeklyLeaderboard(),
    quests: store.getQuests(guestId),
    modes: publicModeList(),
  });
}


// Refills the bucket based on elapsed time and spends one token.
// Returns false when the connection is over its budget.
function allowMessage(meta) {
  const now = Date.now();
  const elapsedSec = (now - meta.lastRefill) / 1000;
  meta.lastRefill = now;
  meta.tokens = Math.min(RATE_BURST, meta.tokens + elapsedSec * RATE_REFILL_PER_SEC);
  if (meta.tokens < 1) return false;
  meta.tokens -= 1;
  return true;
}

// Sends every seated player their own view of the match. A PvP pair get
// different frames from the same object: publicState() flips the scoreline so
// each reads their own score as "yours".
function broadcastMatch(match) {
  for (const guestId of match.participants) {
    if (match.mutedViewers.has(guestId)) continue;
    const target = socketByGuest.get(guestId);
    if (!target) continue;
    send(target, { type: 'match', match: match.publicState(guestId) });
    if (match.phase === 'complete') sendLobby(target, guestId);
  }
}

// Announce the opponent, then start the match once both clients have had the
// countdown. The opponent identity is decided HERE — including the AI's — so
// the face on the "found" card is the one actually played against.
function beginMatch(entries, opts = {}) {
  const mode = getMode(entries[0].mode);
  const teamSize = mode.teamSize ?? 1;
  const pvp = entries.length > 1;
  const startsAt = Date.now() + PREMATCH_MS;

  const profiles = entries.map((e) => opponentFromProfile(store.getGuestPublic(e.guestId)));
  const botIdentity = !pvp && !mode.solo ? makeBotOpponent() : null;

  if (teamSize > 1) {
    // Duos: whoever turned up fills seats in order, and any seat still empty
    // is an AI. Seats 0,1 are one team and 2,3 the other, so a pair that
    // queued together does NOT end up on the same side by accident — they are
    // spread by arrival order, same as everyone else.
    const needed = teamSize * 2;
    const seats = Array.from({ length: needed }, (_, i) => ({ guestId: entries[i]?.guestId ?? null }));
    const identities = seats.map((seat, i) =>
      seat.guestId ? profiles[i] : makeBotOpponent(),
    );
    entries.forEach((entry, i) => {
      const myTeam = i < teamSize ? 0 : 1;
      send(entry.ws, {
        type: 'matchmaking',
        status: 'found',
        pvp,
        team: true,
        // The face on the card is someone from the other side.
        opponent: identities[myTeam === 0 ? teamSize : 0],
        teammate: identities.find((_, k) => k !== i && (k < teamSize) === (myTeam === 0)) ?? null,
        startsAt,
      });
    });
  } else {
    entries.forEach((entry, i) => {
      send(entry.ws, {
        type: 'matchmaking',
        status: 'found',
        pvp,
        opponent: pvp ? profiles[1 - i] : botIdentity,
        startsAt,
      });
    });
  }

  const timer = setTimeout(() => {
    // If anyone dropped during the countdown, cancel for everyone left and
    // give back any wager they had already staked.
    const alive = entries.filter((e) => e.ws.readyState === e.ws.OPEN);
    if (alive.length !== entries.length) {
      for (const e of alive) {
        const m = sockets.get(e.ws);
        if (m) m.pendingStart = null;
        if (e.wager > 0) store.refundWager(e.guestId, e.wager);
        send(e.ws, { type: 'matchmaking', status: 'cancelled', reason: 'opponent_left' });
        sendLobby(e.ws, e.guestId);
      }
      return;
    }
    createMatch(entries, pvp ? profiles[1] : botIdentity, opts);
  }, PREMATCH_MS);

  for (const e of entries) {
    const m = sockets.get(e.ws);
    if (m) m.pendingStart = timer;
  }
}

// Calls opts.onComplete exactly once, with every seat's result, the first time
// a match reports itself complete. Tournaments use this to advance a bracket.
function notifyComplete(match, opts) {
  if (!opts.onComplete || match.phase !== 'complete' || match._completeNotified) return;
  match._completeNotified = true;
  opts.onComplete(match.results ?? {});
}

function createMatch(entries, opponentIdentity, opts = {}) {
  const [creator] = entries;
  const mode = getMode(creator.mode);
  const teamSize = mode.teamSize ?? 1;

  let match;
  if (teamSize > 1) {
    const needed = teamSize * 2;
    const seats = Array.from({ length: needed }, (_, i) => ({ guestId: entries[i]?.guestId ?? null }));
    try {
      match = new TeamMatch(seats, () => {
        broadcastMatch(match);
        notifyComplete(match, opts);
      }, {
        mode: mode.id,
        wager: creator.wager,
      });
    } catch (err) {
      log.error('failed to start team match', err);
      for (const e of entries) {
        const m = sockets.get(e.ws);
        if (m) m.pendingStart = null;
        if (e.wager > 0) store.refundWager(e.guestId, e.wager);
        send(e.ws, { type: 'match_error', reason: 'start_failed' });
        sendLobby(e.ws, e.guestId);
      }
      return;
    }
    for (const e of entries) {
      const m = sockets.get(e.ws);
      if (!m) continue;
      m.pendingStart = null;
      m.match = match;
    }
    broadcastMatch(match);
    return;
  }

  try {
    // `match` is deliberately read inside the callback rather than captured:
    // the constructor runs its first phase silently, so onChange cannot fire
    // before this assignment completes (HANDOFF section 10).
    match = new Match(creator.guestId, () => {
      broadcastMatch(match);
      notifyComplete(match, opts);
    }, {
      mode: mode.id,
      wager: creator.wager,
      opponent: opponentIdentity,
    });
  } catch (err) {
    log.error('failed to start match', err);
    for (const e of entries) {
      const m = sockets.get(e.ws);
      if (m) m.pendingStart = null;
      // Never swallow a player's wager because the match failed to build.
      if (e.wager > 0) store.refundWager(e.guestId, e.wager);
      send(e.ws, { type: 'match_error', reason: 'start_failed' });
      sendLobby(e.ws, e.guestId);
    }
    return;
  }

  for (const e of entries) {
    const m = sockets.get(e.ws);
    if (!m) continue;
    m.pendingStart = null;
    m.match = match;
  }
  broadcastMatch(match);
}

// --- tournaments ----------------------------------------------------------
// The bracket itself is pure state in tournament.js. This is the part that
// turns a round of pairings into real matches, waits for them, and pays out.

// guestId -> Tournament, so a disconnect can find the bracket a player is in.
const tournamentOf = new Map();

function sendTournament(t, extra = {}) {
  for (const p of t.players) {
    if (!p.guestId) continue;
    const target = socketByGuest.get(p.guestId);
    if (!target) continue;
    send(target, { type: 'tournament', bracket: t.publicState(p.guestId), ...extra });
  }
}

// Play out (or decide) every tie in the current round.
function runTournamentRound(t) {
  // A tie with nobody human in it is decided rather than simulated: there is
  // no one to watch it, and it would only hold the bracket up.
  for (const tie of t.currentTies) {
    if (tie.winner === null) t.decideBotTie(tie);
  }
  sendTournament(t);

  for (const tie of t.currentTies) {
    if (tie.winner !== null) continue;
    const a = t.player(tie.a);
    const b = t.player(tie.b);
    const humans = [a, b].filter((p) => p.guestId && socketByGuest.get(p.guestId));

    // Everyone in this tie has gone offline — settle it and move on.
    if (humans.length === 0) {
      t.reportWinner(tie, Math.random() < 0.5 ? tie.a : tie.b);
      continue;
    }

    const entries = humans.map((p) => ({
      guestId: p.guestId,
      ws: socketByGuest.get(p.guestId),
      mode: 'classic',
      wager: 0,
    }));

    beginMatch(entries, {
      onComplete: (results) => {
        if (tie.winner !== null) return;
        let winnerSeat;
        if (humans.length === 2) {
          const aWon = results[a.guestId] && results[a.guestId].outcome === 'win';
          const bWon = results[b.guestId] && results[b.guestId].outcome === 'win';
          // A draw is settled on a coin flip rather than replayed.
          winnerSeat = aWon ? tie.a : bWon ? tie.b : Math.random() < 0.5 ? tie.a : tie.b;
        } else {
          const human = humans[0];
          const humanSeat = human.seat;
          const otherSeat = humanSeat === tie.a ? tie.b : tie.a;
          const res = results[human.guestId];
          winnerSeat = res && res.outcome === 'win' ? humanSeat : otherSeat;
        }
        finishTie(t, tie, winnerSeat);
      },
    });
  }

  maybeFinishRound(t);
}

// Opens a bracket for whoever is in the group and fills the rest with AI.
function startBracket(group) {
  const t = new Tournament(group.map((g) => ({ guestId: g.guestId, fee: g.fee ?? 0 })));
  for (const p of t.players) {
    if (p.guestId) tournamentOf.set(p.guestId, t);
  }
  sendTournament(t, { started: true });
  // A beat before the first round, so the bracket can be read.
  setTimeout(() => runTournamentRound(t), 3000);
  return t;
}

function finishTie(t, tie, winnerSeat) {
  t.reportWinner(tie, winnerSeat);
  sendTournament(t);
  maybeFinishRound(t);
}

function maybeFinishRound(t) {
  if (!t.currentTies.every((x) => x.winner !== null)) return;

  if (t.isComplete) {
    const champ = t.champion;
    if (champ && champ.guestId) {
      const paid = store.awardTournament(champ.guestId, t.prize);
      log.info('tournament ' + t.id + ': ' + champ.guestId + ' took ' + paid + ' coins');
    }
    sendTournament(t, { finished: true, prize: t.prize });
    for (const p of t.players) {
      if (!p.guestId) continue;
      tournamentOf.delete(p.guestId);
      const target = socketByGuest.get(p.guestId);
      if (target) sendLobby(target, p.guestId);
    }
    return;
  }

  t.advance();
  sendTournament(t);
  // A short breath between rounds, so the bracket update is legible.
  setTimeout(() => runTournamentRound(t), 2500);
}

// Leave the queue and abandon any match still counting down. Used by an
// explicit cancel, by leave_match, and by a dropped socket.
//
// Scoped to THIS socket, not to the guest. A player often has more than one
// socket for the same guestId — a reconnect the server has not reaped yet, or
// a second tab — and removing the queue entry by guestId meant a stale socket
// closing silently cancelled the live socket's search. The player then sat on
// the search screen forever: never paired, and never given the AI fallback,
// because the timer went with the entry.
function abandonSearch(meta, ws) {
  // A room the player was hosting counts as a search too.
  const hosted = rooms.closeBySocket(ws);
  if (hosted && hosted.wager > 0) store.refundWager(hosted.guestId, hosted.wager);

  const queued = matchmaking.leaveBySocket(ws);
  if (queued && queued.wager > 0 && queued.guestId) {
    store.refundWager(queued.guestId, queued.wager);
  }
  if (meta.pendingStart) {
    clearTimeout(meta.pendingStart);
    meta.pendingStart = null;
  }
}

// Detach a player from their match. A PvP match still in progress is
// forfeited so the other player gets a result instead of hanging on a match
// that will never advance.
function releaseMatch(meta) {
  const match = meta.match;
  meta.match = null;
  if (!match) return;
  if (match.isPvp && match.phase !== 'complete') {
    // Mute the leaver: they chose to walk out, so they belong in the lobby,
    // not on the completion screen.
    match.mutedViewers.add(meta.guestId);
    match.forfeit(meta.guestId);
    return;
  }
  match.destroy();
}

// Caps how fast one connection may try to authenticate.
function authAllowed(meta) {
  const now = Date.now();
  if (!meta.authWindowStart || now - meta.authWindowStart > 60_000) {
    meta.authWindowStart = now;
    meta.authAttempts = 0;
  }
  meta.authAttempts += 1;
  return meta.authAttempts <= AUTH_ATTEMPTS_PER_MIN;
}

// Seats a connection on a guest id — the one thing every entry path ends in,
// whether the player arrived as a guest, signed up, logged in, or resumed a
// saved session. Everything downstream is keyed by guestId and neither knows
// nor cares whether an account is behind it.
function attachGuest(ws, meta, guestId, nickname, extra = {}) {
  store.getOrCreateGuest(guestId, nickname);
  const bonus = store.applyDailyBonusIfNeeded(guestId);
  meta.guestId = guestId;
  socketByGuest.set(guestId, ws);
  send(ws, {
    type: 'registered',
    guestId,
    dailyBonus: bonus,
    account: accounts.accountForGuest(guestId),
    ...extra,
  });
  sendLobby(ws, guestId);
}

function handleMessage(ws, meta, msg) {
  if (msg.type === 'register') {
    const guestId =
      typeof msg.guestId === 'string' && msg.guestId.length >= 8 && msg.guestId.length <= 64
        ? msg.guestId
        : nanoid();
    const nickname = typeof msg.nickname === 'string' ? msg.nickname.slice(0, 20) : undefined;
    // A reconnect (or a second tab) takes over the guest -> socket mapping
    // so match frames follow the live socket; attachGuest does that.
    attachGuest(ws, meta, guestId, nickname);
    return;
  }

  // --- accounts ---------------------------------------------------------
  // These are the only other messages allowed before the connection has a
  // guest id, because they are how a player gets one.

  if (msg.type === 'login') {
    if (!authAllowed(meta)) return;
    const result = accounts.login(msg.username, msg.password);
    if (!result.ok) {
      send(ws, { type: 'auth', ok: false, action: 'login', ...result });
      return;
    }
    // Logging in moves this connection onto the account's guest id, so the
    // player picks up the coins and stats they left on another device.
    attachGuest(ws, meta, result.guestId, undefined, {
      token: result.token,
      account: result.username,
    });
    send(ws, { type: 'auth', ok: true, action: 'login', username: result.username, token: result.token });
    return;
  }

  if (msg.type === 'resume') {
    const session = accounts.resumeSession(msg.token);
    if (!session) {
      // Expired or unknown: tell the client so it can fall back to guest.
      send(ws, { type: 'auth', ok: false, action: 'resume', reason: 'session_expired' });
      return;
    }
    attachGuest(ws, meta, session.guestId, undefined, { account: session.username });
    send(ws, { type: 'auth', ok: true, action: 'resume', username: session.username });
    return;
  }

  if (msg.type === 'signup') {
    if (!authAllowed(meta)) return;
    // Bind whatever guest this connection is already playing as, so the
    // account inherits their progress instead of starting from zero. A
    // brand-new visitor gets a fresh id.
    const guestId =
      meta.guestId ??
      (typeof msg.guestId === 'string' && msg.guestId.length >= 8 && msg.guestId.length <= 64
        ? msg.guestId
        : nanoid());
    const result = accounts.signup(msg.username, msg.password, guestId);
    if (!result.ok) {
      send(ws, { type: 'auth', ok: false, action: 'signup', ...result });
      return;
    }
    attachGuest(ws, meta, result.guestId, undefined, {
      token: result.token,
      account: result.username,
    });
    send(ws, { type: 'auth', ok: true, action: 'signup', username: result.username, token: result.token });
    return;
  }

  // Everything below requires a registered player.
  if (!meta.guestId) return;

  switch (msg.type) {
    case 'set_avatar':
      store.setAvatar(meta.guestId, msg.avatar);
      sendLobby(ws, meta.guestId);
      return;

    case 'set_title':
      store.setTitle(meta.guestId, msg.title);
      sendLobby(ws, meta.guestId);
      return;

    case 'set_nickname':
      store.setNickname(meta.guestId, msg.nickname);
      sendLobby(ws, meta.guestId);
      return;

    case 'buy_avatar': {
      const result = store.buyAvatar(meta.guestId, msg.avatar);
      send(ws, { type: 'purchase', avatar: msg.avatar, ...result });
      sendLobby(ws, meta.guestId);
      return;
    }

    case 'buy_title': {
      const result = store.buyTitle(meta.guestId, msg.title);
      send(ws, { type: 'purchase', kind: 'title', title: msg.title, ...result });
      sendLobby(ws, meta.guestId);
      return;
    }

    case 'claim_quest': {
      const result = store.claimQuest(meta.guestId, msg.questId);
      send(ws, { type: 'quest_claimed', questId: msg.questId, ...result });
      sendLobby(ws, meta.guestId);
      return;
    }

    // 'start_match' is the old name for this. A client loaded before the PvP
    // update still sends it, and gets the same behaviour.
    case 'find_match':
    case 'start_match': {
      // Cheap guard against a client hammering match creation.
      const now = Date.now();
      if (now - meta.lastStart < START_MATCH_COOLDOWN_MS) return;
      meta.lastStart = now;

      // Clear out anything already running before starting something new.
      abandonSearch(meta, ws);
      releaseMatch(meta);

      const mode = getMode(msg.mode);
      // Custom is a room, not something you can queue for.
      if (mode.room) return;

      // High Stakes takes the wager up front; refuse the match if the
      // player can't cover it or picked an amount that isn't on offer.
      let wager = 0;
      if (mode.wager) {
        wager = Number(msg.wager) || 0;
        if (!mode.wagerOptions.includes(wager)) {
          send(ws, { type: 'match_error', reason: 'bad_wager' });
          return;
        }
        if (!store.takeWager(meta.guestId, wager)) {
          send(ws, { type: 'match_error', reason: 'not_enough_coins' });
          sendLobby(ws, meta.guestId);
          return;
        }
        sendLobby(ws, meta.guestId);
      }

      const entry = { guestId: meta.guestId, ws, mode: mode.id, wager };

      // Tournaments gather eight, charge a tenth of what each player holds,
      // and pool it. tournament.js owns the bracket from there.
      if (mode.bracket) {
        const me = store.getGuestPublic(meta.guestId);
        const fee = entryFeeFor(me?.coins ?? 0);
        if (!store.takeTournamentEntry(meta.guestId, fee)) {
          send(ws, { type: 'match_error', reason: 'not_enough_coins' });
          sendLobby(ws, meta.guestId);
          return;
        }
        sendLobby(ws, meta.guestId);

        const state = matchmaking.join(
          { guestId: meta.guestId, ws, mode: mode.id, wager: 0, fee },
          {
            groupSize: TOURNAMENT_SIZE,
            onPair: (...group) => startBracket(group),
            // Nobody else turned up: run the bracket with an AI field. The
            // entry fee stands, and so does the pot it went into.
            onTimeout: (alone) => startBracket([alone]),
          },
        );
        if (state === 'waiting') {
          send(ws, {
            type: 'matchmaking',
            status: 'searching',
            waitMs: matchmaking.WAIT_MS,
            startedAt: Date.now(),
            tournament: true,
            entryFee: fee,
          });
        }
        return;
      }

      // A PvP mode looks for a real opponent first, and only falls back to
      // the AI once the full wait has elapsed with nobody found.
      if (mode.pvp) {
        const state = matchmaking.join(entry, {
          groupSize: (mode.teamSize ?? 1) * 2,
          onPair: (...group) => beginMatch(group),
          onTimeout: (alone) => beginMatch([alone]),
        });
        if (state === 'waiting') {
          send(ws, {
            type: 'matchmaking',
            status: 'searching',
            waitMs: matchmaking.WAIT_MS,
            startedAt: Date.now(),
            // Survival and Blitz have no AI rival to fall back to — alone,
            // they are simply a solo run. The client says so rather than
            // promising an opponent that does not exist.
            soloFallback: !!mode.solo,
          });
        }
        return;
      }

      // Solo and scripted-AI modes start straight away.
      beginMatch([entry]);
      return;
    }

    case 'logout':
      // Kills the saved session so the token cannot be reused. The client
      // then re-registers under its own device guest id.
      accounts.endSession(msg.token);
      send(ws, { type: 'auth', ok: true, action: 'logout' });
      return;

    // "Play with AI" — stop waiting and start right now. Takes the player
    // out of the queue and begins the match they would have got anyway once
    // the wait ran out: an AI rival, or a solo run in Survival and Blitz.
    // The wager is NOT refunded here, because the match is going ahead.
    // --- private rooms ----------------------------------------------------
    // A player opens a room, gets a short code, and whoever they send it to
    // joins that exact match rather than the open queue.
    case 'create_room': {
      const now = Date.now();
      if (now - meta.lastStart < START_MATCH_COOLDOWN_MS) return;
      meta.lastStart = now;

      abandonSearch(meta, ws);
      releaseMatch(meta);

      const mode = getMode(msg.mode);
      // 'custom' is a lobby concept, not something Match can play.
      if (mode.room) {
        send(ws, { type: 'room', ok: false, reason: 'bad_mode' });
        return;
      }

      let wager = 0;
      if (mode.wager) {
        wager = Number(msg.wager) || 0;
        if (!mode.wagerOptions.includes(wager)) {
          send(ws, { type: 'room', ok: false, reason: 'bad_wager' });
          return;
        }
        if (!store.takeWager(meta.guestId, wager)) {
          send(ws, { type: 'room', ok: false, reason: 'not_enough_coins' });
          sendLobby(ws, meta.guestId);
          return;
        }
        sendLobby(ws, meta.guestId);
      }

      const room = rooms.create({ guestId: meta.guestId, ws, mode: mode.id, wager }, (expired) => {
        if (expired.wager > 0) store.refundWager(expired.guestId, expired.wager);
        send(expired.ws, { type: 'room', ok: false, reason: 'expired' });
        sendLobby(expired.ws, expired.guestId);
      });

      send(ws, {
        type: 'room',
        ok: true,
        status: 'waiting',
        code: room.code,
        mode: mode.id,
        modeName: mode.name,
        wager,
        expiresInSec: Math.round(rooms.ROOM_TTL_MS / 1000),
      });
      return;
    }

    case 'join_room': {
      const now = Date.now();
      if (now - meta.lastStart < START_MATCH_COOLDOWN_MS) return;
      meta.lastStart = now;

      const result = rooms.claim(msg.code, meta.guestId);
      if (!result.ok) {
        send(ws, { type: 'room', ok: false, reason: result.reason });
        return;
      }

      const host = result.room;
      const mode = getMode(host.mode);

      // The joiner has to cover the same stake the host already put up.
      let wager = 0;
      if (mode.wager) {
        wager = host.wager;
        if (!store.takeWager(meta.guestId, wager)) {
          // Hand the room back rather than eating the host's wager.
          rooms.create({ guestId: host.guestId, ws: host.ws, mode: host.mode, wager: host.wager }, () => {});
          send(ws, { type: 'room', ok: false, reason: 'not_enough_coins' });
          sendLobby(ws, meta.guestId);
          return;
        }
        sendLobby(ws, meta.guestId);
      }

      abandonSearch(meta, ws);
      releaseMatch(meta);

      beginMatch([
        { guestId: host.guestId, ws: host.ws, mode: host.mode, wager: host.wager },
        { guestId: meta.guestId, ws, mode: host.mode, wager },
      ]);
      return;
    }

    case 'leave_room': {
      const closed = rooms.closeFor(meta.guestId);
      if (closed && closed.wager > 0) store.refundWager(meta.guestId, closed.wager);
      send(ws, { type: 'room', ok: true, status: 'closed' });
      sendLobby(ws, meta.guestId);
      return;
    }

    case 'play_ai': {
      const entry = matchmaking.leaveBySocket(ws);
      // Not searching — nothing to skip. Ignore rather than starting a second
      // match on top of whatever they are already doing.
      if (!entry) return;
      // A tournament entry is not a match: skipping the wait has to open the
      // bracket with an AI field, or the entry fee would vanish into an
      // ordinary 1v1 with no bracket behind it.
      if (getMode(entry.mode).bracket) {
        startBracket([entry]);
        return;
      }
      beginMatch([entry]);
      return;
    }

    case 'cancel_match':
      abandonSearch(meta, ws);
      send(ws, { type: 'matchmaking', status: 'cancelled', reason: 'you_cancelled' });
      sendLobby(ws, meta.guestId);
      return;

    // Relay a reaction to the other player. Emotes used to be a purely local
    // flourish — they never left the browser, so in a real PvP match the
    // opponent never saw a thing.
    case 'emote': {
      const match = meta.match;
      if (!match || !match.isPvp || match.phase === 'complete') return;
      // Only the fixed set: this is the one channel a player can put content
      // on someone else's screen with, and it is not going to become one for
      // arbitrary text.
      if (!EMOTES.includes(msg.emoji)) return;

      const now = Date.now();
      if (now - (meta.lastEmote ?? 0) < EMOTE_COOLDOWN_MS) return;
      meta.lastEmote = now;

      const target = match.participants.find((id) => id !== meta.guestId);
      const targetWs = target && socketByGuest.get(target);
      if (targetWs) send(targetWs, { type: 'emote', emoji: msg.emoji });
      return;
    }

    case 'match_guess':
      meta.match?.submitGuess(msg.direction, meta.guestId);
      return;

    case 'leave_match':
      abandonSearch(meta, ws);
      releaseMatch(meta);
      sendLobby(ws, meta.guestId);
      return;

    default:
      return;
  }
}

// A socket is going away: take the player out of the queue, forfeit any PvP
// match so the opponent is not left waiting on a player who will never call,
// and release the guest -> socket mapping.
function dropSocket(ws, meta) {
  abandonSearch(meta, ws);
  releaseMatch(meta);
  if (meta.guestId && socketByGuest.get(meta.guestId) === ws) socketByGuest.delete(meta.guestId);
  sockets.delete(ws);
}

wss.on('connection', (ws) => {
  const meta = {
    guestId: null,
    match: null,
    // Timer for a match that has been announced but not started yet.
    pendingStart: null,
    authAttempts: 0,
    authWindowStart: 0,
    lastEmote: 0,
    tokens: RATE_BURST,
    lastRefill: Date.now(),
    lastStart: 0,
    alive: true,
  };
  sockets.set(ws, meta);

  ws.on('pong', () => {
    meta.alive = true;
  });

  ws.on('message', (raw) => {
    // One bad frame must never take down the process — every connected
    // player shares it.
    try {
      if (!allowMessage(meta)) return;

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      // JSON.parse happily returns null / numbers / arrays; only a plain
      // object with a string `type` is a real message.
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return;
      if (typeof msg.type !== 'string') return;

      handleMessage(ws, meta, msg);
    } catch (err) {
      log.error('error handling message', err);
    }
  });

  ws.on('error', (err) => log.warn('socket error', err.message));

  ws.on('close', () => dropSocket(ws, meta));
});

// Drops connections that stopped answering, which also clears their match
// timers instead of leaving them running forever.
const heartbeat = setInterval(() => {
  for (const [ws, meta] of sockets) {
    if (!meta.alive) {
      log.warn(`heartbeat: dropping unresponsive socket${meta.guestId ? ` for ${meta.guestId}` : ''}`);
      dropSocket(ws, meta);
      ws.terminate();
      continue;
    }
    meta.alive = false;
    try {
      ws.ping();
    } catch {
      // terminated between checks — the close handler cleans up
    }
  }
}, HEARTBEAT_MS);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    connections: sockets.size,
    marketBatches: marketData.poolSize(),
    rooms: rooms.openCount(),
    accounts: accounts.accountCount(),
    queued: matchmaking.queueSize(),
    players: store.playerCount(),
  });
});

// 0.0.0.0 so devices on the same network (phones, tablets) can connect,
// not just this machine. Override with HOST=127.0.0.1 to keep it local.
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  log.info(`Battle Trade server listening on ${HOST}:${PORT}`);
  for (const addr of lanAddresses()) {
    log.info(`  reachable at http://${addr}:${PORT}`);
  }
});

// Non-internal IPv4 addresses, so the startup log shows what to type on a phone.
function lanAddresses() {
  const out = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// A last-resort net: log and keep serving rather than dropping every
// player because of one unexpected throw.
process.on('uncaughtException', (err) => log.error('uncaught exception', err));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — flushing player data`);
  clearInterval(heartbeat);
  // Flush synchronously so an in-flight debounced save is never lost.
  store.saveNow();
  accounts.saveNow();
  for (const [ws, meta] of sockets) {
    meta.match?.destroy();
    try {
      ws.close(1001, 'server shutting down');
    } catch {
      // already gone
    }
  }
  httpServer.close(() => process.exit(0));
  // Don't hang forever on a stuck socket.
  setTimeout(() => process.exit(0), 3000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => shutdown(signal));
}
