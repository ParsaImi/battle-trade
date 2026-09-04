import { useEffect, useRef, useState } from 'react';
import { QUICK_EMOTES } from './reactions';
import { playClick } from '../lib/sound';

// Reactions during a match. These used to be purely local — a burst in your own
// browser that never left it — which meant that in a real match against a
// person, nothing you sent ever reached them. They now go through the server,
// and what arrives back from the opponent is drawn distinctly so you can tell
// whose reaction is whose.
export default function QuickEmotes({ onSend, incomingEmote, opponentName }) {
  const [bursts, setBursts] = useState([]);
  const seenRef = useRef(null);

  const addBurst = (emoji, mine) => {
    const id = `${Date.now()}-${Math.random()}`;
    const dx = (Math.random() - 0.5) * 70;
    setBursts((b) => [...b, { id, emoji, dx, mine }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1400);
  };

  // Each incoming reaction carries a key, so the same one is never drawn twice.
  useEffect(() => {
    if (!incomingEmote || seenRef.current === incomingEmote.key) return;
    seenRef.current = incomingEmote.key;
    addBurst(incomingEmote.emoji, false);
  }, [incomingEmote]);

  const react = (emoji) => {
    playClick();
    addBurst(emoji, true);
    onSend?.(emoji);
  };

  return (
    <div className="quick-emotes">
      <div className="emote-bursts">
        {bursts.map((b) => (
          <span
            key={b.id}
            className={`emote-burst ${b.mine ? 'mine' : 'theirs'}`}
            style={{ '--dx': `${b.dx}px` }}
          >
            {b.emoji}
            {!b.mine && <span className="emote-from">{opponentName ?? 'Opponent'}</span>}
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
