// Display mirror of server/src/gameData.js. Avatars are image files, not
// emoji — drop a replacement at public/avatars/<id>.svg (or .png, updating
// `src` here) and it is picked up automatically.
export const AVATAR_CATALOG = [
  { id: 'nomad', name: 'Nomad', src: '/avatars/nomad.svg', price: 0 },
  { id: 'reaper', name: 'Reaper', src: '/avatars/reaper.svg', price: 0 },
  { id: 'coder', name: 'Coder', src: '/avatars/coder.svg', price: 0 },
  { id: 'trader', name: 'Trader', src: '/avatars/trader.svg', price: 300 },
  { id: 'punk', name: 'Punk', src: '/avatars/punk.svg', price: 600 },
  { id: 'ghost', name: 'Ghost', src: '/avatars/ghost.svg', price: 1000 },
  { id: 'visor', name: 'Visor', src: '/avatars/visor.svg', price: 1500 },
  { id: 'king', name: 'King', src: '/avatars/king.svg', price: 2500 },
  { id: 'void', name: 'Void', src: '/avatars/void.svg', price: 5000 },
];

export const AVATAR_BY_ID = Object.fromEntries(AVATAR_CATALOG.map((a) => [a.id, a]));

// The starter three — what the inline lobby picker offers by default.
export const AVATAR_LIST = AVATAR_CATALOG.filter((a) => a.price === 0).map((a) => a.id);

export const DEFAULT_AVATAR = 'nomad';

// Players created before the emoji→image switch still carry old ids; map
// them onto the closest new avatar so nothing renders blank.
const LEGACY_ALIASES = {
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

export function avatarSrc(id) {
  const resolved = AVATAR_BY_ID[id] ?? AVATAR_BY_ID[LEGACY_ALIASES[id]] ?? AVATAR_BY_ID[DEFAULT_AVATAR];
  return resolved.src;
}

export function avatarName(id) {
  const resolved = AVATAR_BY_ID[id] ?? AVATAR_BY_ID[LEGACY_ALIASES[id]] ?? AVATAR_BY_ID[DEFAULT_AVATAR];
  return resolved.name;
}
