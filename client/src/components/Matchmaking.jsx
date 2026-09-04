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

// Slices the server's pre-match countdown into the VS card and 3 / 2 / 1 / GO.
// Driven off `startsAt` rather than local timers so both players in a PvP
// match see the same beat and start the first round together.
function stageFor(msLeft) {
  if (msLeft > 2400) return 'found';
  if (msLeft > 1600) return '3';
  if (msLeft > 800) return '2';
  if (msLeft > 150) return '1';
  return 'go';
}

export default function Matchmaking({ search, avatar, nickname, onCancel }) {
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)]);
  const [now, setNow] = useState(() => Date.now());

  const searching = search?.status === 'searching';
  const startsAt = search?.startsAt ?? null;

  // One ticking clock covers both the "searching for 12s…" readout and the
  // countdown; nothing here decides when the match actually begins.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  if (searching) {
    const elapsed = Math.max(0, Math.round((now - (search.startedAt ?? now)) / 1000));
    const total = Math.round((search.waitMs ?? 30_000) / 1000);
    const left = Math.max(0, total - elapsed);

    return (
      <div className="matchmaking-screen">
        <div className="mm-avatar-pulse">
          <div className="mm-avatar"><Avatar id={avatar} /></div>
        </div>
        <p className="transition-line">{line}</p>
        <div className="loading-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="mm-sub">Looking for a live opponent…</p>
        <p className="mm-search-timer" aria-live="polite">
          {left > 0
            ? `No one yet — ${left}s until you're matched with an AI opponent`
            : 'Setting up your match…'}
        </p>
        <button type="button" className="mm-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (!startsAt) return <div className="matchmaking-screen" />;

  const stage = stageFor(startsAt - now);
  const opponent = search?.opponent ?? null;

  if (stage === 'found') {
    return (
      <div className="matchmaking-screen">
        <div className="mm-found">
          <div className="mm-vs-row">
            <div className="mm-vs-side">
              <div className="mm-avatar small"><Avatar id={avatar} /></div>
              <span>{nickname}</span>
            </div>
            <span className="mm-vs-text">VS</span>
            <div className="mm-vs-side">
              <div className="mm-avatar small"><Avatar id={opponent?.avatar} /></div>
              <span>{opponent?.nickname ?? 'The chart'}</span>
              {/* Only a real person gets the badge. A bot opponent is shown as
                  an ordinary trader and is never labelled live. */}
              {search?.pvp && <span className="mm-live-badge">LIVE</span>}
            </div>
          </div>
          <p className="mm-found-text">
            {search?.pvp ? 'Live opponent found!' : 'Opponent found!'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="matchmaking-screen">
      <div key={stage} className={`mm-countdown-number ${stage === 'go' ? 'mm-go' : ''}`}>
        {stage === 'go' ? 'GO!' : stage}
      </div>
    </div>
  );
}
