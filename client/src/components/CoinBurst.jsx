import { useEffect, useRef, useState } from 'react';
import AnimatedNumber from './AnimatedNumber';

export default function CoinBurst({ value }) {
  const [popKey, setPopKey] = useState(0);
  const [particles, setParticles] = useState([]);
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value <= prev) return;

    setPopKey((k) => k + 1);
    setParticles(
      Array.from({ length: 8 }, (_, i) => ({
        id: `${Date.now()}-${i}`,
        dx: (Math.random() - 0.5) * 70,
        dy: -Math.random() * 55 - 15,
      })),
    );
    const t = setTimeout(() => setParticles([]), 700);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span className="coin-burst-wrap">
      <span key={popKey} className={popKey > 0 ? 'coin-pop' : ''}>
        <AnimatedNumber value={value} />
      </span>
      {particles.length > 0 && (
        <span className="coin-particles">
          {particles.map((p) => (
            <span key={p.id} className="coin-particle" style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px` }} />
          ))}
        </span>
      )}
    </span>
  );
}
