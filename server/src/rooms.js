// Private rooms: a player creates one, gets a short code, and whoever they
// send it to joins that exact match instead of taking their chances in the
// open queue.
//
// A room only ever holds the host. The moment someone joins, the room is
// consumed and both players go straight into a match — there is no lobby state
// to keep in sync, and no room that can outlive the match it started.

import { log } from './logger.js';

// No I, L, O, 0 or 1: codes get read aloud and typed from memory, and those
// are the characters people get wrong.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

// A room nobody joins should not sit there forever holding a wager.
export const ROOM_TTL_MS = 15 * 60_000;

// code -> { code, guestId, ws, mode, wager, createdAt, timer }
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function normalise(code) {
  return String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Open a room for this player.
 * @param entry { guestId, ws, mode, wager }
 * @param onExpire called with the entry if nobody joins in time
 */
export function create(entry, onExpire) {
  // One room per player: opening a second closes the first, so a player can
  // never be sitting in two rooms with two wagers taken.
  closeFor(entry.guestId);

  const code = makeCode();
  const room = { ...entry, code, createdAt: Date.now() };
  room.timer = setTimeout(() => {
    if (rooms.get(code) !== room) return;
    rooms.delete(code);
    log.info(`rooms: ${code} expired unclaimed`);
    onExpire?.(room);
  }, ROOM_TTL_MS);

  rooms.set(code, room);
  log.info(`rooms: ${entry.guestId} opened ${code} (${entry.mode})`);
  return room;
}

/**
 * Claim a room. Returns { ok, room } or { ok: false, reason }.
 * The room is consumed on success, so two people racing the same code cannot
 * both be told they joined.
 */
export function claim(code, guestId) {
  const key = normalise(code);
  const room = rooms.get(key);
  if (!room) return { ok: false, reason: 'room_not_found' };
  if (room.guestId === guestId) return { ok: false, reason: 'own_room' };
  if (room.ws.readyState !== room.ws.OPEN) {
    // Host has gone; clear it rather than pairing against a dead socket.
    clearTimeout(room.timer);
    rooms.delete(key);
    return { ok: false, reason: 'host_left' };
  }
  clearTimeout(room.timer);
  rooms.delete(key);
  log.info(`rooms: ${guestId} joined ${key}`);
  return { ok: true, room };
}

/** Close whatever room this player is hosting. Returns it, so a wager can be refunded. */
export function closeFor(guestId) {
  for (const [code, room] of rooms) {
    if (room.guestId === guestId) {
      clearTimeout(room.timer);
      rooms.delete(code);
      return room;
    }
  }
  return null;
}

export function closeBySocket(ws) {
  for (const [code, room] of rooms) {
    if (room.ws === ws) {
      clearTimeout(room.timer);
      rooms.delete(code);
      return room;
    }
  }
  return null;
}

export function openCount() {
  return rooms.size;
}

// Test seam.
export function clearRooms() {
  for (const room of rooms.values()) clearTimeout(room.timer);
  rooms.clear();
}
