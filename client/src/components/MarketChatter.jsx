import { useEffect, useState } from 'react';
import { CRASH_LINES, PUMP_LINES } from './reactions';

export default function MarketChatter({ triggerKey, direction, big }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    if (!triggerKey) return;
    const pool = direction === 'down' ? CRASH_LINES : PUMP_LINES;
    const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
    setLines(picks.map((text, i) => ({ id: `${triggerKey}-${i}`, text, delay: i * 350 })));
    const t = setTimeout(() => setLines([]), 2400);
    return () => clearTimeout(t);
  }, [triggerKey, direction]);

  if (lines.length === 0) return null;

  return (
    <div className={`market-chatter ${big ? 'market-chatter-big' : ''}`}>
      {lines.map((l) => (
        <span key={l.id} className="chatter-bubble" style={{ animationDelay: `${l.delay}ms` }}>
          {l.text}
        </span>
      ))}
    </div>
  );
}
