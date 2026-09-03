import { useState } from 'react';
import Modal from './Modal';
import { useMuted } from '../hooks/useMuted';
import { useProMode } from '../hooks/useProMode';

// TODO: swap in your real community link (Discord/Telegram/etc).
const CONNECT_URL = 'https://discord.gg/replace-with-your-invite';

export default function SettingsModal({ nickname, onRename, onClose }) {
  const [name, setName] = useState(nickname || '');
  const [saved, setSaved] = useState(false);
  const [muted, toggleMuted] = useMuted();
  const [proMode, toggleProMode] = useProMode();

  const handleSave = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === nickname) return;
    onRename(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="modal-title">Settings</h3>

      <form className="settings-row" onSubmit={handleSave}>
        <span className="settings-label">Trader name</span>
        <div className="settings-rename-row">
          <input
            className="settings-input"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="settings-save-btn" disabled={!name.trim() || name.trim() === nickname}>
            {saved ? '✓' : 'Save'}
          </button>
        </div>
      </form>

      <div className="settings-row settings-toggle-row">
        <span className="settings-label">Sound effects</span>
        <button
          type="button"
          className={`toggle-switch ${muted ? '' : 'on'}`}
          onClick={() => toggleMuted(!muted)}
          aria-pressed={!muted}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      <div className="settings-row settings-toggle-row">
        <span className="settings-label">Pro Mode</span>
        <button
          type="button"
          className={`toggle-switch ${proMode ? 'on' : ''}`}
          onClick={() => toggleProMode(!proMode)}
          aria-pressed={proMode}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      <div className="settings-row">
        <span className="settings-label">Connect with us</span>
        <a className="settings-link" href={CONNECT_URL} target="_blank" rel="noreferrer">
          {CONNECT_URL.replace('https://', '')}
        </a>
      </div>

      <p className="settings-more">More settings are coming soon.</p>

      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
