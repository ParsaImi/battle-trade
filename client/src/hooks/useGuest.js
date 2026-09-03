import { useEffect, useState } from 'react';

const ID_KEY = 'battle-trade:guestId';
const NAME_KEY = 'battle-trade:nickname';

function makeGuestId() {
  return 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useGuest() {
  const [guestId] = useState(() => {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = makeGuestId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  });

  const [nickname, setNicknameState] = useState(() => localStorage.getItem(NAME_KEY) || '');

  useEffect(() => {
    if (nickname) localStorage.setItem(NAME_KEY, nickname);
  }, [nickname]);

  return { guestId, nickname, setNickname: setNicknameState };
}
