// Matchmaking queue for player-vs-player modes.
//
// A player who picks a PvP mode joins the queue instead of starting a match
// immediately. If someone else is already waiting for the same mode (and the
// same wager, where the mode has one), the two are paired at once. Otherwise
// the player waits, and after WAIT_MS with nobody found they are given an AI
// opponent so a lone player is never stuck.
//
// The queue holds at most one entry per guestId: opening a second tab replaces
// the first entry rather than letting a player match against themselves.

import { log } from './logger.js';

// How long a player waits for a human before falling back to the AI.
// Tunable without a code change; the tests shorten it so they need not sit
// through the real 30 seconds.
export const WAIT_MS = Number(process.env.MATCH_WAIT_MS) || 30_000;

// guestId -> entry. Insertion order is FIFO, so the longest waiter is paired
// first — Map preserves it and re-inserting on replace is fine (a replaced
// entry has been waiting from scratch anyway).
const waiting = new Map();

function key(entry) {
  // Only players wanting the same thing are comparable. Wager is part of the
  // key so a 100-coin player is never matched against a 1000-coin one.
  return `${entry.mode}:${entry.wager ?? 0}`;
}

/**
 * Join the queue.
 *
 * @param entry { guestId, ws, mode, wager }
 * @param handlers { onPair(a, b), onTimeout(entry) }
 * @returns 'paired' | 'waiting'
 */
export function join(entry, { onPair, onTimeout }) {
  // Drop any previous entry for this player first, so a double-click or a
  // second tab can't put the same guestId in the queue twice.
  leave(entry.guestId);

  for (const [otherId, other] of waiting) {
    if (otherId === entry.guestId) continue;
    if (key(other) !== key(entry)) continue;
    if (other.ws.readyState !== other.ws.OPEN) {
      // Stale socket that never got cleaned up — drop it and keep looking.
      leave(otherId);
      continue;
    }

    leave(otherId);
    log.info(`matchmaking: paired ${otherId} vs ${entry.guestId} (${key(entry)})`);
    onPair(other, entry);
    return 'paired';
  }

  entry.enqueuedAt = Date.now();
  entry.timer = setTimeout(() => {
    // Still here after the full wait — hand this player an AI opponent.
    if (waiting.get(entry.guestId) !== entry) return;
    waiting.delete(entry.guestId);
    log.info(`matchmaking: no human for ${entry.guestId} after ${WAIT_MS}ms — using AI`);
    onTimeout(entry);
  }, WAIT_MS);

  waiting.set(entry.guestId, entry);
  log.info(`matchmaking: ${entry.guestId} waiting (${key(entry)}), queue=${waiting.size}`);
  return 'waiting';
}

// Remove a player from the queue. Safe to call when they aren't in it.
// Returns the removed entry, so a caller can refund a wager it had taken.
export function leave(guestId) {
  const entry = waiting.get(guestId);
  if (!entry) return null;
  clearTimeout(entry.timer);
  waiting.delete(guestId);
  return entry;
}

// Drop whatever entry a dying socket owned. The socket is the thing index.js
// has on `close`, and it may not know the guestId if registration never
// finished.
export function leaveBySocket(ws) {
  for (const [guestId, entry] of waiting) {
    if (entry.ws === ws) return leave(guestId);
  }
  return null;
}

export function queueSize() {
  return waiting.size;
}

// Test seam: drop every waiter without firing their timeouts.
export function clearQueue() {
  for (const entry of waiting.values()) clearTimeout(entry.timer);
  waiting.clear();
}
