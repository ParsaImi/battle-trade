import { useEffect, useState } from 'react';

// Cosmetic "online now" figure — not a real presence count. Refreshes
// every couple of minutes to feel alive rather than static.
const MIN = 100;
const MAX = 200;
const REFRESH_MS = 120_000;

function randomCount() {
  return Math.floor(MIN + Math.random() * (MAX - MIN));
}

export function useOnlinePlayers() {
  const [count, setCount] = useState(randomCount);

  useEffect(() => {
    const id = setInterval(() => setCount(randomCount()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return count;
}
