import Modal from './Modal';
import CoinIcon from './CoinIcon';
import { TITLE_CATALOG, FREE_TITLES } from './titles';

// Picking a title used to be a dropdown anchored under the badge, and half the
// list was invisible — not because of any overflow rule, but because
// .player-hero carries a backdrop-filter for the glass effect, and an element
// with a backdrop-filter confines its descendants' painting to its own box even
// when overflow is visible. A modal renders outside that subtree entirely.
export default function TitlePickerModal({ you, onSelect, onBuy, onClose }) {
  const owned = new Set(you?.unlockedTitles?.length ? you.unlockedTitles : FREE_TITLES);
  const current = you?.title;
  const coins = you?.coins ?? 0;

  return (
    <Modal onClose={onClose} width={380}>
      <div className="shop-header">
        <h3 className="modal-title">Pick a title</h3>
        <span className="shop-balance">
          <CoinIcon size={14} />
          {coins.toLocaleString()}
        </span>
      </div>
      <p className="modal-text">Shown next to your name. Cosmetic only — no gameplay advantage.</p>

      <div className="title-grid">
        {TITLE_CATALOG.map((t) => {
          const isOwned = owned.has(t.name);
          const isCurrent = t.name === current;
          const affordable = coins >= t.price;
          return (
            <button
              type="button"
              key={t.name}
              className={`title-grid-item ${isCurrent ? 'current' : ''} ${isOwned ? '' : 'locked'}`}
              // Buying equips it in the same step, so there is no second tap.
              onClick={() => {
                if (isOwned) {
                  onSelect(t.name);
                  onClose();
                } else if (affordable) {
                  onBuy(t.name);
                  onClose();
                }
              }}
              disabled={!isOwned && !affordable}
              aria-label={
                isOwned
                  ? `${t.name}${isCurrent ? ', currently equipped' : ''}`
                  : `${t.name}, costs ${t.price} coins`
              }
            >
              <span className="title-grid-name">{t.name}</span>
              {isCurrent ? (
                <span className="title-grid-tag">Equipped</span>
              ) : isOwned ? (
                <span className="title-grid-tag owned">Owned</span>
              ) : (
                <span className={`title-grid-tag price ${affordable ? 'affordable' : ''}`}>
                  <CoinIcon size={10} />
                  {t.price.toLocaleString()}
                </span>
              )}
            </button>
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
