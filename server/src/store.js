// Guest identities and coin balances. No accounts, no passwords — a guest is
// just a random id the client keeps in localStorage plus a chosen nickname.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from './logger.js';

import {
  ACHIEVEMENTS,
  AVATAR_IDS,
  FREE_AVATARS,
  LEGACY_AVATAR_ALIASES,
  avatarPrice,
  levelFromXp,
  questsForDay,
} from './gameData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Where the save file lives. Defaults to the package root, so local dev and
// the test suite are unchanged; containers point DATA_DIR at a mounted volume
// so player data survives a redeploy.
//
// This must be a DIRECTORY, never a path to the file itself: saveNow() renames
// a temp file over data.json, and rename() fails with EBUSY across a
// bind-mounted single file.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const TMP_FILE = `${DATA_FILE}.tmp`;
const BAK_FILE = `${DATA_FILE}.bak`;
const SAVE_DEBOUNCE_MS = 400;

let guests = new Map();

// Reads the live file, falling back to the last known-good backup if the
// main one is missing or corrupt (e.g. the process died mid-write before
// saves were made atomic).
export function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    log.error(`could not create data directory ${DATA_DIR}`, err);
  }
  for (const file of [DATA_FILE, BAK_FILE]) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') log.error(`could not read ${path.basename(file)}`, err);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      guests = new Map(Object.entries(parsed));
      if (file === BAK_FILE) log.warn('main save was unusable — recovered from backup');
      log.info(`loaded ${guests.size} players`);
      return;
    } catch (err) {
      log.error(`corrupt save in ${path.basename(file)}`, err);
    }
  }
  guests = new Map();
  log.info('starting with an empty player store');
}

let saveTimer = null;

// Atomic: serialise, write to a temp file, keep the previous file as a
// backup, then rename over the real one. A crash can never leave a
// half-written data.json behind.
export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  let json;
  try {
    json = JSON.stringify(Object.fromEntries(guests), null, 2);
  } catch (err) {
    log.error('could not serialise player store — skipping save', err);
    return false;
  }
  try {
    fs.writeFileSync(TMP_FILE, json);
    try {
      fs.copyFileSync(DATA_FILE, BAK_FILE);
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('could not refresh backup', err.message);
    }
    fs.renameSync(TMP_FILE, DATA_FILE);
    return true;
  } catch (err) {
    log.error('save failed', err);
    return false;
  }
}

export function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

export function playerCount() {
  return guests.size;
}

function currentWeekKey() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

function currentDayKey() {
  return new Date().toISOString().slice(0, 10);
}

const TITLES = ['The Whale', 'The Sniper', 'Diamond Hands', 'Market Maker', 'Lucky Bastard', 'Paper Hands'];

const EMPTY_STATS = {
  matchesPlayed: 0,
  matchesWon: 0,
  matchesLost: 0,
  matchesDrawn: 0,
  roundsPlayed: 0,
  roundsCorrect: 0,
  roundsWrong: 0,
  roundsHeld: 0,
  bestStreak: 0,
  lifetimeCoins: 0,
};

// Backfills fields added after a save file was first written, so players
// created by an older build keep working instead of hitting undefined.
function ensureShape(g) {
  if (!g.stats) g.stats = { ...EMPTY_STATS };
  for (const [k, v] of Object.entries(EMPTY_STATS)) {
    if (typeof g.stats[k] !== 'number') g.stats[k] = v;
  }
  if (typeof g.xp !== 'number') g.xp = 0;
  if (!Array.isArray(g.unlockedAvatars)) g.unlockedAvatars = [...FREE_AVATARS];
  // Migrate emoji-era avatar ids onto the new image set.
  g.unlockedAvatars = [...new Set(g.unlockedAvatars.map((id) => LEGACY_AVATAR_ALIASES[id] ?? id))].filter((id) =>
    AVATAR_IDS.includes(id),
  );
  if (LEGACY_AVATAR_ALIASES[g.avatar]) g.avatar = LEGACY_AVATAR_ALIASES[g.avatar];
  if (!AVATAR_IDS.includes(g.avatar)) g.avatar = FREE_AVATARS[0];
  for (const id of FREE_AVATARS) {
    if (!g.unlockedAvatars.includes(id)) g.unlockedAvatars.push(id);
  }
  if (!Array.isArray(g.achievements)) g.achievements = [];
  if (typeof g.title === 'undefined') g.title = null;
  if (!g.bests || typeof g.bests !== 'object') g.bests = {};
  if (!g.modeStats || typeof g.modeStats !== 'object') g.modeStats = {};
  return g;
}

