// Player-vs-player matchmaking and match behaviour.
//
// Runs a real server with a shortened queue wait (MATCH_WAIT_MS) and drives it
// with real WebSocket clients, because the things worth testing here are the
// things that only appear with two connections: perspective flipping, both
// seats scoring, not leaking the opponent's call, and forfeits.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const CWD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PROBE_PORT) || 8913;
const WAIT_MS = 1500;    // stand-in for the real 30s queue wait
const PREMATCH_MS = 300; // stand-in for the real VS countdown

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS  ${msg}`); }
  else { fail++; console.log(`FAIL  ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
async function startServer() {
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: CWD,
    env: {
      ...process.env,
      PORT: String(PORT),
      MATCH_WAIT_MS: String(WAIT_MS),
      PREMATCH_MS: String(PREMATCH_MS),
      DATA_DIR: path.join(CWD, 'test', '.tmp-pvp'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (process.env.VERBOSE) {
    server.stdout.on('data', (d) => process.stdout.write('  [srv] ' + d));
    server.stderr.on('data', (d) => process.stdout.write('  [srv!] ' + d));
  }
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
  }
  throw new Error('server did not start');
}

// A tiny client that records every frame, so assertions can look back at what
// each player was actually sent.
function connect(guestId, nickname) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const client = {
    ws,
    guestId,
    frames: [],
    matches: [],
    matchmaking: [],
    send: (o) => ws.send(JSON.stringify(o)),
    last: (type) => [...client.frames].reverse().find((f) => f.type === type) ?? null,
    close: () => ws.close(),
  };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    client.frames.push(msg);
    if (msg.type === 'match') client.matches.push(msg.match);
    if (msg.type === 'matchmaking') client.matchmaking.push(msg);
  });
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      client.send({ type: 'register', guestId, nickname });
      resolve(client);
    });
    ws.on('error', reject);
  });
}

// Waits for a frame satisfying `pred`, or gives up.
async function waitFor(client, pred, timeoutMs = 8000, label = 'frame') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = client.frames.find(pred);
    if (hit) return hit;
    await sleep(60);
  }
  throw new Error(`timed out waiting for ${label} (${client.guestId})`);
}

