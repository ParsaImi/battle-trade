import Modal from './Modal';
import CoinIcon from './CoinIcon';

export default function QuestsModal({ quests, onClaim, onClose }) {
  return (
    <Modal onClose={onClose} width={400}>
      <h3 className="modal-title">Daily Quests</h3>
      <p className="modal-text">Fresh set every day. Finish one, claim your coins.</p>

      <div className="quest-list">
        {quests.length === 0 && <p className="text-dim">Loading today's quests…</p>}
        {quests.map((q) => {
          const pct = Math.round((q.progress / q.target) * 100);
          return (
            <div key={q.id} className={`quest-row ${q.claimed ? 'claimed' : ''}`}>
              <div className="quest-info">
                <span className="quest-label">{q.label}</span>
                <div className="quest-bar">
                  <div className="quest-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="quest-progress">
                  {q.progress} / {q.target}
                </span>
              </div>
              {q.claimed ? (
                <span className="quest-done">✓</span>
              ) : (
                <button type="button" className="quest-claim" disabled={!q.complete} onClick={() => onClaim(q.id)}>
                  <CoinIcon size={12} />
                  {q.reward}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
