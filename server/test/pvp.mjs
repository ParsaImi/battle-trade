// Player-vs-player matchmaking and match behaviour.
//
// Runs a real server with a shortened queue wait (MATCH_WAIT_MS) and drives it
// with real WebSocket clients, because the things worth testing here are the
// things that only appear with two connections: perspective flipping, both
// seats scoring, not leaking the opponent's call, and forfeits.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { WebSocket } from 'ws';

const CWD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Fixed ports collide with the previous run's sockets still in TIME_WAIT,
// which shows up as a failed suite when nothing is wrong. Pick a random high
// port per run; PROBE_PORT still pins it when you need a known one.
const PORT = Number(process.env.PROBE_PORT) || 20000 + Math.floor(Math.random() * 20000);
const DATA_DIR_PATH = path.join(CWD, 'test', '.tmp-pvp');
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
const LEGACY_ID = 'pvp-legacy-000000001';

async function startServer() {
  // A player from before titles were purchasable, wearing one that now costs
  // 500 coins. They must not be stripped of it on upgrade.
  fs.mkdirSync(DATA_DIR_PATH, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR_PATH, 'data.json'),
    JSON.stringify({
      [LEGACY_ID]: {
        nickname: 'OldTimer',
        avatar: 'nomad',
        title: 'The Sniper',
        coins: 3000,
        weeklyCoins: 0,
        streak: 0,
        xp: 0,
        lastBonusDay: null,
      },
    }, null, 2),
  );

  server = spawn(process.execPath, ['src/index.js'], {
    cwd: CWD,
    env: {
      ...process.env,
      PORT: String(PORT),
      MATCH_WAIT_MS: String(WAIT_MS),
      PREMATCH_MS: String(PREMATCH_MS),
      DATA_DIR: DATA_DIR_PATH,
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

  // --- every mode looks for a human first -----------------------------------
  // Survival and Blitz used to start instantly against nobody. They now queue
  // like the rest, and only fall back to a solo run when no one turns up.
  const e = await connect('pvp-blitz-0000000001', 'Blitzer');
  await sleep(200);
  const beforeBlitz = Date.now();
  e.send({ type: 'find_match', mode: 'blitz' });
  await waitFor(e, (f) => f.type === 'matchmaking' && f.status === 'searching', 4000, 'blitz searching');
  ok(true, 'a solo mode now queues for a real opponent too');

  const eFound = await waitFor(
    e, (f) => f.type === 'matchmaking' && f.status === 'found', WAIT_MS + 6000, 'blitz found');
  ok(Date.now() - beforeBlitz >= WAIT_MS - 250, 'it waits the full queue time before giving up');
  ok(eFound.opponent === null && eFound.pvp === false, 'alone, a solo mode still runs solo with no opponent');
  e.close();
  await sleep(300);

  // --- two players in a solo mode race each other ---------------------------
  const r1 = await connect('pvp-race-000000001', 'RacerOne');
  const r2 = await connect('pvp-race-000000002', 'RacerTwo');
  await sleep(300);
  r1.send({ type: 'find_match', mode: 'blitz' });
  await sleep(250);
  r2.send({ type: 'find_match', mode: 'blitz' });

  const rf1 = await waitFor(r1, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'race found 1');
  const rf2 = await waitFor(r2, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'race found 2');
  ok(rf1.pvp === true && rf2.pvp === true, 'two players in Blitz are matched against each other');
  ok(rf1.opponent?.nickname === 'RacerTwo', 'a solo mode now names a real opponent');

  const rm1 = await waitFor(r1, (f) => f.type === 'match', 8000, 'race match 1');
  const rm2 = await waitFor(r2, (f) => f.type === 'match', 8000, 'race match 2');
  ok(rm1.match.solo === false, 'a contested Blitz no longer reports itself as solo');
  ok(
    JSON.stringify(rm1.match.candles) === JSON.stringify(rm2.match.candles),
    'both racers get identical charts, so the race is fair',
  );
  ok(rm1.match.opponent?.nickname === 'RacerTwo', 'each racer sees the other as their opponent');
  r1.close();
  r2.close();
  await sleep(300);

  // --- Survival head to head: the two runs end independently ----------------
  // The dangerous part of this mode is that each player dies on their own and
  // the match has to keep running until BOTH are out. One player here never
  // answers, which is a guaranteed death by timeout on round one, while the
  // other keeps calling.
  const s1 = await connect('pvp-surv-000000001', 'Runner');
  const s2 = await connect('pvp-surv-000000002', 'Quitter');
  await sleep(300);
  s1.send({ type: 'find_match', mode: 'survival' });
  await sleep(250);
  s2.send({ type: 'find_match', mode: 'survival' });

  const sf1 = await waitFor(s1, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'surv found');
  ok(sf1.pvp === true, 'Survival matches two real players against each other');

  const runner = setInterval(() => {
    const m = s1.matches[s1.matches.length - 1];
    if (m && m.phase === 'guess' && !m.yourGuess && !m.youAreOut) {
      s1.send({ type: 'match_guess', direction: 'up' });
    }
  }, 200);

  const done1 = await waitFor(
    s1, (f) => f.type === 'match' && f.match.phase === 'complete', 90000, 'surv complete 1');
  const done2 = await waitFor(
    s2, (f) => f.type === 'match' && f.match.phase === 'complete', 90000, 'surv complete 2');
  clearInterval(runner);

  const q = done2.match.matchResult;
  const r = done1.match.matchResult;
  ok(q.survivalScore === 0, 'the player who never answered survived 0 rounds (got ' + q.survivalScore + ')');
  ok(q.endReason === 'timeout', 'and the result says why: ' + q.endReason);

  const expected =
    r.survivalScore > q.survivalScore ? 'win' : r.survivalScore < q.survivalScore ? 'loss' : 'draw';
  ok(r.outcome === expected,
     'outcome follows who lasted longer (' + r.survivalScore + ' vs ' + q.survivalScore + ' -> ' + r.outcome + ')');
  ok(
    (r.outcome === 'win' && q.outcome === 'loss') || (r.outcome === 'draw' && q.outcome === 'draw'),
    'the two results agree (' + r.outcome + ' / ' + q.outcome + ')',
  );
  // Each keeps what their OWN run earned, not one mirrored number.
  ok(q.delta === 0, 'a 0-round run pays nothing (' + q.delta + ')');
  ok(r.survivalScore === 0 || r.delta > 0, 'the surviving run is paid for itself (' + r.delta + ' coins)');
  console.log('      Runner ' + r.survivalScore + ' rounds / ' + r.delta + ' coins, Quitter ' +
    q.survivalScore + ' rounds / ' + q.delta + ' coins');
  s1.close();
  s2.close();

  // --- "Play with AI" skips the wait ----------------------------------------
  const skip = await connect('pvp-skip-000000001', 'Impatient');
  await sleep(250);
  const beforeSkip = Date.now();
  skip.send({ type: 'find_match', mode: 'classic' });
  await waitFor(skip, (f) => f.type === 'matchmaking' && f.status === 'searching', 4000, 'searching(skip)');

  skip.send({ type: 'play_ai' });
  const skipFound = await waitFor(
    skip, (f) => f.type === 'matchmaking' && f.status === 'found', 5000, 'skip found');
  const skipWait = Date.now() - beforeSkip;
  ok(skipWait < WAIT_MS, 'play_ai starts the match without waiting out the queue (' + skipWait + 'ms < ' + WAIT_MS + 'ms)');
  ok(skipFound.pvp === false, 'the skipped match is against the AI, not flagged pvp');
  ok(skipFound.opponent?.isBot === true, 'and the opponent is an AI (' + skipFound.opponent?.nickname + ')');

  await sleep(400);
  const afterSkip = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json();
  ok(afterSkip.queued === 0, 'the player is no longer sitting in the queue');
  await waitFor(skip, (f) => f.type === 'match', 6000, 'skip match started');
  ok(true, 'and the match actually begins');

  // Pressing it when not searching must not start a stray second match.
  const strayBefore = skip.matches.length;
  skip.send({ type: 'play_ai' });
  await sleep(800);
  const strayMatches = skip.matches.slice(strayBefore).filter((m) => m.round === 1 && m.phase === 'guess');
  ok(strayMatches.length === 0, 'pressing it again while already playing does nothing');
  skip.close();
  await sleep(200);

  // --- emotes actually reach the other player -------------------------------
  // They used to be a purely local flourish that never left the browser, so in
  // a real match the opponent saw nothing.
  const e1 = await connect('pvp-emote-000000001', 'Sender');
  const e2 = await connect('pvp-emote-000000002', 'Receiver');
  await sleep(300);
  e1.send({ type: 'find_match', mode: 'classic' });
  await sleep(250);
  e2.send({ type: 'find_match', mode: 'classic' });
  await waitFor(e1, (f) => f.type === 'match', 10000, 'emote match');
  await waitFor(e2, (f) => f.type === 'match', 10000, 'emote match 2');

  e1.send({ type: 'emote', emoji: '🔥' });
  const got = await waitFor(e2, (f) => f.type === 'emote', 5000, 'emote relayed');
  ok(got.emoji === '🔥', 'an emote reaches the opponent (' + got.emoji + ')');
  ok(!e1.frames.some((f) => f.type === 'emote'), 'and is not echoed back to the sender');

  // Only the fixed set may cross: this is the one channel that puts content
  // on someone else's screen.
  const before = e2.frames.filter((f) => f.type === 'emote').length;
  e1.send({ type: 'emote', emoji: 'CLICK HERE http://evil.example' });
  await sleep(700);
  ok(e2.frames.filter((f) => f.type === 'emote').length === before,
     'arbitrary text is refused — only the allowlisted emotes relay');

  // Spamming is throttled rather than flooding the opponent.
  const beforeSpam = e2.frames.filter((f) => f.type === 'emote').length;
  for (let i = 0; i < 6; i++) e1.send({ type: 'emote', emoji: '💀' });
  await sleep(900);
  const delivered = e2.frames.filter((f) => f.type === 'emote').length - beforeSpam;
  ok(delivered < 6, 'rapid-fire emotes are rate limited (' + delivered + ' of 6 delivered)');
  e1.close();
  e2.close();
  await sleep(300);

  // --- titles are owned, priced, and grandfathered --------------------------
  const t = await connect('pvp-title-000000001', 'Collector');
  await waitFor(t, (f) => f.type === 'registered', 5000, 'registered(title)');
  await sleep(400);
  let lob = t.frames.filter((f) => f.type === 'lobby').pop();
  ok(lob.you.unlockedTitles.length === 2, 'a new player owns exactly the two free titles');
  ok(lob.you.unlockedTitles.includes('Rookie') && lob.you.unlockedTitles.includes('Paper Hands'),
     'and they are the free ones (' + lob.you.unlockedTitles.join(', ') + ')');

  // Wearing a title you do not own must be refused server-side.
  t.send({ type: 'set_title', title: 'Legend' });
  await sleep(500);
  lob = t.frames.filter((f) => f.type === 'lobby').pop();
  ok(lob.you.title !== 'Legend', 'a title you do not own cannot be equipped');

  // Nor bought without the coins.
  t.send({ type: 'buy_title', title: 'Legend' });
  const denied = await waitFor(t, (f) => f.type === 'purchase' && f.kind === 'title', 5000, 'denied');
  ok(denied.ok === false && denied.reason === 'not_enough_coins',
     'and cannot be bought without the coins (' + denied.reason + ')');

  // An affordable one goes through and equips itself.
  t.send({ type: 'buy_title', title: 'Lucky Bastard' });
  await sleep(600);
  lob = t.frames.filter((f) => f.type === 'lobby').pop();
  const bought = lob.you.unlockedTitles.includes('Lucky Bastard');
  ok(!bought || lob.you.title === 'Lucky Bastard',
     'buying a title equips it in the same step' + (bought ? '' : ' (skipped: player could not afford it)'));
  t.close();
  await sleep(200);

  // --- a player already wearing a now-paid title keeps it -------------------
  const old = await connect(LEGACY_ID, 'OldTimer');
  await waitFor(old, (f) => f.type === 'registered', 5000, 'registered(legacy)');
  await sleep(400);
  let ol = old.frames.filter((f) => f.type === 'lobby').pop();
  ok(ol.you.title === 'The Sniper',
     'a player wearing a title from before it was purchasable keeps wearing it');
  ok(ol.you.unlockedTitles.includes('The Sniper'),
     'and it is granted to them rather than left equipped-but-unowned');

  // With coins in hand, buying works end to end. Read the balance first: the
  // daily login bonus lands on connect, so the seeded number is not the one to
  // subtract from.
  const coinsBefore = ol.you.coins;
  old.send({ type: 'buy_title', title: 'Market Maker' });
  await sleep(700);
  ol = old.frames.filter((f) => f.type === 'lobby').pop();
  ok(ol.you.unlockedTitles.includes('Market Maker'), 'a title they can afford is bought');
  ok(ol.you.title === 'Market Maker', 'and equipped in the same step');
  ok(ol.you.coins === coinsBefore - 1000,
     'the price is deducted (' + coinsBefore + ' - 1000 = ' + ol.you.coins + ')');

  old.send({ type: 'set_title', title: 'The Sniper' });
  await sleep(500);
  ol = old.frames.filter((f) => f.type === 'lobby').pop();
  ok(ol.you.title === 'The Sniper', 'and they can switch back to one they already own');
  old.close();
  await sleep(200);

  // --- chart history is context, never the answer ---------------------------
  // The chart ships extra candles from BEFORE the round so players can scroll
  // back and see the trend. The thing that must hold is that scrolling back
  // never scrolls forward: during the guess phase the client must hold exactly
  // the lead-in plus the 28 visible candles, and not one candle more.
  const chart = await connect('pvp-chart-000000001', 'Charty');
  await sleep(250);
  chart.send({ type: 'find_match', mode: 'blitz' });
  await waitFor(chart, (f) => f.type === 'matchmaking' && f.status === 'searching', 4000, 'chart searching');
  chart.send({ type: 'play_ai' });
  await waitFor(chart, (f) => f.type === 'match', 8000, 'chart match');

  await sleep(6000); // long enough for a Blitz round to resolve
  const guessFrames = chart.matches.filter((m) => m.phase === 'guess');
  const revealFrames = chart.matches.filter((m) => m.phase === 'reveal' || m.phase === 'results');
  ok(guessFrames.length > 0 && revealFrames.length > 0,
     'saw both phases (guess=' + guessFrames.length + ', reveal=' + revealFrames.length + ')');

  // Pair them by round: Blitz turns rounds over every few seconds, so the
  // newest guess frame and the newest reveal frame are usually different
  // charts, and comparing those compares nothing.
  const pairedRound = revealFrames
    .map((m) => m.round)
    .find((n) => guessFrames.some((m) => m.round === n));
  ok(pairedRound !== undefined, 'captured a guess and a reveal from the same round (round ' + pairedRound + ')');
  const gFrame = guessFrames.filter((m) => m.round === pairedRound).pop();
  ok(typeof gFrame.historyCount === 'number' && gFrame.historyCount > 0,
     'the guess phase ships lead-in history (' + gFrame.historyCount + ' candles)');
  ok(gFrame.candles.length === gFrame.historyCount + 28,
     'and exactly history + 28 candles, so nothing past the split is sent (' + gFrame.candles.length + ')');

  const rFrame = revealFrames.filter((m) => m.round === pairedRound).pop();
  ok(rFrame.candles.length === rFrame.historyCount + 40,
     'the reveal adds the remaining 12 and no more (' + rFrame.candles.length + ')');

  // The history must be identical across phases — it is context, not a moving
  // window that could smuggle the answer in.
  ok(
    JSON.stringify(gFrame.candles.slice(0, gFrame.historyCount)) ===
      JSON.stringify(rFrame.candles.slice(0, rFrame.historyCount)),
    'the lead-in is unchanged between the guess and the reveal',
  );
  // And the candles a player was already shown do not change under them.
  ok(
    JSON.stringify(gFrame.candles) === JSON.stringify(rFrame.candles.slice(0, gFrame.candles.length)),
    'the revealed chart extends the guess-phase chart rather than replacing it',
  );

  // --- what the chart is allowed to tell you, and when ----------------------
  // Instrument and timeframe are shown from the start: knowing it is ADA/USDT
  // on 15m says nothing about what happens next, and an unidentifiable chart
  // is a worse game. The DATE waits, because instrument + timeframe + date
  // against the visible prices is enough to look the window up.
  if (gFrame.chartMeta && gFrame.chartMeta.real) {
    ok(!!gFrame.chartMeta.label && !!gFrame.chartMeta.interval,
       'the guess phase names the instrument and timeframe (' + gFrame.chartMeta.label + ' ' + gFrame.chartMeta.interval + ')');
    ok(gFrame.chartMeta.date === undefined,
       'but never the date, which is the part that makes it findable');
    ok(!!rFrame.chartMeta && !!rFrame.chartMeta.date,
       'the date arrives once the calls are locked in (' + rFrame.chartMeta?.date + ')');
  } else {
    // No live feed in this environment, so the round fell back to a simulated
    // chart. Assert the fallback is labelled as such rather than skipping.
    ok(gFrame.chartMeta === null || gFrame.chartMeta.real === false,
       'a simulated fallback chart is flagged real=false, not passed off as market data');
  }

  chart.close();
  await sleep(200);

  // --- private rooms --------------------------------------------------------
  const host = await connect('pvp-room-host-00001', 'Host');
  const mate = await connect('pvp-room-mate-00001', 'Mate');
  await sleep(300);

  host.send({ type: 'create_room', mode: 'classic' });
  const made = await waitFor(host, (f) => f.type === 'room', 6000, 'room created');
  ok(made.ok === true && made.status === 'waiting', 'a room opens and reports itself waiting');
  ok(/^[A-Z0-9]{5}$/.test(made.code || ''), 'the code is 5 readable characters (' + made.code + ')');
  ok(!/[ILO01]/.test(made.code || ''), 'and avoids the characters people mistype (I, L, O, 0, 1)');

  // A wrong code must not silently do nothing.
  mate.send({ type: 'join_room', code: 'ZZZZZ' });
  const missing = await waitFor(mate, (f) => f.type === 'room' && f.ok === false, 6000, 'bad code');
  ok(missing.reason === 'room_not_found', 'an unknown code is refused (' + missing.reason + ')');

  // You cannot join your own room. Wait out the match-creation cooldown
  // first: create_room set it, and it also throttles code guessing.
  await sleep(900);
  host.send({ type: 'join_room', code: made.code });
  const own = await waitFor(host, (f) => f.type === 'room' && f.ok === false, 6000, 'own room');
  ok(own.reason === 'own_room', 'joining your own room is refused');

  // The real thing.
  await sleep(900);
  mate.send({ type: 'join_room', code: made.code });
  const hostFound = await waitFor(host, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'host found');
  const mateFound = await waitFor(mate, (f) => f.type === 'matchmaking' && f.status === 'found', 8000, 'mate found');
  ok(hostFound.pvp === true && mateFound.pvp === true, 'the code pairs the two as a real PvP match');
  ok(hostFound.opponent?.nickname === 'Mate' && mateFound.opponent?.nickname === 'Host',
     'and they face each other, not strangers from the queue');

  await waitFor(host, (f) => f.type === 'match', 8000, 'host match');
  await waitFor(mate, (f) => f.type === 'match', 8000, 'mate match');
  ok(host.matches[0].mode === 'classic', 'the room plays the mode the host picked');

  // The code is consumed: a third player cannot walk into the same room.
  const third = await connect('pvp-room-third-0001', 'Third');
  await sleep(250);
  third.send({ type: 'join_room', code: made.code });
  const reused = await waitFor(third, (f) => f.type === 'room' && f.ok === false, 6000, 'reused code');
  ok(reused.reason === 'room_not_found', 'the code cannot be used twice');
  third.close();
  host.close();
  mate.close();
  await sleep(300);

  // A host who disconnects takes the room with them.
  const ghost = await connect('pvp-room-ghost-0001', 'Ghost');
  await sleep(250);
  ghost.send({ type: 'create_room', mode: 'blitz' });
  const ghostRoom = await waitFor(ghost, (f) => f.type === 'room' && f.ok, 6000, 'ghost room');
  ghost.close();
  await sleep(600);

  const seeker = await connect('pvp-room-seek-00001', 'Seeker');
  await sleep(250);
  seeker.send({ type: 'join_room', code: ghostRoom.code });
  const gone = await waitFor(seeker, (f) => f.type === 'room' && f.ok === false, 6000, 'ghost gone');
  ok(['room_not_found', 'host_left'].includes(gone.reason),
     'a room dies with the host who opened it (' + gone.reason + ')');
  seeker.close();
  await sleep(200);

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
