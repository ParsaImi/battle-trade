import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

import { Match } from './match.js';
import { getMode, publicModeList } from './gameModes.js';
import { makeBotOpponent, opponentFromProfile } from './opponents.js';
import * as matchmaking from './matchmaking.js';
import { log } from './logger.js';
import * as store from './store.js';

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

store.load();

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
function beginMatch(entries) {
  const mode = getMode(entries[0].mode);
  const pvp = entries.length === 2;
  const startsAt = Date.now() + PREMATCH_MS;

  const profiles = entries.map((e) => opponentFromProfile(store.getGuestPublic(e.guestId)));
  const botIdentity = !pvp && !mode.solo ? makeBotOpponent() : null;

  entries.forEach((entry, i) => {
    send(entry.ws, {
      type: 'matchmaking',
      status: 'found',
      pvp,
      opponent: pvp ? profiles[1 - i] : botIdentity,
      startsAt,
    });
  });

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
    createMatch(entries, pvp ? profiles[1] : botIdentity);
  }, PREMATCH_MS);

  for (const e of entries) {
    const m = sockets.get(e.ws);
    if (m) m.pendingStart = timer;
  }
}

function createMatch(entries, opponentIdentity) {
  const [creator] = entries;
  const mode = getMode(creator.mode);

  let match;
  try {
    // `match` is deliberately read inside the callback rather than captured:
    // the constructor runs its first phase silently, so onChange cannot fire
    // before this assignment completes (HANDOFF section 10).
    match = new Match(creator.guestId, () => broadcastMatch(match), {
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

function handleMessage(ws, meta, msg) {
  if (msg.type === 'register') {
    const guestId =
      typeof msg.guestId === 'string' && msg.guestId.length >= 8 && msg.guestId.length <= 64
        ? msg.guestId
        : nanoid();
    const nickname = typeof msg.nickname === 'string' ? msg.nickname.slice(0, 20) : undefined;
    store.getOrCreateGuest(guestId, nickname);
    const bonus = store.applyDailyBonusIfNeeded(guestId);
    meta.guestId = guestId;
    // A reconnect (or a second tab) takes over the mapping so match frames
    // follow the live socket.
    socketByGuest.set(guestId, ws);
    send(ws, { type: 'registered', guestId, dailyBonus: bonus });
    sendLobby(ws, guestId);
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

      // A PvP mode looks for a real opponent first, and only falls back to
      // the AI once the full wait has elapsed with nobody found.
      if (mode.pvp) {
        const state = matchmaking.join(entry, {
          onPair: (a, b) => beginMatch([a, b]),
          onTimeout: (alone) => beginMatch([alone]),
        });
        if (state === 'waiting') {
          send(ws, {
            type: 'matchmaking',
            status: 'searching',
            waitMs: matchmaking.WAIT_MS,
            startedAt: Date.now(),
          });
        }
        return;
      }

      // Solo and scripted-AI modes start straight away.
      beginMatch([entry]);
      return;
    }

    case 'cancel_match':
      abandonSearch(meta, ws);
      send(ws, { type: 'matchmaking', status: 'cancelled', reason: 'you_cancelled' });
      sendLobby(ws, meta.guestId);
      return;

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
