import { useEffect, useRef } from 'react';
import './MatchResultFX.css';

// The moment a match ends should feel different depending on how it went.
//
// Ideas borrowed from games that do this well: the expanding shockwave and
// screen shake of a Rocket League goal, Hearthstone's rays behind a victory
// banner, the shine that sweeps a Brawl Stars trophy card, and — for the other
// side — the grey wash and closing vignette that Slay the Spire and Dark Souls
// use to make a defeat land instead of just being announced.
//
// Everything here animates transform and opacity only, and the whole overlay is
// pointer-events: none, so it never sits between the player and the buttons.
export default function MatchResultFX({ outcome }) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (outcome === 'draw') return;
    // A short shake on the container behind us, so the hit has weight. Kept off
    // the overlay itself, which needs to stay still for the rays to read.
    const screen = rootRef.current?.closest('.match-screen');
    if (!screen) return;
    const cls = outcome === 'win' ? 'fx-shake-win' : 'fx-shake-loss';
    screen.classList.add(cls);
    const t = setTimeout(() => screen.classList.remove(cls), 700);
    return () => {
      clearTimeout(t);
      screen.classList.remove(cls);
    };
  }, [outcome]);

  if (outcome === 'draw') return <div ref={rootRef} />;

  if (outcome === 'win') {
    return (
      <div className="result-fx result-fx-win" ref={rootRef} aria-hidden="true">
        {/* Light behind the card, turning slowly. */}
        <div className="fx-rays" />
        {/* Two rings, offset, so the burst reads as an impact and not a pulse. */}
        <div className="fx-shockwave" />
        <div className="fx-shockwave fx-shockwave-2" />
        <div className="fx-glow" />
        {/* Sparks thrown outward from the middle. */}
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            className="fx-spark"
            style={{
              '--angle': `${(360 / 14) * i + Math.random() * 12}deg`,
              '--dist': `${120 + Math.random() * 120}px`,
              '--delay': `${Math.random() * 220}ms`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="result-fx result-fx-loss" ref={rootRef} aria-hidden="true">
      {/* Colour drains out of the screen, then comes most of the way back. */}
      <div className="fx-desaturate" />
      <div className="fx-vignette" />
      {/* Ash drifting down. Slow and sparse — the opposite of confetti. */}
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className="fx-ash"
          style={{
            '--x': `${Math.random() * 100}%`,
            '--drift': `${(Math.random() - 0.5) * 60}px`,
            '--delay': `${Math.random() * 1400}ms`,
            '--dur': `${2600 + Math.random() * 1800}ms`,
            '--size': `${2 + Math.random() * 3}px`,
          }}
        />
      ))}
    </div>
  );
}
