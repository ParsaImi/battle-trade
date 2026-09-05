import { useState } from 'react';
import Modal from './Modal';
import CoinIcon from './CoinIcon';
import { MODE_LIST } from './gameModes';

const WAGERS = [100, 250, 500, 1000];

// Private rooms. One player opens one and gets a short code; whoever they send
// it to joins that exact match instead of the open queue.
export default function RoomModal({ room, error, coins = 0, onCreate, onJoin, onLeave, onClose }) {
  const [tab, setTab] = useState('create');
  const [mode, setMode] = useState('classic');
  const [wager, setWager] = useState(WAGERS[0]);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Everything except the room shell itself is playable in a room.
  const playable = MODE_LIST.filter((m) => !m.room);
  const chosen = playable.find((m) => m.id === mode);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context, permissions) — the code is on
      // screen to read out, so this is not worth an error.
    }
  };

  // Waiting for a friend: the room exists and the code is live.
  if (room?.status === 'waiting') {
    return (
      <Modal onClose={onClose} width={360}>
        <h3 className="modal-title">Room open</h3>
        <p className="modal-text">
          Send this code to a friend. They pick <strong>Custom Room</strong>, tap Join, and you both
          drop straight into {room.modeName}.
        </p>

        <div className="room-code" onClick={copy} role="button" tabIndex={0}
             onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && copy()}>
          {room.code.split('').map((ch, i) => (
            <span key={i} className="room-code-char">{ch}</span>
          ))}
        </div>

        <button type="button" className="room-copy" onClick={copy}>
          {copied ? 'Copied' : 'Tap to copy'}
        </button>

        {room.wager > 0 && (
          <p className="room-note">
            <CoinIcon size={12} /> {room.wager.toLocaleString()} staked. Your friend stakes the same.
          </p>
        )}
        <p className="room-note">The room closes on its own after 15 minutes.</p>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onLeave}>
            Close room
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} width={360}>
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'create'}
                className={`auth-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
          Create
        </button>
        <button type="button" role="tab" aria-selected={tab === 'join'}
                className={`auth-tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>
          Join
        </button>
      </div>

      {tab === 'create' ? (
        <>
          <p className="auth-blurb">Pick what you want to play. You will get a code to share.</p>
          <div className="room-modes">
            {playable.map((m) => (
              <button type="button" key={m.id}
                      className={`room-mode ${mode === m.id ? 'selected' : ''}`}
                      onClick={() => setMode(m.id)}>
                <span className="room-mode-icon">{m.icon}</span>
                <span className="room-mode-name">{m.name}</span>
              </button>
            ))}
          </div>

          {chosen?.wager && (
            <>
              <label className="auth-label">Stake (you both put this in)</label>
              <div className="room-wagers">
                {WAGERS.map((w) => (
                  <button type="button" key={w} disabled={w > coins}
                          className={`room-wager ${wager === w ? 'selected' : ''}`}
                          onClick={() => setWager(w)}>
                    <CoinIcon size={11} /> {w.toLocaleString()}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="button" className="auth-submit"
                  onClick={() => onCreate(mode, chosen?.wager ? wager : 0)}>
            Create room
          </button>
        </>
      ) : (
        <>
          <p className="auth-blurb">Enter the code your friend sent you.</p>
          <input
            className="auth-input room-code-input"
            value={code}
            maxLength={5}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
            placeholder="ABC23"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="button" className="auth-submit" disabled={code.length < 5}
                  onClick={() => onJoin(code)}>
            Join room
          </button>
        </>
      )}

      <button type="button" className="auth-skip" onClick={onClose}>
        Back
      </button>
    </Modal>
  );
}
