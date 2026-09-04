// Accounts, layered on guest play.
//
// The behaviour that matters: a guest keeps playing without an account, signing
// up carries their existing progress across, logging in on a second device
// picks that progress up, and none of it can be brute-forced.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { WebSocket } from 'ws';

const CWD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PROBE_PORT) || 8917;
const DATA = path.join(CWD, 'test', '.tmp-auth');

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log(`PASS  ${m}`); }
  else { fail++; console.log(`FAIL  ${m}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
async function startServer() {
  fs.rmSync(DATA, { recursive: true, force: true });
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: CWD,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, MATCH_WAIT_MS: '1500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (process.env.VERBOSE) {
    server.stdout.on('data', (d) => process.stdout.write('  [srv] ' + d));
    server.stderr.on('data', (d) => process.stdout.write('  [srv!] ' + d));
  }
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
  }
  throw new Error('server did not start');
}

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const c = {
    ws,
    frames: [],
    send: (o) => ws.send(JSON.stringify(o)),
    close: () => ws.close(),
    last: (t) => [...c.frames].reverse().find((f) => f.type === t) ?? null,
  };
  ws.on('message', (raw) => c.frames.push(JSON.parse(raw.toString())));
  return new Promise((res, rej) => {
    ws.on('open', () => res(c));
    ws.on('error', rej);
  });
}

async function waitFor(c, pred, ms = 6000, label = 'frame') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = c.frames.find(pred);
    if (hit) return hit;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function run() {
  await startServer();

  // --- guests still work, untouched -----------------------------------------
  const guest = await connect();
  guest.send({ type: 'register', guestId: 'auth-guest-000000001', nickname: 'JustAGuest' });
  const reg = await waitFor(guest, (f) => f.type === 'registered', 6000, 'registered');
  ok(reg.guestId === 'auth-guest-000000001', 'a guest can still play with no account at all');
  ok(reg.account === null, 'a plain guest reports no account');

  // Give this guest something worth keeping.
  // A free title — equipping is ownership-checked since titles became
  // purchasable, and this test is about the account carrying progress.
  guest.send({ type: 'set_title', title: 'Paper Hands' });
  await sleep(400);
  const lobby = guest.last('lobby');
  const coinsBefore = lobby.you.coins;
  ok(coinsBefore > 0, `guest has earned something to carry over (${coinsBefore} coins)`);

  // --- signing up claims that progress --------------------------------------
  guest.send({ type: 'signup', username: 'trader_one', password: 'correct horse battery' });
  const signup = await waitFor(guest, (f) => f.type === 'auth' && f.action === 'signup', 8000, 'signup');
  ok(signup.ok === true, `signup succeeded (${signup.reason ?? 'no error'})`);
  ok(typeof signup.token === 'string' && signup.token.length >= 64, 'signup returns a session token');

  await sleep(300);
  const afterSignup = guest.last('lobby');
  ok(afterSignup.you.coins === coinsBefore,
     `progress carried into the account (${afterSignup.you.coins} coins, was ${coinsBefore})`);
  ok(guest.last('registered').account === 'trader_one', 'the connection now reports the account name');
  const token = signup.token;
  guest.close();
  await sleep(200);

  // --- duplicate usernames are refused --------------------------------------
  const dup = await connect();
  dup.send({ type: 'register', guestId: 'auth-dup-00000000001', nickname: 'Dup' });
  await waitFor(dup, (f) => f.type === 'registered', 4000, 'registered(dup)');
  dup.send({ type: 'signup', username: 'TRADER_ONE', password: 'another password here' });
  const dupRes = await waitFor(dup, (f) => f.type === 'auth' && f.action === 'signup', 8000, 'dup signup');
  ok(dupRes.ok === false && dupRes.reason === 'username_taken',
     `the same name is refused regardless of case (${dupRes.reason})`);
  dup.close();
  await sleep(200);

  // --- weak input is refused -------------------------------------------------
  const weak = await connect();
  weak.send({ type: 'register', guestId: 'auth-weak-0000000001', nickname: 'Weak' });
  await waitFor(weak, (f) => f.type === 'registered', 4000, 'registered(weak)');
  weak.send({ type: 'signup', username: 'ok_name', password: 'short' });
  const weakRes = await waitFor(weak, (f) => f.type === 'auth' && f.action === 'signup', 6000, 'weak');
  ok(weakRes.ok === false && weakRes.reason === 'weak_password', 'a short password is refused');

  weak.send({ type: 'signup', username: 'no spaces!', password: 'a good long password' });
  const badName = await waitFor(
    weak, (f) => f.type === 'auth' && f.action === 'signup' && f.reason === 'bad_username', 6000, 'bad name');
  ok(!!badName, 'an invalid username is refused');
  weak.close();
  await sleep(200);

  // --- logging in from a "second device" ------------------------------------
  // A fresh connection with a different guest id, as a different browser would
  // be. Logging in must land on the ACCOUNT's progress, not this device's.
  const other = await connect();
  other.send({ type: 'register', guestId: 'auth-other-000000001', nickname: 'OtherDevice' });
  const otherReg = await waitFor(other, (f) => f.type === 'registered', 4000, 'registered(other)');
  ok(otherReg.guestId === 'auth-other-000000001', 'second device starts on its own guest id');

  other.send({ type: 'login', username: 'trader_one', password: 'correct horse battery' });
  const loginRes = await waitFor(other, (f) => f.type === 'auth' && f.action === 'login', 8000, 'login');
  ok(loginRes.ok === true, `login succeeded (${loginRes.reason ?? 'no error'})`);

  await sleep(300);
  const otherLobby = other.last('lobby');
  ok(otherLobby.you.coins === coinsBefore,
     `the account's progress followed to the second device (${otherLobby.you.coins} coins)`);
  ok(otherLobby.you.title === 'Paper Hands', 'and so did the equipped title');
  const secondToken = loginRes.token;
  ok(secondToken !== token, 'each login mints a distinct session token');
  other.close();
  await sleep(200);

  // --- wrong password --------------------------------------------------------
  const wrong = await connect();
  wrong.send({ type: 'login', username: 'trader_one', password: 'not the password' });
  const wrongRes = await waitFor(wrong, (f) => f.type === 'auth' && f.action === 'login', 6000, 'wrong pw');
  ok(wrongRes.ok === false && wrongRes.reason === 'bad_credentials', 'a wrong password is refused');

  wrong.send({ type: 'login', username: 'nobody_here', password: 'not the password' });
  const unknown = await waitFor(
    wrong, (f) => f.type === 'auth' && f.action === 'login' && f.reason, 6000, 'unknown user');
  ok(unknown.reason === 'bad_credentials',
     'an unknown username gives the same answer as a wrong password (no account enumeration)');
  wrong.close();
  await sleep(200);

  // --- resuming a saved session ---------------------------------------------
  const resumed = await connect();
  resumed.send({ type: 'resume', token: secondToken });
  const resumeRes = await waitFor(resumed, (f) => f.type === 'auth' && f.action === 'resume', 6000, 'resume');
  ok(resumeRes.ok === true, 'a saved token resumes the session with no password');
  await sleep(300);
  ok(resumed.last('lobby').you.coins === coinsBefore, 'resumed session sees the account progress');

  // --- logout invalidates that token ----------------------------------------
  resumed.send({ type: 'logout', token: secondToken });
  await waitFor(resumed, (f) => f.type === 'auth' && f.action === 'logout', 6000, 'logout');
  resumed.close();
  await sleep(300);

  const stale = await connect();
  stale.send({ type: 'resume', token: secondToken });
  const staleRes = await waitFor(stale, (f) => f.type === 'auth' && f.action === 'resume', 6000, 'stale resume');
  ok(staleRes.ok === false && staleRes.reason === 'session_expired',
     'the token stops working after logout');
  stale.close();
  await sleep(200);

  // --- brute force is throttled ---------------------------------------------
  const attacker = await connect();
  let refusedAt = 0;
  for (let i = 0; i < 12; i++) {
    attacker.send({ type: 'login', username: 'trader_one', password: `guess-${i}` });
    await sleep(120);
  }
  await sleep(600);
  const lock = attacker.frames.find((f) => f.type === 'auth' && f.reason === 'locked_out');
  const replies = attacker.frames.filter((f) => f.type === 'auth' && f.action === 'login').length;
  refusedAt = replies;
  ok(!!lock, `repeated wrong passwords lock the account out (${lock?.retryInSec ?? '?'}s)`);
  ok(refusedAt < 12, `not every attempt even got a reply (${refusedAt}/12 answered — per-socket cap)`);

  // The real password must still be refused while locked out.
  attacker.send({ type: 'login', username: 'trader_one', password: 'correct horse battery' });
  await sleep(500);
  const afterLock = [...attacker.frames].reverse().find((f) => f.type === 'auth' && f.action === 'login');
  ok(afterLock.ok === false, 'even the correct password is refused during lockout');
  attacker.close();
  await sleep(200);

  // --- passwords are never stored in the clear -------------------------------
  const raw = fs.readFileSync(path.join(DATA, 'accounts.json'), 'utf8');
  ok(!raw.includes('correct horse battery'), 'the password is not in the accounts file');
  ok(!raw.includes(secondToken), 'session tokens are stored hashed, not verbatim');
  const parsed = JSON.parse(raw);
  const rec = parsed.accounts['trader_one'];
  ok(!!rec && typeof rec.hash === 'string' && rec.hash.length === 128, 'the password is stored as a scrypt hash');
  ok(typeof rec.salt === 'string' && rec.salt.length === 32, 'each account has its own salt');
  ok(rec.guestId === 'auth-guest-000000001', 'the account is bound to the guest id it claimed');

  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok(health.accounts === 1, `health reports the account count (${health.accounts})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  // Stop the server and let its handles finish closing before exiting.
  // Calling process.exit() while sockets are still closing aborts the process
  // on Windows (a libuv assertion), which reads as a failed test run.
  server.kill();
  await sleep(600);
  try {
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch { /* the child may hold it briefly; the dir is gitignored anyway */ }
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nTEST HARNESS ERROR:', err.message);
  server?.kill();
  process.exit(1);
});
