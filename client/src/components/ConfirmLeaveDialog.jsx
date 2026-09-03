import Modal from './Modal';

export default function ConfirmLeaveDialog({ onConfirm, onCancel }) {
  return (
    <Modal onClose={onCancel}>
      <h3 className="modal-title">Leave the match?</h3>
      <p className="modal-text">You'll forfeit this match and won't earn any coins from it.</p>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Stay
        </button>
        <button type="button" className="danger" onClick={onConfirm}>
          Leave Match
        </button>
      </div>
    </Modal>
  );
}
