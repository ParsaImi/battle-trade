import { useState } from 'react';
import { isMusicOn, setMusicOn } from '../lib/music';

export function useMusic() {
  const [on, setOn] = useState(isMusicOn);

  const toggle = (next) => {
    setMusicOn(next);
    setOn(next);
  };

  return [on, toggle];
}
