import { useRef } from 'react';
import './CandlestickChart.css';

const WIDTH = 760;
const HEIGHT = 320;
const PADDING = 16;

export default function CandlestickChart({ candles, roundId, direction }) {
  // Freezes the candle count seen at the start of a round (the "guess phase"
  // slice) so later, larger candle arrays for the same round can be diffed
  // against it to animate only the newly-revealed candles.
  const visibleCountRef = useRef(0);
  const roundIdRef = useRef(null);

  if (roundIdRef.current !== roundId) {
    roundIdRef.current = roundId;
    visibleCountRef.current = candles.length;
  }

  const revealBoundary = visibleCountRef.current;

  if (!candles || candles.length === 0) {
    return <div className="chart-empty">Waiting for the next chart…</div>;
  }

  const allValues = candles.flatMap((c) => [c.high, c.low]);
  const max = Math.max(...allValues);
  const min = Math.min(...allValues);
  const range = Math.max(max - min, 0.01);

  const totalSlots = Math.max(candles.length, 40);
  const slotWidth = (WIDTH - PADDING * 2) / totalSlots;
  const bodyWidth = Math.max(slotWidth * 0.55, 2);

  const yFor = (price) => HEIGHT - PADDING - ((price - min) / range) * (HEIGHT - PADDING * 2);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" preserveAspectRatio="none">
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
      {direction && direction !== 'flat' && (
        <div className={`direction-banner direction-${direction}`}>
          It went {direction === 'up' ? '▲ UP' : '▼ DOWN'}
        </div>
      )}
    </div>
  );
}
