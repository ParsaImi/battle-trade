// `offset` lifts this toast above another one so two can show at once
// without overlapping.
export default function Toast({ text, toastKey, kind = 'good', offset = 0 }) {
  if (!text) return null;
  return (
    <div className="toast-wrap" style={offset ? { bottom: `${24 + offset}px` } : undefined}>
      <div key={toastKey} className={`toast toast-${kind}`}>
        {text}
      </div>
    </div>
  );
}