// Daily quest state resets on a new UTC day.
function ensureQuests(g) {
  const today = currentDayKey();
  if (!g.questState || g.questState.dayKey !== today) {
    g.questState = {
      dayKey: today,
      progress: { matchesWon: 0, matchesPlayed: 0, roundsCorrect: 0, roundsPlayed: 0, roundsHeld: 0, bestStreakToday: 0 },
      claimed: [],
    };
  }
  return g.questState;
}

export function getOrCreateGuest(guestId, nickname) {
  let g = guests.get(guestId);
  const weekKey = currentWeekKey();
  if (!g) {
    g = {
      nickname: nickname || `Trader${guestId.slice(0, 4)}`,
      avatar: FREE_AVATARS[0],
      title: null,
      coins: 0,
      weeklyCoins: 0,
      weekKey,
      streak: 0,
      lastBonusDay: null,
    };
    guests.set(guestId, g);
  }
  ensureShape(g);
  ensureQuests(g);
  if (nickname && nickname !== g.nickname) {
    g.nickname = nickname;
  }
  if (g.weekKey !== weekKey) {
    g.weekKey = weekKey;
    g.weeklyCoins = 0;
  }
  return g;
}

export function setNickname(guestId, nickname) {
  const g = guests.get(guestId);
  const trimmed = typeof nickname === 'string' ? nickname.trim().slice(0, 20) : '';
  if (!g || !trimmed) return null;
  g.nickname = trimmed;
  scheduleSave();
  return g.nickname;
}

export function setAvatar(guestId, avatar) {
  const g = guests.get(guestId);
  if (!g || !AVATAR_IDS.includes(avatar)) return null;
  ensureShape(g);
  // Only avatars the player actually owns can be equipped.
  if (!g.unlockedAvatars.includes(avatar)) return null;
  g.avatar = avatar;
  scheduleSave();
  return g.avatar;
}

// Returns { ok, reason?, coins?, unlockedAvatars? }
export function buyAvatar(guestId, avatar) {
  const g = guests.get(guestId);
  if (!g) return { ok: false, reason: 'no_player' };
  ensureShape(g);

  const price = avatarPrice(avatar);
  if (price === null) return { ok: false, reason: 'unknown_avatar' };
  if (g.unlockedAvatars.includes(avatar)) return { ok: false, reason: 'already_owned' };
  if (g.coins < price) return { ok: false, reason: 'not_enough_coins' };

  g.coins -= price;
  g.unlockedAvatars.push(avatar);
  g.avatar = avatar; // equip what you just bought
  scheduleSave();
  return { ok: true, coins: g.coins, unlockedAvatars: [...g.unlockedAvatars], avatar: g.avatar };
}

export function setTitle(guestId, title) {
  const g = guests.get(guestId);
  if (!g || !TITLES.includes(title)) return null;
  g.title = title;
  scheduleSave();
  return g.title;
}

const DAILY_BONUS = 50;

export function applyDailyBonusIfNeeded(guestId) {
  const g = guests.get(guestId);
  if (!g) return 0;
  const today = currentDayKey();
  if (g.lastBonusDay === today) return 0;
  g.lastBonusDay = today;
  g.coins += DAILY_BONUS;
  g.weeklyCoins += DAILY_BONUS;
  ensureShape(g);
  g.stats.lifetimeCoins += DAILY_BONUS;
  scheduleSave();
  return DAILY_BONUS;
}

const WIN_PAYOUT_MIN = 80;
const WIN_PAYOUT_MAX = 120;
const DRAW_PAYOUT = 25;
const MAX_STREAK_MULTIPLIER = 5;

