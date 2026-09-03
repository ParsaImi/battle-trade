import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

import { Match } from './match.js';
import { getMode, publicModeList } from './gameModes.js';
import * as store from './store.js';

store.load();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const sockets = new Map(); // ws -> { guestId, match }

function sendLobby(ws, guestId) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(
    JSON.stringify({
      type: 'lobby',
      you: store.getGuestPublic(guestId),
      leaderboard: store.getWeeklyLeaderboard(),
      quests: store.getQuests(guestId),
      modes: publicModeList(),
    }),
  );
}

function sendMatch(ws, match) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: 'match', match: match.publicState() }));
}

wss.on('connection', (ws) => {
  sockets.set(ws, { guestId: null, match: null });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const meta = sockets.get(ws);

    if (msg.type === 'register') {
      const guestId = typeof msg.guestId === 'string' && msg.guestId.length >= 8 ? msg.guestId : nanoid();
      const nickname = typeof msg.nickname === 'string' ? msg.nickname.slice(0, 20) : undefined;
      store.getOrCreateGuest(guestId, nickname);
      const bonus = store.applyDailyBonusIfNeeded(guestId);
      meta.guestId = guestId;
      ws.send(JSON.stringify({ type: 'registered', guestId, dailyBonus: bonus }));
      sendLobby(ws, guestId);
      return;
    }

    if (!meta?.guestId) return;

    if (msg.type === 'set_avatar') {
      store.setAvatar(meta.guestId, msg.avatar);
      sendLobby(ws, meta.guestId);
      return;
    }

    if (msg.type === 'set_title') {
      store.setTitle(meta.guestId, msg.title);
      sendLobby(ws, meta.guestId);
      return;
    }

    if (msg.type === 'buy_avatar') {
      const result = store.buyAvatar(meta.guestId, msg.avatar);
      ws.send(JSON.stringify({ type: 'purchase', avatar: msg.avatar, ...result }));
      sendLobby(ws, meta.guestId);
      return;
    }

    if (msg.type === 'claim_quest') {
      const result = store.claimQuest(meta.guestId, msg.questId);
      ws.send(JSON.stringify({ type: 'quest_claimed', questId: msg.questId, ...result }));
      sendLobby(ws, meta.guestId);
      return;
    }

    if (msg.type === 'set_nickname') {
      store.setNickname(meta.guestId, msg.nickname);
      sendLobby(ws, meta.guestId);
      return;
    }

    if (msg.type === 'start_match') {
      const mode = getMode(msg.mode);

      // High Stakes takes the wager up front; refuse the match if the
      // player can't cover it or picked an amount that isn't on offer.
      let wager = 0;
      if (mode.wager) {
        wager = Number(msg.wager) || 0;
        if (!mode.wagerOptions.includes(wager)) {
          ws.send(JSON.stringify({ type: 'match_error', reason: 'bad_wager' }));
          return;
        }
        if (!store.takeWager(meta.guestId, wager)) {
          ws.send(JSON.stringify({ type: 'match_error', reason: 'not_enough_coins' }));
          sendLobby(ws, meta.guestId);
          return;
        }
        sendLobby(ws, meta.guestId);
      }

      meta.match?.destroy();
      meta.match = new Match(
        meta.guestId,
        () => {
          sendMatch(ws, meta.match);
          if (meta.match.phase === 'complete') sendLobby(ws, meta.guestId);
        },
        { mode: mode.id, wager },
      );
      sendMatch(ws, meta.match);
      return;
    }

    if (msg.type === 'match_guess') {
      meta.match?.submitGuess(msg.direction);
      return;
    }

    if (msg.type === 'leave_match') {
      meta.match?.destroy();
      meta.match = null;
      sendLobby(ws, meta.guestId);
      return;
    }
  });

  ws.on('close', () => {
    sockets.get(ws)?.match?.destroy();
    sockets.delete(ws);
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8787;
httpServer.listen(PORT, () => {
  console.log(`Battle Trade server listening on :${PORT}`);
});
