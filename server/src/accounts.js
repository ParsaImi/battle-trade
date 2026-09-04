// Optional accounts, layered on top of guest play.
//
// A guest is just a random id in localStorage. That is fine until the player
// changes browser or picks up their phone, at which point their coins are gone.
// An account fixes that without taking anything away: guests keep playing
// exactly as before, and signing up simply *binds* the guest id they already
// have, so whatever they have earned comes with them.
//
//   username -> { salt, hash, guestId }
//
// Everything else in the game stays keyed by guestId, so none of the match,
// store or leaderboard code had to change: logging in just resolves a username
// back to the guest id the account owns.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger.js';
import { DATA_DIR } from './store.js';

const FILE = path.join(DATA_DIR, 'accounts.json');
const TMP = `${FILE}.tmp`;
const BAK = `${FILE}.bak`;
const SAVE_DEBOUNCE_MS = 400;

// scrypt is in the standard library, so there is no native dependency to build
// in the container. These are the Node defaults plus a 64-byte key.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
// Brute-force guard, per username.
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60_000;

// lowercased username -> { username, salt, hash, guestId, createdAt }
let accounts = new Map();
// sha256(token) -> { username, guestId, expiresAt }
let sessions = new Map();
// lowercased username -> { count, until }
const attempts = new Map();

const key = (username) => String(username).toLowerCase();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
}

function verifyPassword(password, salt, expected) {
  let actual;
  try {
    actual = hashPassword(password, salt);
  } catch {
    return false;
  }
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  // Lengths must match before timingSafeEqual, and comparing them is not a leak.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- persistence ----------------------------------------------------------
// Same atomic pattern as the player store: temp file, keep a backup, rename.
// Sessions are stored as token *hashes*, so a leaked save file cannot be
// replayed to impersonate anyone.

export function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    log.error(`could not create data directory ${DATA_DIR}`, err);
  }

  for (const file of [FILE, BAK]) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') log.error(`could not read ${path.basename(file)}`, err);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      accounts = new Map(Object.entries(parsed.accounts ?? {}));
      sessions = new Map(Object.entries(parsed.sessions ?? {}));
      pruneSessions();
      if (file === BAK) log.warn('main accounts file was unusable — recovered from backup');
      log.info(`loaded ${accounts.size} accounts, ${sessions.size} live sessions`);
      return;
    } catch (err) {
      log.error(`corrupt accounts file ${path.basename(file)}`, err);
    }
  }
  accounts = new Map();
  sessions = new Map();
  log.info('starting with no accounts');
}

let saveTimer = null;

export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const json = JSON.stringify(
      { accounts: Object.fromEntries(accounts), sessions: Object.fromEntries(sessions) },
      null,
      2,
    );
    fs.writeFileSync(TMP, json);
    try {
      fs.copyFileSync(FILE, BAK);
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('could not refresh accounts backup', err.message);
    }
    fs.renameSync(TMP, FILE);
    return true;
  } catch (err) {
    log.error('accounts save failed', err);
    return false;
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

function pruneSessions() {
  const now = Date.now();
  let dropped = 0;
  for (const [h, s] of sessions) {
    if (!s || s.expiresAt <= now) {
      sessions.delete(h);
      dropped++;
    }
  }
  return dropped;
}

export function accountCount() {
  return accounts.size;
}

// --- rate limiting --------------------------------------------------------

function lockedOut(username) {
  const a = attempts.get(key(username));
  if (!a) return 0;
  if (a.until && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  if (a.until && a.until <= Date.now()) attempts.delete(key(username));
  return 0;
}

function noteFailure(username) {
  const k = key(username);
  const a = attempts.get(k) ?? { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    a.until = Date.now() + LOCKOUT_MS;
    a.count = 0;
    log.warn(`accounts: too many failed logins for "${username}" — locked for ${LOCKOUT_MS / 60000}m`);
  }
  attempts.set(k, a);
}

function clearFailures(username) {
  attempts.delete(key(username));
}

// --- sessions -------------------------------------------------------------

function issueSession(username, guestId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(hashToken(token), {
    username,
    guestId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  scheduleSave();
  return token;
}

/** Resolve a session token. Returns { username, guestId } or null. */
export function resumeSession(token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const h = hashToken(token);
  const s = sessions.get(h);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(h);
    scheduleSave();
    return null;
  }
  // The account may have been removed since the token was minted.
  if (!accounts.has(key(s.username))) {
    sessions.delete(h);
    scheduleSave();
    return null;
  }
  return { username: s.username, guestId: s.guestId };
}

export function endSession(token) {
  if (typeof token !== 'string') return false;
  const removed = sessions.delete(hashToken(token));
  if (removed) scheduleSave();
  return removed;
}

// --- signup / login -------------------------------------------------------

function validate(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'bad_username';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return 'weak_password';
  }
  if (password.length > MAX_PASSWORD) return 'weak_password';
  return null;
}

/**
 * Create an account that owns `guestId`, so everything the player has already
 * earned as a guest becomes the account's.
 */
export function signup(username, password, guestId) {
  const bad = validate(username, password);
  if (bad) return { ok: false, reason: bad };
  if (accounts.has(key(username))) return { ok: false, reason: 'username_taken' };
  if (typeof guestId !== 'string' || guestId.length < 8) return { ok: false, reason: 'bad_guest' };

  const salt = crypto.randomBytes(16).toString('hex');
  const record = {
    username,
    salt,
    hash: hashPassword(password, salt),
    guestId,
    createdAt: Date.now(),
  };
  accounts.set(key(username), record);
  scheduleSave();
  log.info(`accounts: created "${username}" bound to ${guestId}`);

  return { ok: true, username, guestId, token: issueSession(username, guestId) };
}

export function login(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, reason: 'bad_credentials' };
  }
  const wait = lockedOut(username);
  if (wait) return { ok: false, reason: 'locked_out', retryInSec: wait };

  const acc = accounts.get(key(username));
  // Same generic answer whether the name is unknown or the password is wrong,
  // so this cannot be used to enumerate accounts.
  if (!acc || !verifyPassword(password, acc.salt, acc.hash)) {
    noteFailure(username);
    return { ok: false, reason: 'bad_credentials' };
  }

  clearFailures(username);
  return {
    ok: true,
    username: acc.username,
    guestId: acc.guestId,
    token: issueSession(acc.username, acc.guestId),
  };
}

/** Which account, if any, owns this guest id. */
export function accountForGuest(guestId) {
  for (const acc of accounts.values()) {
    if (acc.guestId === guestId) return acc.username;
  }
  return null;
}

export const LIMITS = { USERNAME_RE, MIN_PASSWORD, MAX_PASSWORD };
