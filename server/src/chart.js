// Generates a fully fake candlestick series via a random walk. Nothing here
// reflects any real market — it's just numbers for the game to react to.

const CANDLE_COUNT = 40;
const VISIBLE_COUNT = 28; // shown during the guess phase; rest is the "reveal"
const START_PRICE = 100;

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function generateChart() {
  const candles = [];
  let price = START_PRICE;

  for (let i = 0; i < CANDLE_COUNT; i++) {
    const open = price;
    // small drift + noise keeps the walk from looking too smooth or too wild
    const drift = randRange(-1.2, 1.3);
    const close = Math.max(1, open + drift);
    const wickUp = randRange(0, 1.2);
    const wickDown = randRange(0, 1.2);
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(0.1, Math.min(open, close) - wickDown);

    candles.push({
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
    });

    price = close;
  }

  return candles;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function splitChart(candles) {
  return {
    visible: candles.slice(0, VISIBLE_COUNT),
    hidden: candles.slice(VISIBLE_COUNT),
  };
}

export function resolveDirection(candles) {
  const splitClose = candles[VISIBLE_COUNT - 1].close;
  const finalClose = candles[candles.length - 1].close;
  if (finalClose > splitClose) return 'up';
  if (finalClose < splitClose) return 'down';
  return 'flat';
}

export const CHART_CONSTANTS = { CANDLE_COUNT, VISIBLE_COUNT };
