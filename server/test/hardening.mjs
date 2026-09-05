// Backend hardening checks. Runs a throwaway server on its own port and
// throws malformed / abusive traffic at it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

// Fixed ports collide with the previous run's sockets still in TIME_WAIT,
// which shows up as a failed suite when nothing is wrong. Pick a random high
// port per run; PROBE_PORT still pins it when you need a known one.
const PORT = Number(process.env.PROBE_PORT) || 20000 + Math.floor(Math.random() * 20000);
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Its own directory, not the package default. The default is the same file
// a dev server running on 8787 writes to, and two processes saving over each
// other produced failures that had nothing to do with the code under test.
const DATA_DIR = path.join(CWD, 'test', '.tmp-hardening');
const DATA = path.join(DATA_DIR, 'data.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const backup = fs.existsSync(DATA) ? fs.readFileSync(DATA, 'utf-8') : '{}';

let server, exited, stderr;
function boot() {
  exited = null;
  stderr = '';
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: CWD,
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => (stderr += d.toString()));
  server.stdout.on('data', () => {});
  server.on('exit', (c) => (exited = c));
}

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMsg(ws, type, timeout = 2500) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeout);
    const onMsg = (d) => {
      const m = JSON.parse(d.toString());
      if (!type || m.type === type) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
  });
}

boot();
await sleep(1300);
if (exited !== null) {
  console.log('server failed to boot:', stderr);
  process.exit(1);
}

// ---- 1. malformed frames must not kill the process ----
const malformed = ['null', '"hello"', '42', '[1,2,3]', 'true', '{}', '{"type":123}', 'not json at all'];
for (const payload of malformed) {
  const ws = await open();
  ws.send(payload);
  await sleep(120);
  ws.close();
}
await sleep(300);
ok('survives malformed frames', exited === null, exited !== null ? `exited ${exited}` : '');

// ---- 2. unregistered actions are ignored, not fatal ----
{
  const ws = await open();
  ws.send(JSON.stringify({ type: 'start_match', mode: 'classic' }));
  ws.send(JSON.stringify({ type: 'buy_avatar', avatar: 'king' }));
  ws.send(JSON.stringify({ type: 'claim_quest', questId: 'nope' }));
  await sleep(250);
  ws.close();
}
await sleep(200);
ok('ignores actions before register', exited === null);

// ---- 3. bogus values on registered actions ----
{
  const ws = await open();
  ws.send(JSON.stringify({ type: 'register', guestId: 'probe-guest-0001', nickname: 'Probe' }));
  await nextMsg(ws, 'registered');
  for (const bad of [
    { type: 'set_avatar', avatar: { evil: true } },
    { type: 'set_title', title: 99 },
    { type: 'buy_avatar', avatar: null },
    { type: 'claim_quest', questId: ['x'] },
    { type: 'set_nickname', nickname: null },
    { type: 'start_match', mode: 'does_not_exist' },
    { type: 'match_guess', direction: 'sideways' },
  ]) {
    ws.send(JSON.stringify(bad));
    await sleep(80);
  }
  await sleep(300);
  ok('survives bogus field values', exited === null);
  ws.close();
}

// ---- 4. rate limiting ----
{
  const ws = await open();
  ws.send(JSON.stringify({ type: 'register', guestId: 'probe-guest-0002', nickname: 'Flood' }));
  await nextMsg(ws, 'registered');
  let replies = 0;
  ws.on('message', () => replies++);
  for (let i = 0; i < 400; i++) ws.send(JSON.stringify({ type: 'set_title', title: 'The Sniper' }));
  await sleep(900);
  ok('rate limiter caps a 400-message flood', replies < 200, `${replies} replies`);
  ok('still alive after flood', exited === null);
  ws.close();
}

// ---- 5. oversized payload is rejected without killing the server ----
{
  const ws = await open();
  ws.send(JSON.stringify({ type: 'register', guestId: 'probe-guest-0003', nickname: 'Big' }));
  await nextMsg(ws, 'registered');
  ws.send(JSON.stringify({ type: 'set_nickname', nickname: 'x'.repeat(200000) }));
  await sleep(400);
  ok('survives oversized frame', exited === null);
  try { ws.close(); } catch {}
}

// ---- 6. health endpoint ----
{
  const res = await fetch(`http://localhost:${PORT}/health`).then((r) => r.json());
  ok('health reports diagnostics', res.ok === true && typeof res.players === 'number' && typeof res.connections === 'number',
     JSON.stringify(res));
}

// ---- 7. durability of normal (debounced) writes ----
{
  const ws = await open();
  ws.send(JSON.stringify({ type: 'register', guestId: 'probe-guest-flush', nickname: 'FlushMe' }));
  await nextMsg(ws, 'registered');
  // A free title: equipping is ownership-checked now, and this test is about
  // whether the write reaches disk, not about the shop.
  ws.send(JSON.stringify({ type: 'set_title', title: 'Paper Hands' }));
  await sleep(900); // longer than the 400ms save debounce
  const saved = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  ok('debounced write reaches disk', saved['probe-guest-flush']?.title === 'Paper Hands',
     `title=${saved['probe-guest-flush']?.title}`);
  ok('no temp file left behind', !fs.existsSync(DATA + '.tmp'));
  ok('save file is valid JSON', typeof saved === 'object' && !Array.isArray(saved));
  ws.close();
}

// ---- 7b. shutdown flush ----
// Windows cannot deliver SIGTERM to a child process (kill() maps to
// TerminateProcess), so the handler is only exercisable on POSIX.
if (process.platform === 'win32') {
  console.log('SKIP  SIGTERM flush — not deliverable to a child on win32');
  server.kill();
  await sleep(600);
} else {
  const ws = await open();
  ws.send(JSON.stringify({ type: 'register', guestId: 'probe-guest-sig', nickname: 'SigMe' }));
  await nextMsg(ws, 'registered');
  ws.send(JSON.stringify({ type: 'set_title', title: 'Market Maker' }));
  await sleep(60); // inside the debounce window — only a flush saves this
  server.kill('SIGTERM');
  await sleep(1200);
  const saved = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  ok('SIGTERM flushes pending save', saved['probe-guest-sig']?.title === 'Market Maker');
  ok('shutdown exits cleanly', exited === 0, `exit ${exited}`);
}

// ---- 8. corrupt save falls back to the backup ----
{
  fs.copyFileSync(DATA, DATA + '.bak');
  fs.writeFileSync(DATA, '{ this is not valid json');
  boot();
  await sleep(1400);
  const res = await fetch(`http://localhost:${PORT}/health`).then((r) => r.json()).catch(() => null);
  ok('recovers from a corrupt save file', res?.ok === true && res.players > 0, JSON.stringify(res));
  server.kill('SIGTERM');
  await sleep(900);
}

// restore the real data file
fs.writeFileSync(DATA, backup);
try { fs.unlinkSync(DATA + '.bak'); } catch {}
try { fs.unlinkSync(DATA + '.tmp'); } catch {}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
