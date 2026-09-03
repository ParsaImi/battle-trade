import Modal from './Modal';

export default function HowToPlayModal({ onClose }) {
  return (
    <Modal onClose={onClose} width={380}>
      <h3 className="modal-title">How to Play</h3>
      <ul className="rules-list">
        <li>
          Hit <strong>Play</strong> to jump into a 1v1.
        </li>
        <li>Each round shows a fake chart, cut off early.</li>
        <li>
          Guess <strong>Up</strong> or <strong>Down</strong> before the timer runs out — right is +1, wrong is −1.
        </li>
        <li>
          Not sure? Hit <strong>Hold</strong> — no points either way, you just watch it play out.
        </li>
        <li>Best of 3 rounds, highest score wins the match.</li>
        <li>Win the match to earn coins — win streaks pay out more.</li>
        <li>
          Keyboard: <kbd className="key-hint">↑</kbd> Up, <kbd className="key-hint">↓</kbd> Down,{' '}
          <kbd className="key-hint">space</kbd> Hold.
        </li>
        <li>Spend coins in the shop, finish daily quests, climb the weekly leaderboard.</li>
        <li>It's all fake charts and fake coins. Just for fun.</li>
      </ul>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
