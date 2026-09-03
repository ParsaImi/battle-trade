import { useEffect, useState } from 'react';
import Avatar from './Avatar';

const LINES = [
  'Fortune favors the bold.',
  'Read the chart. Trust your gut.',
  'Every candle tells a story.',
  'Bulls make money. Bears make money.',
  'Time to make your move.',
  'Instincts ready. Chart loading.',
  'No guts, no glory.',
  'The trend is your friend — maybe.',
];

const PHASES = [
  { key: 'searching', duration: 1500 },
  { key: 'found', duration: 1200 },
  { key: 'countdown3', duration: 500 },
  { key: 'countdown2', duration: 500 },
  { key: 'countdown1', duration: 500 },
  { key: 'go', duration: 450 },
];

export default function Matchmaking({ avatar, nickname, opponent, onDone }) {
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)]);
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (phaseIndex >= PHASES.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => setPhaseIndex((i) => i + 1), PHASES[phaseIndex].duration);
    return () => clearTimeout(t);
  }, [phaseIndex, onDone]);

  const phase = PHASES[phaseIndex]?.key;

  return (
    <div className="matchmaking-screen">
      {phase === 'searching' && (
        <>
          <div className="mm-avatar-pulse">
            <div className="mm-avatar"><Avatar id={avatar} /></div>
          </div>
          <p className="transition-line">{line}</p>
          <div className="loading-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="mm-sub">Searching for an opponent…</p>
        </>
      )}

      {phase === 'found' && (
        <div className="mm-found">
          <div className="mm-vs-row">
            <div className="mm-vs-side">
              <div className="mm-avatar small"><Avatar id={avatar} /></div>
              <span>{nickname}</span>
            </div>
            <span className="mm-vs-text">VS</span>
            <div className="mm-vs-side">
              <div className="mm-avatar small"><Avatar id={opponent.avatar} /></div>
              <span>{opponent.name}</span>
            </div>
          </div>
          <p className="mm-found-text">Opponent found!</p>
        </div>
      )}

      {(phase === 'countdown3' || phase === 'countdown2' || phase === 'countdown1') && (
        <div key={phase} className="mm-countdown-number">
          {phase.slice(-1)}
        </div>
      )}

      {phase === 'go' && (
        <div key="go" className="mm-countdown-number mm-go">
          GO!
        </div>
      )}
    </div>
  );
}
