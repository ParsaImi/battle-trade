// Display mirror of server/src/gameModes.js. The server also sends the live
// list on every lobby update; this is the fallback so the hub renders
// instantly before the first socket message lands.
export const MODE_LIST = [
  {
    id: 'classic',
    name: 'Classic 1v1',
    tagline: 'Best of 3, win by 2',
    icon: '⚔️',
    blurb: 'Head-to-head against a rival. First to lead by two takes it.',
    solo: false,
    wager: false,
  },
  {
    id: 'survival',
    name: 'Survival',
    tagline: 'One wrong call and it’s over',
    icon: '💀',
    blurb: 'No opponent, no safety net. Every correct call pays more than the last.',
    solo: true,
    wager: false,
  },
  {
    id: 'blitz',
    name: 'Blitz',
    tagline: '60 seconds. Call as many as you can',
    icon: '⚡',
    blurb: 'Four seconds a round against the clock. Net correct calls is your score.',
    solo: true,
    wager: false,
  },
  {
    id: 'stakes',
    name: 'High Stakes',
    tagline: 'Wager coins. Double or nothing',
    icon: '🎰',
    blurb: 'Put coins on the line against a sharper rival. Win doubles it.',
    solo: false,
    wager: true,
    wagerOptions: [100, 250, 500, 1000],
  },
  {
    id: 'gauntlet',
    name: 'Gauntlet',
    tagline: 'Beat 3 rivals, each tougher',
    icon: '🏆',
    blurb: 'Rookie, Pro, Legend. Lose once and the run is over.',
    solo: false,
    wager: false,
  },
];

export const MODE_BY_ID = Object.fromEntries(MODE_LIST.map((m) => [m.id, m]));
