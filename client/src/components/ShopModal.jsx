import Modal from './Modal';
import CoinIcon from './CoinIcon';
import Avatar from './Avatar';
import { AVATAR_CATALOG } from './avatars';

export default function ShopModal({ you, onBuy, onEquip, onClose }) {
  const owned = you?.unlockedAvatars ?? [];
  const coins = you?.coins ?? 0;

  return (
    <Modal onClose={onClose} width={420}>
      <div className="shop-header">
        <h3 className="modal-title">Avatar Shop</h3>
        <span className="shop-balance">
          <CoinIcon size={15} />
          {coins.toLocaleString()}
        </span>
      </div>
      <p className="modal-text">Spend your coins on a look. Cosmetic only — no gameplay advantage.</p>

      <div className="shop-grid">
        {AVATAR_CATALOG.map((a) => {
          const isOwned = owned.includes(a.id);
          const isEquipped = you?.avatar === a.id;
          const canAfford = coins >= a.price;

          return (
            <div key={a.id} className={`shop-item ${isEquipped ? 'equipped' : ''}`}>
              <div className={`shop-emoji ${!isOwned ? 'locked' : ''}`}><Avatar id={a.id} /></div>
              <span className="shop-name">{a.name}</span>
              {isEquipped ? (
                <span className="shop-tag equipped-tag">Equipped</span>
              ) : isOwned ? (
                <button type="button" className="shop-btn" onClick={() => onEquip(a.id)}>
                  Equip
                </button>
              ) : (
                <button
                  type="button"
                  className="shop-btn buy"
                  disabled={!canAfford}
                  onClick={() => onBuy(a.id)}
                  title={canAfford ? '' : 'Not enough coins'}
                >
                  <CoinIcon size={12} />
                  {a.price.toLocaleString()}
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
