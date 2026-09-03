import { useState } from 'react';
import Modal from './Modal';
import CoinIcon from './CoinIcon';

export default function WagerModal({ coins, options, onConfirm, onClose }) {
  const affordable = options.filter((o) => o <= coins);
  const [pick, setPick] = useState(affordable[0] ?? options[0]);

  return (
    <Modal onClose={onClose} width={360}>
      <h3 className="modal-title">Set your wager</h3>
      <p className="modal-text">
        Win and you get double it back. Lose and it's gone. Draw refunds you.
      </p>

      <div className="wager-grid">
        {options.map((o) => {
          const canAfford = o <= coins;
          return (
            <button
              type="button"
              key={o}
              className={`wager-option ${pick === o ? 'selected' : ''}`}
              disabled={!canAfford}
              onClick={() => setPick(o)}
            >
              <CoinIcon size={13} />
              {o.toLocaleString()}
            </button>
          );
        })}
      </div>

      <p className="wager-balance">
        Balance: <CoinIcon size={12} /> {coins.toLocaleString()}
      </p>

      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!affordable.length} onClick={() => onConfirm(pick)}>
          {affordable.length ? `Wager ${pick.toLocaleString()}` : 'Not enough coins'}
        </button>
      </div>
    </Modal>
  );
}
