// Real historical candles for the guessing chart.
//
// The game used to invent a random walk. It now replays real windows of past
// price action: pick an instrument, pick a random point in its history, show 28
// candles and hide the next 12. The outcome is already settled, so a round can
// resolve in ten seconds instead of waiting on a live market.
//
// Rules this file exists to enforce:
//   * The CLIENT never talks to the exchange. Only this server does, so a
//     player's location or network never matters and nothing can be tampered
//     with in the browser.
//   * Which instrument and which date a window came from is NOT public until
//     the round is over — otherwise a player could just look the answer up.
//   * If the feed is unreachable the game must keep working. Every call falls
//     back to the synthetic generator rather than failing a match.

import { log } from './logger.js';

const API = 'https://api.binance.com/api/v3/klines';

// Liquid, long-lived pairs with deep history and recognisable price action.
const INSTRUMENTS = [
  { symbol: 'BTCUSDT', label: 'BTC / USDT' },
  { symbol: 'ETHUSDT', label: 'ETH / USDT' },
  { symbol: 'SOLUSDT', label: 'SOL / USDT' },
  { symbol: 'BNBUSDT', label: 'BNB / USDT' },
  { symbol: 'XRPUSDT', label: 'XRP / USDT' },
  { symbol: 'ADAUSDT', label: 'ADA / USDT' },
];

const INTERVALS = [
  { id: '15m', label: '15m', ms: 15 * 60_000 },
  { id: '1h', label: '1H', ms: 60 * 60_000 },
  { id: '4h', label: '4H', ms: 4 * 60 * 60_000 },
];

const BATCH = 1000;             // candles per fetch (Binance's max for one call)
const POOL_TARGET = 8;          // batches kept in memory
const REFRESH_MS = 20 * 60_000; // swap one batch out on this cadence
const FETCH_TIMEOUT_MS = 8_000;
// Binance's own history starts in 2017; stay well inside it.
const HISTORY_FROM = Date.UTC(2019, 0, 1);

// { instrument, interval, candles: [...] }
const pool = [];
let refreshTimer = null;
let inFlight = false;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const round2 = (n) => Math.round(n * 100) / 100;

// Prices span BTC at 80,000 down to ADA at 0.30, so a fixed 2dp would flatten
// the cheap pairs into a straight line. Scale precision to the magnitude.
function precisionFor(price) {
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  if (price >= 1) return 4;
  return 6;
}

function roundTo(n, dp) {
  return Number(n.toFixed(dp));
}

async function fetchBatch(instrument, interval, startTime) {
  const url = `${API}?symbol=${instrument.symbol}&interval=${interval.id}&startTime=${startTime}&limit=${BATCH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length < 200) throw new Error(`only ${raw?.length ?? 0} candles`);

    // [ openTime, open, high, low, close, volume, ... ]
    const candles = raw.map((k) => ({
      t: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
    // A malformed row would poison every window cut from this batch.
    if (candles.some((c) => !Number.isFinite(c.open) || !Number.isFinite(c.close) || c.close <= 0)) {
      throw new Error('batch contains non-numeric prices');
    }
    return { instrument, interval, candles };
  } finally {
    clearTimeout(timer);
  }
}

// A random start far enough back that the batch is fully in the past.
function randomStart(interval) {
  const span = BATCH * interval.ms;
  const latest = Date.now() - span - 7 * 24 * 60 * 60_000;
  return HISTORY_FROM + Math.random() * (latest - HISTORY_FROM);
}

async function loadOne() {
  const instrument = pick(INSTRUMENTS);
  const interval = pick(INTERVALS);
  const batch = await fetchBatch(instrument, interval, Math.floor(randomStart(interval)));
  return batch;
}

// Tops the pool up in the background. Never throws: a failed fetch just means
// the pool stays as it is and callers fall back to the synthetic generator.
async function topUp(count) {
  if (inFlight) return;
  inFlight = true;
  try {
    for (let i = 0; i < count; i++) {
      try {
        const batch = await loadOne();
        pool.push(batch);
        while (pool.length > POOL_TARGET) pool.shift();
        log.info(
          `market data: loaded ${batch.candles.length} ${batch.interval.id} candles of ` +
            `${batch.instrument.symbol} from ${new Date(batch.candles[0].t).toISOString().slice(0, 10)} ` +
            `(pool ${pool.length}/${POOL_TARGET})`,
        );
      } catch (err) {
        log.warn(`market data: fetch failed — ${err.message}`);
        break; // don't hammer a feed that is refusing us
      }
    }
  } finally {
    inFlight = false;
  }
}

// Warm the pool and keep it fresh. Safe to call more than once.
export function start() {
  if (refreshTimer) return;
  topUp(POOL_TARGET);
  refreshTimer = setInterval(() => topUp(1), REFRESH_MS);
  refreshTimer.unref?.();
}

export function stop() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

export function poolSize() {
  return pool.length;
}

// A window is unplayable if the answer is a coin-flip on a dead-flat stretch,
// or if the split candle and the final candle close at exactly the same price
// (which the game scores as 'flat' — nobody can win that round).
function isPlayable(slice, visibleCount) {
  const splitClose = slice[visibleCount - 1].close;
  const finalClose = slice[slice.length - 1].close;
  if (finalClose === splitClose) return false;

  // Reject stretches with essentially no movement: the reveal should be
  // readable, not a flat line that resolves on the fourth decimal.
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const span = Math.max(...highs) - Math.min(...lows);
  const mid = (Math.max(...highs) + Math.min(...lows)) / 2;
  if (mid <= 0) return false;
  return span / mid > 0.004; // at least ~0.4% range across the window
}

/**
 * A real slice of market history, or null when none is available.
 *
 * `meta` identifies the instrument and the date. It is deliberately returned
 * separately from the candles so the caller can withhold it until the round is
 * over — publishing it during the guess phase would hand players the answer.
 */
export function getWindow(count, visibleCount) {
  if (pool.length === 0) return null;

  for (let attempt = 0; attempt < 25; attempt++) {
    const batch = pool[Math.floor(Math.random() * pool.length)];
    if (batch.candles.length < count + 1) continue;

    const offset = Math.floor(Math.random() * (batch.candles.length - count));
    const slice = batch.candles.slice(offset, offset + count);
    if (!isPlayable(slice, visibleCount)) continue;

    const dp = precisionFor(slice[slice.length - 1].close);
    return {
      candles: slice.map((c) => ({
        open: roundTo(c.open, dp),
        high: roundTo(c.high, dp),
        low: roundTo(c.low, dp),
        close: roundTo(c.close, dp),
      })),
      meta: {
        real: true,
        label: batch.instrument.label,
        symbol: batch.instrument.symbol,
        interval: batch.interval.label,
        // Date only — the exact minute would make the window trivial to find.
        date: new Date(slice[0].t).toISOString().slice(0, 10),
      },
    };
  }
  return null;
}