const XP_PER_MATCH = { win: 50, draw: 25, loss: 15 };

// Deducts a High Stakes wager up front. Returns false if they can't cover it.
export function takeWager(guestId, amount) {
  const g = guests.get(guestId);
  if (!g) return false;
  ensureShape(g);
  const amt = Number(amount) || 0;
  if (amt <= 0 || g.coins < amt) return false;
  g.coins -= amt;
  scheduleSave();
  return true;
}

// Puts a wager back if the match it was taken for never actually started.
export function refundWager(guestId, amount) {
  const g = guests.get(guestId);
  if (!g) return false;
  const amt = Number(amount) || 0;
  if (amt <= 0) return false;
  g.coins += amt;
  scheduleSave();
  return true;
}

// outcome: 'win' | 'draw' | 'loss'. Streak tracks consecutive match wins.
// opts.payoutOverride  - solo modes compute their own coin payout
// opts.wager           - High Stakes: already deducted, win pays 2x, draw refunds
// opts.affectsStreak   - solo modes don't touch the 1v1 win streak
export function applyMatchResult(guestId, outcome, opts = {}) {
  const g = guests.get(guestId);
  if (!g) return { delta: 0, streak: 0 };
  ensureShape(g);
  const quests = ensureQuests(g);

  const { mode = 'classic', payoutOverride = null, wager = 0, affectsStreak = true, score = 0 } = opts;
  const levelBefore = levelFromXp(g.xp).level;
  let delta = 0;
  let multiplier = 1;

  if (affectsStreak) {
    if (outcome === 'win') g.streak += 1;
    else g.streak = 0;
  }

  if (payoutOverride !== null) {
    // Survival / Blitz / Gauntlet bring their own payout maths.
    delta = payoutOverride;
  } else if (wager > 0) {
    // Wager was already taken at match start: win returns double, draw refunds.
    delta = outcome === 'win' ? wager * 2 : outcome === 'draw' ? wager : 0;
  } else if (outcome === 'draw') {
    delta = DRAW_PAYOUT;
  } else if (outcome === 'win') {
    // g.streak is the true, uncapped consecutive-win count (shown as a
    // bragging-rights stat); only the payout multiplier is capped.
    multiplier = Math.min(g.streak, MAX_STREAK_MULTIPLIER) || 1;
    const base = Math.floor(WIN_PAYOUT_MIN + Math.random() * (WIN_PAYOUT_MAX - WIN_PAYOUT_MIN));
    delta = base * multiplier;
  }

  if (delta > 0) {
    g.coins += delta;
    g.weeklyCoins += delta;
  }

  // Per-mode personal bests (Survival rounds survived, Blitz net points).
  if (!g.bests) g.bests = {};
  let newBest = false;
  if ((mode === 'survival' || mode === 'blitz') && score > (g.bests[mode] ?? 0)) {
    g.bests[mode] = score;
    newBest = true;
  }

  if (!g.modeStats) g.modeStats = {};
  if (!g.modeStats[mode]) g.modeStats[mode] = { played: 0, won: 0 };
  g.modeStats[mode].played += 1;
  if (outcome === 'win') g.modeStats[mode].won += 1;

  // Lifetime stats
  g.stats.lifetimeCoins += delta;
  g.stats.matchesPlayed += 1;
  if (outcome === 'win') g.stats.matchesWon += 1;
  if (outcome === 'loss') g.stats.matchesLost += 1;
  if (outcome === 'draw') g.stats.matchesDrawn += 1;
  g.stats.bestStreak = Math.max(g.stats.bestStreak, g.streak);

  // Daily quest progress
  quests.progress.matchesPlayed += 1;
  if (outcome === 'win') quests.progress.matchesWon += 1;
  quests.progress.bestStreakToday = Math.max(quests.progress.bestStreakToday, g.streak);

  g.xp += XP_PER_MATCH[outcome] ?? 0;
  const levelAfter = levelFromXp(g.xp).level;
  const newAchievements = checkAchievements(g);

  scheduleSave();
  return {
    delta,
    streak: g.streak,
    multiplier,
    leveledUpTo: levelAfter > levelBefore ? levelAfter : null,
    newAchievements,
    newBest,
  };
}

