import Modal from './Modal';
import CoinIcon from './CoinIcon';
import Avatar from './Avatar';
import { AVATAR_CATALOG, AVATAR_LIST } from './avatars';

// Picking an avatar used to be a little absolute-positioned strip that opened
// under the portrait. On a phone it landed straight on top of the player's name
// and level, and it could only ever show a handful before running off the edge
// of the screen. This is the same modal pattern the shop and settings use:
// nothing to overlap, room for the whole catalogue, and it scrolls.
export default function AvatarPickerModal({ you, onSelect, onOpenShop, onClose }) {
  const owned = new Set(you?.unlockedAvatars?.length ? you.unlockedAvatars : AVATAR_LIST);
  const current = you?.avatar;
  const coins = you?.coins ?? 0;

  return (
    <Modal onClose={onClose} width={380}>
      <h3 className="modal-title">Choose your avatar</h3>
      <p className="modal-text">Cosmetic only — no gameplay advantage.</p>

      <div className="avatar-grid">
        {AVATAR_CATALOG.map((a) => {
          const isOwned = owned.has(a.id);
          const isCurrent = a.id === current;
          const affordable = coins >= a.price;
          return (
            <button
              type="button"
              key={a.id}
              className={`avatar-grid-item ${isCurrent ? 'current' : ''} ${isOwned ? '' : 'locked'}`}
              // A locked avatar is not a dead end: it hands the player to the
              // shop, where they can actually buy it.
              onClick={() => {
                if (isOwned) {
                  onSelect(a.id);
                  onClose();
                } else {
                  onOpenShop();
                }
              }}
              aria-label={
                isOwned
                  ? `${a.name}${isCurrent ? ', currently equipped' : ''}`
                  : `${a.name}, locked, costs ${a.price} coins`
              }
            >
              <span className="avatar-grid-face">
                <Avatar id={a.id} />
              </span>
              <span className="avatar-grid-name">{a.name}</span>
              {isCurrent ? (
                <span className="avatar-grid-tag equipped">Equipped</span>
              ) : isOwned ? (
                <span className="avatar-grid-tag">Owned</span>
              ) : (
                <span className={`avatar-grid-tag price ${affordable ? 'affordable' : ''}`}>
                  <CoinIcon size={10} />
                  {a.price.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="modal-actions">
        <button type="button" onClick={onOpenShop}>
          Open shop
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
