import { useState } from 'react';

const KEY = 'battle-trade:proMode';

export function useProMode() {
  const [proMode, setProModeRaw] = useState(() => localStorage.getItem(KEY) === '1');

  const toggle = (next) => {
    localStorage.setItem(KEY, next ? '1' : '0');
    setProModeRaw(next);
  };

  return [proMode, toggle];
}
