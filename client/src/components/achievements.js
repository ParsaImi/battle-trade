// Display-only mirror of server/src/gameData.js ACHIEVEMENTS.
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
