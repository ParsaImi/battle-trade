// Catalog data for the shop, daily quests, and achievements. The server is
// the authority on prices/requirements; the client keeps a display-only copy
// of the labels and emoji.

// The three starters are free and always owned. Everything else is a coin
// sink — the only thing coins are actually for.
export const AVATAR_CATALOG = [
  { id: 'nomad', name: 'Nomad', price: 0 },
  { id: 'reaper', name: 'Reaper', price: 0 },
  { id: 'coder', name: 'Coder', price: 0 },
  { id: 'trader', name: 'Trader', price: 300 },
  { id: 'punk', name: 'Punk', price: 600 },
  { id: 'ghost', name: 'Ghost', price: 1000 },
  { id: 'visor', name: 'Visor', price: 1500 },
  { id: 'king', name: 'King', price: 2500 },
  { id: 'void', name: 'Void', price: 5000 },
];

// Old emoji-era ids, kept so saved players migrate onto the new art
// instead of losing their avatar (and anything they paid for).
export const LEGACY_AVATAR_ALIASES = {
  bull: 'nomad',
  bear: 'reaper',
  shark: 'coder',
  wolf: 'trader',
  whale: 'punk',
  rocket: 'ghost',
  diamond: 'visor',
  crown: 'king',
  dragon: 'void',
};

export const FREE_AVATARS = AVATAR_CATALOG.filter((a) => a.price === 0).map((a) => a.id);
export const AVATAR_IDS = AVATAR_CATALOG.map((a) => a.id);

export function avatarPrice(id) {
  return AVATAR_CATALOG.find((a) => a.id === id)?.price ?? null;
}

// Daily quests. Three are drawn per day from this pool, chosen by a
// day-seeded shuffle so everyone gets the same set and it stays stable
// across reloads within the day.

// Titles shown next to a player's name. Two starters are free; the rest are
// priced by how much of a boast the name is, so "Legend" costs real grinding
// and "Paper Hands" is free for a reason.
//
// The title's NAME is its id — that is what already sits in every save file,
// and changing it would orphan the titles players are wearing today.
export const TITLE_CATALOG = [
  { name: 'Rookie', price: 0 },
  { name: 'Paper Hands', price: 0 },
  { name: 'Lucky Bastard', price: 250 },
  { name: 'The Sniper', price: 500 },
  { name: 'Diamond Hands', price: 750 },
  { name: 'Market Maker', price: 1000 },
  { name: 'The Whale', price: 1500 },
  { name: 'Risk Taker', price: 2000 },
  { name: 'Chart Wizard', price: 3000 },
  { name: 'The Oracle', price: 5000 },
  { name: 'Kingmaker', price: 7500 },
  { name: 'Legend', price: 10000 },
];

export const TITLE_NAMES = TITLE_CATALOG.map((t) => t.name);
export const FREE_TITLES = TITLE_CATALOG.filter((t) => t.price === 0).map((t) => t.name);

export function titlePrice(name) {
  const t = TITLE_CATALOG.find((x) => x.name === name);
  return t ? t.price : null;
}

export const QUEST_POOL = [
  { id: 'win3', label: 'Win 3 matches', metric: 'matchesWon', target: 3, reward: 150 },
  { id: 'play5', label: 'Play 5 matches', metric: 'matchesPlayed', target: 5, reward: 100 },
  { id: 'correct10', label: 'Make 10 correct calls', metric: 'roundsCorrect', target: 10, reward: 200 },
  { id: 'streak2', label: 'Reach a 2-win streak', metric: 'bestStreakToday', target: 2, reward: 150 },
  { id: 'rounds20', label: 'Play 20 rounds', metric: 'roundsPlayed', target: 20, reward: 120 },
  { id: 'hold3', label: 'Use Hold 3 times', metric: 'roundsHeld', target: 3, reward: 80 },
  { id: 'win1', label: 'Win a match', metric: 'matchesWon', target: 1, reward: 60 },
  { id: 'correct5', label: 'Make 5 correct calls', metric: 'roundsCorrect', target: 5, reward: 90 },
];

const QUESTS_PER_DAY = 3;

// Deterministic per-day pick so a reload doesn't reroll the player's quests.
export function questsForDay(dayKey) {
  let seed = 0;
  for (let i = 0; i < dayKey.length; i++) seed = (seed * 31 + dayKey.charCodeAt(i)) >>> 0;

  const pool = [...QUEST_POOL];
  const picked = [];
  for (let i = 0; i < QUESTS_PER_DAY && pool.length > 0; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const idx = seed % pool.length;
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

// Lifetime achievements. `metric` reads from the guest's lifetime stats.
export const ACHIEVEMENTS = [
  { id: 'first_win', label: 'First Blood', desc: 'Win your first match', icon: '🩸', metric: 'matchesWon', target: 1 },
  { id: 'streak3', label: 'Hot Streak', desc: 'Win 3 matches in a row', icon: '⚡', metric: 'bestStreak', target: 3 },
  { id: 'streak5', label: 'Unstoppable', desc: 'Win 5 matches in a row', icon: '🔥', metric: 'bestStreak', target: 5 },
  { id: 'streak10', label: 'Legendary', desc: 'Win 10 matches in a row', icon: '🏆', metric: 'bestStreak', target: 10 },
  { id: 'matches25', label: 'Regular', desc: 'Play 25 matches', icon: '📈', metric: 'matchesPlayed', target: 25 },
  { id: 'matches100', label: 'Veteran', desc: 'Play 100 matches', icon: '🎖️', metric: 'matchesPlayed', target: 100 },
  { id: 'correct50', label: 'Sharpshooter', desc: 'Make 50 correct calls', icon: '🎯', metric: 'roundsCorrect', target: 50 },
  { id: 'hold10', label: 'Patient Hands', desc: 'Use Hold 10 times', icon: '✋', metric: 'roundsHeld', target: 10 },
  { id: 'coins1k', label: 'High Roller', desc: 'Earn 1,000 coins total', icon: '💰', metric: 'lifetimeCoins', target: 1000 },
  { id: 'coins5k', label: 'Whale Status', desc: 'Earn 5,000 coins total', icon: '🐋', metric: 'lifetimeCoins', target: 5000 },
];

// XP curve: each level costs a bit more than the last.
export function levelFromXp(xp) {
  let level = 1;
  let remaining = xp ?? 0;
  let need = 100;
  while (remaining >= need && level < 999) {
    remaining -= need;
    level += 1;
    need = Math.floor(need * 1.15);
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: need };
}