async function run() {
  await startServer();

  // --- two players in the queue are paired with each other -----------------
  const a = await connect('pvp-alpha-00000001', 'Alpha');
  const b = await connect('pvp-bravo-000000001', 'Bravo');
  await sleep(200);

  a.send({ type: 'find_match', mode: 'classic' });
  await sleep(150);
  // Alpha is alone at this point, so it should be told it is searching.
  const searching = a.matchmaking.find((m) => m.status === 'searching');
  ok(!!searching, `first player is told it is searching (waitMs=${searching?.waitMs})`);

  b.send({ type: 'find_match', mode: 'classic' });

  const aFound = await waitFor(a, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'found(a)');
  const bFound = await waitFor(b, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'found(b)');

  ok(aFound.pvp === true && bFound.pvp === true, 'both are told this is a PvP match');
  ok(aFound.opponent?.nickname === 'Bravo', `Alpha faces Bravo (got ${aFound.opponent?.nickname})`);
  ok(bFound.opponent?.nickname === 'Alpha', `Bravo faces Alpha (got ${bFound.opponent?.nickname})`);
  ok(aFound.opponent?.isBot === false, 'opponent is flagged as a real player, not a bot');
  ok(aFound.startsAt === bFound.startsAt, 'both get the same start time, so rounds stay in sync');

  // --- the match itself ----------------------------------------------------
  await waitFor(a, (f) => f.type === 'match', 8000, 'match(a)');
  await waitFor(b, (f) => f.type === 'match', 8000, 'match(b)');

  const a0 = a.matches[0];
  const b0 = b.matches[0];
  ok(a0.pvp === true, 'match state is marked pvp');
  ok(
    JSON.stringify(a0.candles) === JSON.stringify(b0.candles),
    'both players are shown exactly the same candles',
  );
  ok(a0.opponent?.nickname === 'Bravo' && b0.opponent?.nickname === 'Alpha',
     'each match frame carries the other player as the opponent');

  // --- locking in does not leak the call -----------------------------------
  a.send({ type: 'match_guess', direction: 'up' });
  await sleep(400);

  const bAfterALocked = b.matches[b.matches.length - 1];
  ok(bAfterALocked.opponentLockedIn === true, 'Bravo is told Alpha has locked in');
  ok(bAfterALocked.roundOutcome === null, 'no round outcome is revealed while Bravo is still deciding');
  const leaked = JSON.stringify(bAfterALocked).includes('"botGuess":"up"');
  ok(!leaked, "Alpha's actual call is NOT sent to Bravo during the guess phase");

  const aAfterALocked = a.matches[a.matches.length - 1];
  ok(aAfterALocked.yourGuess === 'up', 'Alpha sees its own call echoed back');
  ok(aAfterALocked.opponentLockedIn === false, 'Alpha is not told Bravo locked in yet');

  // --- both calls in: the round resolves for both ---------------------------
  b.send({ type: 'match_guess', direction: 'down' });
  const aReveal = await waitFor(
    a, (f) => f.type === 'match' && f.match.roundOutcome, 8000, 'reveal(a)');
  const bReveal = await waitFor(
    b, (f) => f.type === 'match' && f.match.roundOutcome, 8000, 'reveal(b)');

  const ao = aReveal.match.roundOutcome;
  const bo = bReveal.match.roundOutcome;
  ok(ao.direction === bo.direction, 'both see the same resolved direction');
  ok(ao.playerGuess === 'up' && ao.botGuess === 'down', 'Alpha sees its own call as playerGuess');
  ok(bo.playerGuess === 'down' && bo.botGuess === 'up', "Bravo's view is flipped: its call is playerGuess");
  ok(ao.playerDelta === bo.botDelta && ao.botDelta === bo.playerDelta,
     'the two perspectives are exact mirrors of each other');
  ok(ao.playerDelta + ao.botDelta === 0,
     `one player gains what the other loses (${ao.playerDelta} / ${ao.botDelta})`);

  // --- a forfeit gives the remaining player the win -------------------------
  a.close();
  const bComplete = await waitFor(
    b, (f) => f.type === 'match' && f.match.phase === 'complete', 10000, 'forfeit result(b)');
  ok(bComplete.match.matchResult?.outcome === 'win',
     `Bravo wins when Alpha disconnects (outcome=${bComplete.match.matchResult?.outcome})`);
  ok(bComplete.match.matchResult?.endReason === 'opponent_left',
     'the result says why: opponent_left');
  b.close();
  await sleep(300);

  // --- a lone player falls back to the AI after the wait --------------------
  const c = await connect('pvp-solo-0000000001', 'Solo');
  await sleep(200);
  const beforeQueue = Date.now();
  c.send({ type: 'find_match', mode: 'classic' });

  const cFound = await waitFor(
    c, (f) => f.type === 'matchmaking' && f.status === 'found', 12000, 'bot fallback');
  const waited = Date.now() - beforeQueue;

  ok(cFound.pvp === false, 'lone player is not told this is PvP');
  ok(cFound.opponent?.isBot === true, 'lone player falls back to an AI opponent');
  ok(!!cFound.opponent?.nickname, `the AI has a name (${cFound.opponent?.nickname})`);
  ok(waited >= WAIT_MS - 250, `fallback waited for the full queue time (${waited}ms >= ${WAIT_MS}ms)`);

  const cMatch = await waitFor(c, (f) => f.type === 'match', 8000, 'bot match');
  ok(cMatch.match.opponent?.nickname === cFound.opponent.nickname,
     'the opponent announced during matchmaking is the one actually played');
  ok(cMatch.match.pvp === false, 'a bot match is not flagged as pvp');
  c.close();
  await sleep(200);

  // --- cancelling leaves the queue ------------------------------------------
  const d = await connect('pvp-cancel-000000001', 'Canceller');
  await sleep(200);
  d.send({ type: 'find_match', mode: 'classic' });
  await waitFor(d, (f) => f.type === 'matchmaking' && f.status === 'searching', 4000, 'searching(d)');

  const queuedHealth = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok(queuedHealth.queued === 1, `health reports the queue depth (queued=${queuedHealth.queued})`);

  d.send({ type: 'cancel_match' });
  await waitFor(d, (f) => f.type === 'matchmaking' && f.status === 'cancelled', 4000, 'cancelled(d)');
  await sleep(200);
  const emptyHealth = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok(emptyHealth.queued === 0, 'cancelling removes the player from the queue');

  // Nothing should arrive after cancelling — in particular no AI fallback.
  const framesAfterCancel = d.frames.length;
  await sleep(WAIT_MS + 400);
  const newFrames = d.frames.slice(framesAfterCancel).filter((f) => f.type === 'matchmaking' || f.type === 'match');
  ok(newFrames.length === 0, 'a cancelled search does not still fall back to a bot later');
  d.close();

  // --- a stale socket must not cancel the live one's search -----------------
  // Regression: a player commonly has more than one socket for the same
  // guestId (a reconnect the server has not reaped yet, or a second tab).
  // Removing the queue entry by guestId meant any of them closing silently
  // cancelled the live search, and because the AI-fallback timer went with the
  // entry the player waited forever. This is what "I press Play and nothing
  // happens" looked like in production.
  const live = await connect('pvp-storm-000000001', 'StormVictim');
  await sleep(200);
  live.send({ type: 'find_match', mode: 'classic' });
  await waitFor(live, (f) => f.type === 'matchmaking' && f.status === 'searching', 4000, 'searching(live)');

  const stale = await connect('pvp-storm-000000001', 'StormVictim');
  await sleep(250);
  stale.close();
  await sleep(500);

  const stillQueued = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok(stillQueued.queued === 1,
     `a stale socket closing leaves the live search in the queue (queued=${stillQueued.queued})`);

  const stormFound = await waitFor(
    live, (f) => f.type === 'matchmaking' && f.status === 'found', WAIT_MS + 6000, 'fallback after stale close');
  ok(!!stormFound, 'the AI fallback still fires for the surviving socket');
  live.close();
  await sleep(200);

  // --- solo modes never queue -----------------------------------------------
  const e = await connect('pvp-blitz-0000000001', 'Blitzer');
  await sleep(200);
  const beforeBlitz = Date.now();
  e.send({ type: 'find_match', mode: 'blitz' });
  const eFound = await waitFor(
    e, (f) => f.type === 'matchmaking' && f.status === 'found', 4000, 'blitz found');
  ok(Date.now() - beforeBlitz < WAIT_MS, 'a solo mode starts immediately instead of queueing');
  ok(eFound.opponent === null, 'a solo mode announces no opponent');
  e.close();

  await sleep(200);
  console.log(`\n${pass} passed, ${fail} failed`);
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nTEST HARNESS ERROR:', err.message);
  server?.kill();
  process.exit(1);
});
