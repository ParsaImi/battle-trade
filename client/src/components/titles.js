// Display mirror of the TITLE_CATALOG in server/src/gameData.js.
// The title's NAME is its id — that is what sits in every save file.
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

export const TITLES = TITLE_CATALOG.map((t) => t.name);
export const FREE_TITLES = TITLE_CATALOG.filter((t) => t.price === 0).map((t) => t.name);
