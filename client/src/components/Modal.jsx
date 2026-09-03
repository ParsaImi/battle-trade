export default function Modal({ onClose, children, width = 340 }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
