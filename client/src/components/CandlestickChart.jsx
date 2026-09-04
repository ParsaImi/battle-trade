import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './CandlestickChart.css';

const WIDTH = 760;
const HEIGHT = 320;
const PAD_TOP = 14;
const PAD_BOTTOM = 14;
const GRID_LINES = 5;

// Zoom limits, in candles on screen.
const MIN_SPAN = 12;
const MAX_SPAN = 200;
const DEFAULT_SPAN = 46;

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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function CandlestickChart({ candles, roundId, direction, chartMeta, historyCount = 0 }) {
  const total = candles?.length ?? 0;

  // The view: how many candles are on screen, and which one is at the right
  // edge. `following` keeps the right edge pinned to the newest candle, which
  // is what you want until you deliberately scroll back.
  const [span, setSpan] = useState(DEFAULT_SPAN);
  const [endIndex, setEndIndex] = useState(total - 1);
  const [following, setFollowing] = useState(true);

  const plotRef = useRef(null);
  const roundRef = useRef(null);
  const prevLenRef = useRef(0);
  // Candles that arrived with the reveal, so only those animate in.
  const revealFromRef = useRef(Infinity);

  // A new round resets the view; a longer array within the same round is the
  // reveal arriving, which should snap into sight rather than happen offscreen.
  if (roundRef.current !== roundId) {
    roundRef.current = roundId;
    prevLenRef.current = total;
    revealFromRef.current = Infinity;
  } else if (total > prevLenRef.current) {
    revealFromRef.current = prevLenRef.current;
    prevLenRef.current = total;
  }

  useEffect(() => {
    // Back to the live edge and the default zoom whenever a round starts.
    setSpan(DEFAULT_SPAN);
    setFollowing(true);
  }, [roundId]);

  useEffect(() => {
    if (following) setEndIndex(total - 1);
  }, [total, following]);

  // The reveal is the payoff; jump to it even if the player had scrolled off.
  useEffect(() => {
    if (revealFromRef.current !== Infinity) setFollowing(true);
  }, [total]);

  const effSpan = clamp(span, MIN_SPAN, Math.max(MIN_SPAN, Math.min(MAX_SPAN, total)));
  const end = clamp(endIndex, effSpan - 1, Math.max(effSpan - 1, total - 1));
  const start = Math.max(0, end - effSpan + 1);

  const view = useMemo(() => (candles ?? []).slice(start, end + 1), [candles, start, end]);

  // Pan by a number of candles, which is also what the buttons use.
  const panBy = useCallback(
    (delta) => {
      setEndIndex((prev) => {
        const cur = clamp(prev, effSpan - 1, Math.max(effSpan - 1, total - 1));
        const next = clamp(cur + delta, effSpan - 1, Math.max(effSpan - 1, total - 1));
        setFollowing(next >= total - 1);
        return next;
      });
    },
    [effSpan, total],
  );

  // Zoom around the right edge, so the newest candle stays put while the
  // window grows or shrinks behind it.
  const zoomTo = useCallback(
    (nextSpan) => {
      const s = clamp(Math.round(nextSpan), MIN_SPAN, Math.max(MIN_SPAN, Math.min(MAX_SPAN, total)));
      setSpan(s);
      setEndIndex((prev) => clamp(prev, s - 1, Math.max(s - 1, total - 1)));
    },
    [total],
  );

  const resetView = useCallback(() => {
    setSpan(DEFAULT_SPAN);
    setFollowing(true);
    setEndIndex(total - 1);
  }, [total]);

  // --- dragging and pinching ------------------------------------------------
  // Pointer events cover mouse and touch with one path. The plot sets
  // `touch-action: pan-y`, so a vertical swipe still scrolls the page while a
  // horizontal drag pans the chart.
  const gesture = useRef({ pointers: new Map(), lastX: 0, pinchDist: 0, pinchSpan: 0, moved: 0 });

  const onPointerDown = (e) => {
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g.moved = 0;
    if (g.pointers.size === 1) {
      g.lastX = e.clientX;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.pinchSpan = effSpan;
    }
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      // Fingers apart = zoom in = fewer candles on screen.
      zoomTo(g.pinchSpan * (g.pinchDist / dist));
      return;
    }

    const width = plotRef.current?.clientWidth || 1;
    const perCandle = width / effSpan;
    const dx = e.clientX - g.lastX;
    if (Math.abs(dx) < perCandle) return;
    const steps = Math.trunc(dx / perCandle);
    g.lastX -= steps * perCandle;
    g.moved += Math.abs(steps);
    // Dragging right reveals older candles, like every charting tool.
    panBy(-steps);
  };

  const endPointer = (e) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) g.pinchDist = 0;
    if (g.pointers.size === 1) g.lastX = [...g.pointers.values()][0].x;
  };

  const onWheel = (e) => {
    if (!e.deltaY) return;
    zoomTo(effSpan * (e.deltaY > 0 ? 1.15 : 1 / 1.15));
  };

  if (!candles || total === 0) {
    return <div className="chart-empty">Waiting for the next chart…</div>;
  }

  // Scale to what is ON SCREEN, so zooming in actually opens the price range
  // up instead of leaving everything squashed against the full-range extremes.
  const highs = view.map((c) => c.high);
  const lows = view.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = Math.max(max - min, Math.abs(max) * 1e-6, 1e-6);

  const slotWidth = WIDTH / effSpan;
  const bodyWidth = Math.max(slotWidth * 0.6, 1);
  const yFor = (price) => HEIGHT - PAD_BOTTOM - ((price - min) / range) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const pctFor = (price) => (yFor(price) / HEIGHT) * 100;

  const levels = Array.from({ length: GRID_LINES }, (_, i) => min + (range * i) / (GRID_LINES - 1));

  const last = candles[total - 1].close;
  const first = candles[historyCount]?.open ?? candles[0].open;
  const changePct = ((last - first) / first) * 100;
  const dp = decimalsFor(last);
  const lastPct = pctFor(last);
  const lastOnScreen = total - 1 >= start && total - 1 <= end;

  // Where the guess phase ended. Only meaningful once the reveal has arrived.
  const splitAt = historyCount + 28;
  const splitOnScreen = revealFromRef.current !== Infinity && splitAt > start && splitAt <= end + 1;

  const atOldest = start <= 0;
  const atNewest = end >= total - 1;

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

      <div
        className="chart-plot"
        ref={plotRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onWheel={onWheel}
      >
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

          {splitOnScreen && (
            <line
              className="split-line"
              x1={(splitAt - start) * slotWidth}
              x2={(splitAt - start) * slotWidth}
              y1={0}
              y2={HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {view.map((c, i) => {
            const abs = start + i;
            const up = c.close >= c.open;
            const x = i * slotWidth + slotWidth / 2;
            const isReveal = abs >= revealFromRef.current;
            return (
              <g
                key={abs}
                className={`candle ${up ? 'candle-up' : 'candle-down'} ${isReveal ? 'candle-reveal' : ''} ${
                  abs < historyCount ? 'candle-history' : ''
                }`}
                style={isReveal ? { animationDelay: `${(abs - revealFromRef.current) * 90}ms` } : undefined}
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
            if (lastOnScreen && Math.abs(pctFor(p) - lastPct) < 5) return null;
            return (
              <span key={i} className="axis-label" style={{ top: `${pctFor(p)}%` }}>
                {fmtAxis(p)}
              </span>
            );
          })}
          {lastOnScreen && (
            <span className={`axis-last ${changePct >= 0 ? 'up' : 'down'}`} style={{ top: `${lastPct}%` }}>
              {fmtAxis(last)}
            </span>
          )}
        </div>
      </div>

      {/* Explicit controls as well as the gestures: on a phone a drag is easy
          to mistake for a page scroll, and there is no wheel to zoom with. */}
      <div className="chart-controls">
        <div className="chart-ctrl-group">
          <button
            type="button"
            className="chart-ctrl"
            onClick={() => panBy(-Math.max(1, Math.round(effSpan / 3)))}
            disabled={atOldest}
            aria-label="Scroll back"
          >
            ◀
          </button>
          <button
            type="button"
            className="chart-ctrl"
            onClick={() => panBy(Math.max(1, Math.round(effSpan / 3)))}
            disabled={atNewest}
            aria-label="Scroll forward"
          >
            ▶
          </button>
        </div>

        <div className="chart-ctrl-group">
          <button
            type="button"
            className="chart-ctrl"
            onClick={() => zoomTo(effSpan * 1.4)}
            disabled={effSpan >= Math.min(MAX_SPAN, total)}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="chart-zoom-label">{effSpan}</span>
          <button
            type="button"
            className="chart-ctrl"
            onClick={() => zoomTo(effSpan / 1.4)}
            disabled={effSpan <= MIN_SPAN}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        <button
          type="button"
          className={`chart-ctrl chart-ctrl-reset ${following ? 'is-live' : ''}`}
          onClick={resetView}
          aria-label="Back to the latest candle"
        >
          {following ? 'Live' : 'Latest ▸'}
        </button>
      </div>

      {direction && direction !== 'flat' && (
        <div className={`direction-banner direction-${direction}`}>
          It went {direction === 'up' ? '▲ UP' : '▼ DOWN'}
        </div>
      )}
    </div>
  );
}