// Called once per resolved round so per-round quests/stats stay accurate.
// playerDelta: +1 correct, -1 wrong, 0 held or timed out.
export function recordRound(guestId, { playerDelta, held }) {
  const g = guests.get(guestId);
  if (!g) return;
  ensureShape(g);
  const quests = ensureQuests(g);

  g.stats.roundsPlayed += 1;
  quests.progress.roundsPlayed += 1;

  if (playerDelta > 0) {
    g.stats.roundsCorrect += 1;
    quests.progress.roundsCorrect += 1;
    g.xp += 5;
  } else if (playerDelta < 0) {
    g.stats.roundsWrong += 1;
  } else if (held) {
    g.stats.roundsHeld += 1;
    quests.progress.roundsHeld += 1;
  }

  checkAchievements(g);
  scheduleSave();
}

// Unlocks any newly-earned achievements and returns just the new ones.
function checkAchievements(g) {
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (g.achievements.includes(a.id)) continue;
    const value = g.stats[a.metric] ?? 0;
    if (value >= a.target) {
      g.achievements.push(a.id);
      unlocked.push({ id: a.id, label: a.label, icon: a.icon, desc: a.desc });
    }
  }
  return unlocked;
}

// Builds the player-facing quest list with live progress + claim state.
export function getQuests(guestId) {
  const g = guests.get(guestId);
  if (!g) return [];
  ensureShape(g);
  const quests = ensureQuests(g);
  return questsForDay(quests.dayKey).map((q) => {
    const progress = Math.min(quests.progress[q.metric] ?? 0, q.target);
    return {
      id: q.id,
      label: q.label,
      target: q.target,
      reward: q.reward,
      progress,
      complete: progress >= q.target,
      claimed: quests.claimed.includes(q.id),
    };
  });
}

export function claimQuest(guestId, questId) {
  const g = guests.get(guestId);
  if (!g) return { ok: false, reason: 'no_player' };
  ensureShape(g);
  const quests = ensureQuests(g);

  const quest = questsForDay(quests.dayKey).find((q) => q.id === questId);
  if (!quest) return { ok: false, reason: 'unknown_quest' };
  if (quests.claimed.includes(questId)) return { ok: false, reason: 'already_claimed' };

  const progress = quests.progress[quest.metric] ?? 0;
  if (progress < quest.target) return { ok: false, reason: 'not_complete' };

  quests.claimed.push(questId);
  g.coins += quest.reward;
  g.weeklyCoins += quest.reward;
  g.stats.lifetimeCoins += quest.reward;
  checkAchievements(g);
  scheduleSave();
  return { ok: true, reward: quest.reward, coins: g.coins };
}

export function getGuestPublic(guestId) {
  const g = guests.get(guestId);
  if (!g) return null;
  ensureShape(g);
  const { level, xpIntoLevel, xpForNextLevel } = levelFromXp(g.xp);
  return {
    guestId,
    nickname: g.nickname,
    avatar: g.avatar,
    title: g.title,
    coins: g.coins,
    weeklyCoins: g.weeklyCoins,
    streak: g.streak,
    level,
    xpIntoLevel,
    xpForNextLevel,
    stats: { ...g.stats },
    bests: { ...g.bests },
    modeStats: { ...g.modeStats },
    unlockedAvatars: [...g.unlockedAvatars],
    achievements: [...g.achievements],
  };
}

export function getWeeklyLeaderboard(limit = 10) {
  const weekKey = currentWeekKey();
  return [...guests.entries()]
    .map(([guestId, g]) => ({
      guestId,
      nickname: g.nickname,
      avatar: g.avatar,
      title: g.title ?? null,
      level: levelFromXp(g.xp ?? 0).level,
      weeklyCoins: g.weekKey === weekKey ? g.weeklyCoins : 0,
    }))
    .sort((a, b) => b.weeklyCoins - a.weeklyCoins)
    .slice(0, limit);
}
