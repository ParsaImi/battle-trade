import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

import { Match } from './match.js';
import { getMode, publicModeList } from './gameModes.js';
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

store.load();

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS === '*' ? true : ALLOWED_ORIGINS.split(',') }));
app.use(express.json({ limit: '32kb' }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

const sockets = new Map(); // ws -> { guestId, match, tokens, lastRefill, lastStart, alive }
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

function sendMatch(ws, match) {
  send(ws, { type: 'match', match: match.publicState() });
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

    case 'start_match': {
      // Cheap guard against a client hammering match creation.
      const now = Date.now();
      if (now - meta.lastStart < START_MATCH_COOLDOWN_MS) return;
      meta.lastStart = now;

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

      meta.match?.destroy();
      meta.match = null;
      try {
        meta.match = new Match(
          meta.guestId,
          () => {
            sendMatch(ws, meta.match);
            if (meta.match.phase === 'complete') sendLobby(ws, meta.guestId);
          },
          { mode: mode.id, wager },
        );
      } catch (err) {
        // Never swallow a player's wager because the match failed to build.
        if (wager > 0) store.refundWager(meta.guestId, wager);
        log.error('failed to start match', err);
        send(ws, { type: 'match_error', reason: 'start_failed' });
        sendLobby(ws, meta.guestId);
        return;
      }
      sendMatch(ws, meta.match);
      return;
    }

    case 'match_guess':
      meta.match?.submitGuess(msg.direction);
      return;

    case 'leave_match':
      meta.match?.destroy();
      meta.match = null;
      sendLobby(ws, meta.guestId);
      return;

    default:
      return;
  }
}

wss.on('connection', (ws) => {
  const meta = {
    guestId: null,
    match: null,
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

  ws.on('close', () => {
    meta.match?.destroy();
    sockets.delete(ws);
  });
});

// Drops connections that stopped answering, which also clears their match
// timers instead of leaving them running forever.
const heartbeat = setInterval(() => {
  for (const [ws, meta] of sockets) {
    if (!meta.alive) {
      meta.match?.destroy();
      sockets.delete(ws);
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
