// Identity for the AI opponent, owned by the server.
//
// This used to live in the client (`client/src/components/bot.js`), which meant
// the name and avatar were re-rolled on every refresh — the opponent changed
// face mid-match. The server now picks once, when the match is created, so the
// identity is stable and both sides of a match agree on it.
//
// Honesty note (see HANDOFF §11): the AI is presented as an ordinary trader —
// a name and one of the regular avatars — but it is never *claimed* to be a
// person. Every opponent carries an `isBot` flag to the client, and only real
// human opponents get the "LIVE" badge in the UI. Nothing here fabricates a
// human being.

import { FREE_AVATARS, AVATAR_IDS } from './gameData.js';

const NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie',
  'Quinn', 'Avery', 'Rowan', 'Skyler', 'Reese', 'Emerson', 'Finley', 'Harper',
];

// Weight the free avatars a little so the AI mostly looks like a new player
// rather than someone who has bought every cosmetic in the shop.
const AVATAR_POOL = [...FREE_AVATARS, ...FREE_AVATARS, ...AVATAR_IDS];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function makeBotOpponent() {
  return {
    guestId: null,
    nickname: pick(NAMES),
    avatar: pick(AVATAR_POOL),
    title: null,
    level: 1 + Math.floor(Math.random() * 8),
    isBot: true,
  };
}

// Trimmed public profile for a real player, used as the opponent card the
// other side of a PvP match sees. Deliberately excludes coins, stats and
// inventory — an opponent has no business seeing those.
export function opponentFromProfile(profile) {
  if (!profile) return makeBotOpponent();
  return {
    guestId: profile.guestId,
    nickname: profile.nickname,
    avatar: profile.avatar,
    title: profile.title ?? null,
    level: profile.level ?? 1,
    isBot: false,
  };
}
