import { useRef } from 'react';
import './CandlestickChart.css';

const WIDTH = 760;
const HEIGHT = 320;
const PADDING = 16;
const GRID_LINES = 5;

// Prices run from ~0.30 (ADA) to ~80,000 (BTC), so a fixed number of decimals
// would either bury the cheap pairs in noise or round them flat.
function decimalsFor(price) {
  const abs = Math.abs(price);
  if (abs >= 100) return 2;
  if (abs >= 1) return 4;
  return 6;
}

function fmtPrice(n, dp = decimalsFor(n)) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Axis labels are cramped, so drop the long tail of decimals there.
function fmtAxis(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export default function CandlestickChart({ candles, roundId, direction, chartMeta }) {
  // Freezes the candle count seen at the start of a round (the "guess phase"
  // slice) so later, larger candle arrays for the same round can be diffed
  // against it to animate only the newly-revealed candles.
  const visibleCountRef = useRef(0);
  const roundIdRef = useRef(null);

  if (roundIdRef.current !== roundId) {
    roundIdRef.current = roundId;
    visibleCountRef.current = candles?.length ?? 0;
  }

  const revealBoundary = visibleCountRef.current;

  if (!candles || candles.length === 0) {
    return <div className="chart-empty">Waiting for the next chart…</div>;
  }

  const allValues = candles.flatMap((c) => [c.high, c.low]);
  const max = Math.max(...allValues);
  const min = Math.min(...allValues);
  const range = Math.max(max - min, 0.000001);

  const totalSlots = Math.max(candles.length, 40);
  const slotWidth = (WIDTH - PADDING * 2) / totalSlots;
  const bodyWidth = Math.max(slotWidth * 0.55, 2);

  const yFor = (price) => HEIGHT - PADDING - ((price - min) / range) * (HEIGHT - PADDING * 2);
  // The overlay sits on the same box as the SVG, so a percentage lines the two
  // up at any height — which matters because the chart is shorter on mobile.
  const pctFor = (price) => (yFor(price) / HEIGHT) * 100;

  // Evenly spaced price levels for the axis and the gridlines behind it.
  const levels = Array.from({ length: GRID_LINES }, (_, i) => min + (range * i) / (GRID_LINES - 1));

  const last = candles[candles.length - 1].close;
  const lastPct = (yFor(last) / HEIGHT) * 100;
  const first = candles[0].open;
  const changePct = ((last - first) / first) * 100;
  const dp = decimalsFor(last);

  return (
    <div className="chart-wrap">
      <div className="chart-header">
        <div className="chart-price-block">
          <span className={`chart-price ${changePct >= 0 ? 'up' : 'down'}`}>{fmtPrice(last, dp)}</span>
          <span className={`chart-change ${changePct >= 0 ? 'up' : 'down'}`}>
            {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
          </span>
        </div>
        {/* Naming the instrument mid-guess would hand over the answer, so the
            server withholds it until the round resolves. */}
        {chartMeta?.real ? (
          <div className="chart-instrument">
            <span className="chart-symbol">{chartMeta.label}</span>
            <span className="chart-tf">
              {chartMeta.interval} · {chartMeta.date}
            </span>
          </div>
        ) : (
          <div className="chart-instrument chart-instrument-hidden">
            <span className="chart-symbol">? ? ?</span>
            <span className="chart-tf">revealed after the call</span>
          </div>
        )}
      </div>

      <div className="chart-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" preserveAspectRatio="none">
          {levels.map((p, i) => (
            <line
              key={`g${i}`}
              className="grid-line"
              x1={0}
              x2={WIDTH}
              y1={yFor(p)}
              y2={yFor(p)}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Where the visible chart ended and the reveal begins. */}
          {candles.length > revealBoundary && revealBoundary > 0 && (
            <line
              className="split-line"
              x1={PADDING + revealBoundary * slotWidth}
              x2={PADDING + revealBoundary * slotWidth}
              y1={0}
              y2={HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const x = PADDING + i * slotWidth + slotWidth / 2;
            const isReveal = i >= revealBoundary && roundIdRef.current !== null;
            return (
              <g
                key={i}
                className={`candle ${up ? 'candle-up' : 'candle-down'} ${isReveal ? 'candle-reveal' : ''}`}
                style={isReveal ? { animationDelay: `${(i - revealBoundary) * 90}ms` } : undefined}
              >
                <line x1={x} x2={x} y1={yFor(c.high)} y2={yFor(c.low)} className="wick" />
                <rect
                  x={x - bodyWidth / 2}
                  y={Math.min(yFor(c.open), yFor(c.close))}
                  width={bodyWidth}
                  height={Math.max(Math.abs(yFor(c.open) - yFor(c.close)), 1.5)}
                  className="body"
                />
              </g>
            );
          })}
        </svg>

        {/* HTML, not SVG text: the chart stretches to fit, which would squash
            anything drawn inside it. */}
        <div className="chart-axis" aria-hidden="true">
          {levels.map((p, i) => {
            // The live-price pill is drawn on top of the scale, so drop any
            // gridline label it would sit on rather than stacking the two.
            if (Math.abs(pctFor(p) - lastPct) < 5) return null;
            return (
              <span key={i} className="axis-label" style={{ top: `${pctFor(p)}%` }}>
                {fmtAxis(p)}
              </span>
            );
          })}
          <span
            className={`axis-last ${changePct >= 0 ? 'up' : 'down'}`}
            style={{ top: `${pctFor(last)}%` }}
          >
            {fmtAxis(last)}
          </span>
        </div>
      </div>

      {direction && direction !== 'flat' && (
        <div className={`direction-banner direction-${direction}`}>
          It went {direction === 'up' ? '▲ UP' : '▼ DOWN'}
        </div>
      )}
    </div>
  );
}
