import { useState } from 'react';
import { QUICK_EMOTES } from './reactions';
import { playClick } from '../lib/sound';

export default function QuickEmotes() {
  const [bursts, setBursts] = useState([]);

  const react = (emoji) => {
    playClick();
    const id = `${Date.now()}-${Math.random()}`;
    const dx = (Math.random() - 0.5) * 70;
    setBursts((b) => [...b, { id, emoji, dx }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1100);
  };

  return (
    <div className="quick-emotes">
      <div className="emote-bursts">
        {bursts.map((b) => (
          <span key={b.id} className="emote-burst" style={{ '--dx': `${b.dx}px` }}>
            {b.emoji}
          </span>
        ))}
      </div>
      <div className="quick-emotes-row">
        {QUICK_EMOTES.map((e) => (
          <button type="button" key={e} className="emote-btn" onClick={() => react(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
