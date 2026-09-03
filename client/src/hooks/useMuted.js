import { useState } from 'react';
import { isMuted, setMuted } from '../lib/sound';

export function useMuted() {
  const [muted, setMutedRaw] = useState(isMuted);

  const toggle = (next) => {
    setMuted(next);
    setMutedRaw(next);
  };

  return [muted, toggle];
}
