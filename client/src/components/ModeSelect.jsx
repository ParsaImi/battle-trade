import CoinIcon from './CoinIcon';
import { MODE_BY_ID, MODE_LIST } from './gameModes';

// Mode hub: a responsive grid of tiles rather than a cramped horizontal
// scroller, so every mode is visible at once.
export default function ModeSelect({ modes, selected, onSelect, bests }) {
  const list = (modes?.length ? modes : MODE_LIST).map((m) => ({ ...MODE_BY_ID[m.id], ...m }));

  return (
    <div className="mode-select">
      <div className="mode-select-head">
        <span className="mode-select-label">Choose your mode</span>
      </div>
      <div className="mode-grid">
        {list.map((m) => {
          const best = bests?.[m.id];
          const active = selected === m.id;
          return (
            <button
              type="button"
              key={m.id}
              className={`mode-tile ${active ? 'active' : ''}`}
              onClick={() => onSelect(m.id)}
              aria-pressed={active}
            >
              <span className="mode-tile-icon">{m.icon}</span>
              <span className="mode-tile-body">
                <span className="mode-tile-name">{m.name}</span>
                <span className="mode-tile-tagline">{m.tagline}</span>
              </span>
              <span className="mode-tile-meta">
                {m.wager && (
                  <span className="mode-tile-flag">
                    <CoinIcon size={10} /> wager
                  </span>
                )}
                {best > 0 && <span className="mode-tile-best">Best {best}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
