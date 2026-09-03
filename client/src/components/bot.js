// The 1v1 opponent is always the AI. It's presented as an ordinary trader
// (a name + one of the regular avatars) rather than as an obvious "bot" —
// but nothing here claims it's a real person, and it isn't.
import { AVATAR_CATALOG } from './avatars';

const NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie'];
const AVATARS = AVATAR_CATALOG.map((a) => a.id);

export function pickOpponent() {
  return {
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
  };
}
