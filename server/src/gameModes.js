// Game mode definitions. Every mode reuses the same fake-chart guessing core;
// what changes is the round structure, the clock, the opponent, and how coins
// are paid out.
//
//   solo         - no opponent panel; you play against the chart itself
//   suddenDeath  - one wrong call ends the run
//   totalTimeMs  - whole-session clock (Blitz); rounds keep coming until it runs out
//   botAccuracy  - chance the opponent calls the round correctly (0.5 = coin flip)
//   stages       - Gauntlet: a list of successively harder opponents

export const MODES = {
  classic: {
    id: 'classic',
    name: 'Classic 1v1',
    tagline: 'Best of 3, win by 2',
    icon: '⚔️',
    solo: false,
    minRounds: 3,
    winByTwo: true,
    maxRounds: 11,
    guessMs: 10_000,
    revealMs: 2_600,
    resultsMs: 2_600,
    botAccuracy: 0.5,
    affectsStreak: true,
    pvp: true,
  },

  duo: {
    id: 'duo',
    name: 'Duos 2v2',
    tagline: 'Two of you, one call each',
    icon: '🤝',
    solo: false,
    minRounds: 3,
    winByTwo: true,
    maxRounds: 11,
    guessMs: 10_000,
    revealMs: 2_600,
    resultsMs: 2_600,
    botAccuracy: 0.5,
    affectsStreak: true,
    pvp: true,
    // Four players, two a side. A round is scored per team as the sum of its
    // two calls: both right is +2, both wrong is -2, and one of each cancels
    // out to 0 — which is exactly what summing two +1/-1 calls gives you.
    teamSize: 2,
  },

  survival: {
    id: 'survival',
    name: 'Survival',
    tagline: 'One wrong call and it’s over',
    icon: '💀',
    solo: true,
    suddenDeath: true,
    holdAllowed: false,
    // Head-to-head it becomes a race on identical charts: rounds keep coming
    // until BOTH players are out, and the one who lasted longer takes it.
    pvp: true,
    maxRounds: 50,
    guessMs: 8_000,
    revealMs: 2_000,
    resultsMs: 1_400,
    affectsStreak: false,
    // Escalating payout: round N is worth BASE + N*STEP coins.
    payoutBase: 10,
    payoutStep: 5,
  },

  blitz: {
    id: 'blitz',
    name: 'Blitz',
    tagline: '60 seconds. Call as many as you can',
    icon: '⚡',
    solo: true,
    totalTimeMs: 60_000,
    maxRounds: 40,
    // Head-to-head: one shared 60-second clock, the same charts for both, and
    // the higher net score wins.
    pvp: true,
    guessMs: 4_000,
    revealMs: 1_100,
    resultsMs: 700,
    affectsStreak: false,
    payoutPerPoint: 25,
  },

  stakes: {
    id: 'stakes',
    name: 'High Stakes',
    tagline: 'Wager coins. Double or nothing',
    icon: '🎰',
    solo: false,
    minRounds: 3,
    winByTwo: true,
    maxRounds: 11,
    guessMs: 8_000,
    revealMs: 2_400,
    resultsMs: 2_400,
    botAccuracy: 0.58, // sharper opponent to justify the payout
    affectsStreak: true,
    // Against a real player this is genuinely zero-sum: both stake, and the
    // winner's 2x payout is exactly the two stakes. The queue keys on wager,
    // so a 100-coin player is never matched against a 1000-coin one.
    pvp: true,
    wager: true,
    wagerOptions: [100, 250, 500, 1000],
  },

  gauntlet: {
    id: 'gauntlet',
    name: 'Gauntlet',
    tagline: 'Beat 3 rivals, each tougher',
    icon: '🏆',
    solo: false,
    stages: [
      { name: 'Rookie', botAccuracy: 0.5 },
      { name: 'Pro', botAccuracy: 0.62 },
      { name: 'Legend', botAccuracy: 0.72 },
    ],
    roundsPerStage: 3,
    // Against a real player the stage structure holds — three stages, lead to
    // advance — but the rival is a person rather than the scripted ladder.
    pvp: true,
    guessMs: 9_000,
    revealMs: 2_400,
    resultsMs: 2_400,
    affectsStreak: true,
    clearBonus: 1200,
    stageBonus: 200,
  },

  // Not a game in its own right: it opens a private room and the players pick
  // which of the real modes to play. Match never sees this id — find_match and
  // create_room both refuse it.
  tournament: {
    id: 'tournament',
    name: 'Tournament',
    tagline: '8 players, one winner takes the pot',
    icon: '🥇',
    solo: false,
    // Every tie inside the bracket is an ordinary 1v1.
    minRounds: 3,
    winByTwo: true,
    maxRounds: 11,
    guessMs: 10_000,
    revealMs: 2_600,
    resultsMs: 2_600,
    botAccuracy: 0.5,
    affectsStreak: true,
    pvp: true,
    // Entry is 10% of what you hold; every entry goes into one pot and the
    // player who wins three ties takes it. Handled by tournament.js, not by
    // Match — this flag is what routes find_match there.
    bracket: true,
  },

  custom: {
    id: 'custom',
    name: 'Custom Room',
    tagline: 'Play a friend with a code',
    icon: '🎟️',
    room: true,
    solo: false,
  },
};

export const MODE_IDS = Object.keys(MODES);

export function getMode(id) {
  return MODES[id] ?? MODES.classic;
}

// Public, client-safe listing for the mode-select hub.
export function publicModeList() {
  return MODE_IDS.map((id) => {
    const m = MODES[id];
    return {
      id: m.id,
      name: m.name,
      tagline: m.tagline,
      icon: m.icon,
      solo: !!m.solo,
      pvp: !!m.pvp,
      room: !!m.room,
      bracket: !!m.bracket,
      teamSize: m.teamSize ?? 1,
      wager: !!m.wager,
      wagerOptions: m.wagerOptions ?? null,
    };
  });
}
