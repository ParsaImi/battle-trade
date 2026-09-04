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
    // The one mode that looks for a real opponent first. Gauntlet is a
    // scripted AI ladder by design, Survival and Blitz are solo, and High
    // Stakes would need a zero-sum wager rule before it can be PvP.
    pvp: true,
  },

  survival: {
    id: 'survival',
    name: 'Survival',
    tagline: 'One wrong call and it’s over',
    icon: '💀',
    solo: true,
    suddenDeath: true,
    holdAllowed: false,
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
    guessMs: 9_000,
    revealMs: 2_400,
    resultsMs: 2_400,
    affectsStreak: true,
    clearBonus: 1200,
    stageBonus: 200,
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
      wager: !!m.wager,
      wagerOptions: m.wagerOptions ?? null,
    };
  });
}
