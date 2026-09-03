import { useEffect } from 'react';

// Keyboard play: ↑/W = Up, ↓/S = Down, Space/H = Hold.
// Ignored while typing in an input so renaming still works normally.
export function useKeyboardControls({ enabled, onUp, onDown, onHold }) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') {
        e.preventDefault();
        onUp?.();
      } else if (key === 'arrowdown' || key === 's') {
        e.preventDefault();
        onDown?.();
      } else if (key === ' ' || key === 'h') {
        e.preventDefault();
        onHold?.();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onUp, onDown, onHold]);
}
