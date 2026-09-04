import { useCallback, useEffect, useState } from 'react';

const ID_KEY = 'battle-trade:guestId';
const NAME_KEY = 'battle-trade:nickname';
const TOKEN_KEY = 'battle-trade:token';

function makeGuestId() {
  return 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Identity on this device.
//
// `guestId` is this browser's own player and never changes — an account is
// layered on top rather than replacing it, so signing out returns the player to
// whatever they had here before they signed in.
//
// `token` is a saved session. When one is present the app can connect and
// resume straight away, with no nickname prompt and no password.
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
  const [token, setTokenState] = useState(() => localStorage.getItem(TOKEN_KEY) || '');

  useEffect(() => {
    if (nickname) localStorage.setItem(NAME_KEY, nickname);
  }, [nickname]);

  const setToken = useCallback((value) => {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    setTokenState(value || '');
  }, []);

  return { guestId, nickname, setNickname: setNicknameState, token, setToken };
}
