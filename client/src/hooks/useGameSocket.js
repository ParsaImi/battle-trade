import { useEffect, useRef, useState } from 'react';

// Derive the game server from whatever host served the page, so opening the
// app from a phone at http://192.168.1.8:5173 talks to the server on that
// same machine — hardcoding "localhost" would point the phone at itself.
//
// Dev: vite serves on :5173 and the server has its own port, so aim at it.
// Prod: nginx serves the built bundle and reverse-proxies the socket at /ws
// on the SAME origin — one public port, no CORS, and wss:// comes for free
// once TLS is in front, because we follow the page's protocol.
//
// VITE_WS_URL overrides both. Note it is inlined at BUILD time by Vite, so
// setting it as a runtime container env var does nothing.
const WS_PORT = import.meta.env.VITE_WS_PORT || '8787';
const WS_SCHEME = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.PROD
    ? `${WS_SCHEME}://${window.location.host}/ws`
    : `${WS_SCHEME}://${window.location.hostname}:${WS_PORT}`);

export function useGameSocket(guestId, nickname, token, setToken, wantConnection = false) {
  const [you, setYou] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [quests, setQuests] = useState([]);
  const [modes, setModes] = useState([]);
  const [match, setMatch] = useState(null);
  // Server-driven matchmaking: { status: 'searching' | 'found', ... }.
  // null means we are not looking for a match.
  const [search, setSearch] = useState(null);
  // Username when signed in, null when playing as a guest.
  const [account, setAccount] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  // Reactions the opponent has sent us, drained by the match view.
  const [incomingEmote, setIncomingEmote] = useState(null);
  // Mirrors `search` for use inside socket callbacks, which close over the
  // state value from the render that created them.
  const searchRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [dailyBonus, setDailyBonus] = useState(null);
  const [notice, setNotice] = useState(null);
  const wsRef = useRef(null);
  // Socket callbacks close over the render that created them, so the live
  // token has to be read through a ref.
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;

  // Whether we have anything to connect WITH. Signing in or out changes the
  // token, and renaming changes the nickname, but neither should tear the
  // socket down — the callbacks read both through refs. Only going from
  // "no identity" to "some identity" should open a connection.
  // `wantConnection` covers the sign-in screen: a player with no nickname and
  // no session still needs an open socket to log in on, otherwise the sign-in
  // button would silently do nothing.
  const hasIdentity = Boolean(nickname || token || wantConnection);

  // Always move both together, so callbacks can trust searchRef.
  const applySearch = (value) => {
    searchRef.current = value;
    setSearch(value);
  };

  useEffect(() => {
    // A saved session is enough to connect — a returning player should not
    // have to type a nickname again just to be let back in.
    if (!hasIdentity) return;

    let cancelled = false;
    let socket;
    let retry = null;

    const connect = () => {
      // A retry scheduled before this effect was torn down must not open a
      // socket afterwards: it would never register, never be closed, and just
      // sit on the server until the heartbeat reaped it.
      if (cancelled) return;
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        // Torn down while the handshake was in flight — close it rather than
        // leaving a connected socket nobody owns.
        if (cancelled) {
          socket.close();
          return;
        }
        setConnected(true);
        setEverConnected(true);
        if (tokenRef.current) {
          // Resume the account session; the server falls us back to guest
          // if the token has expired or been signed out elsewhere.
          socket.send(JSON.stringify({ type: 'resume', token: tokenRef.current }));
        } else if (nicknameRef.current) {
          socket.send(JSON.stringify({ type: 'register', guestId, nickname: nicknameRef.current }));
        }
        // Otherwise stay connected but unregistered: the player is on the
        // sign-in screen and has not chosen to be anyone yet, so there is no
        // reason to create a player record for them.
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'lobby') {
          setYou(msg.you);
          setLeaderboard(msg.leaderboard);
          if (msg.quests) setQuests(msg.quests);
          if (msg.modes) setModes(msg.modes);
        } else if (msg.type === 'match') {
          // The match is live, so the matchmaking screen is done.
          applySearch(null);
          setMatch(msg.match);
        } else if (msg.type === 'emote') {
          setIncomingEmote({ emoji: msg.emoji, key: `${Date.now()}-${Math.random()}` });
        } else if (msg.type === 'matchmaking') {
          if (msg.status === 'cancelled') {
            applySearch(null);
            if (msg.reason === 'opponent_left') {
              setNotice({ kind: 'bad', text: 'Your opponent left before the match started.', key: Date.now() });
            }
          } else {
            applySearch(msg);
          }
        } else if (msg.type === 'registered') {
          if (msg.dailyBonus > 0) setDailyBonus(msg.dailyBonus);
          setAccount(msg.account ?? null);
          if (msg.token) setToken(msg.token);
        } else if (msg.type === 'auth') {
          setAuthBusy(false);
          if (msg.ok) {
            setAuthError(null);
            if (msg.action === 'logout') {
              setToken('');
              setAccount(null);
              setYou(null);
              // Back to this device's own guest, if it has one. A player who
              // only ever signed in here has no local guest to fall back to,
              // so let them land on the entry screen instead of quietly
              // creating a throwaway record for them.
              if (nicknameRef.current) {
                socket.send(JSON.stringify({ type: 'register', guestId, nickname: nicknameRef.current }));
              }
            } else {
              if (msg.token) setToken(msg.token);
              if (msg.username) setAccount(msg.username);
            }
          } else if (msg.action === 'resume') {
            // Saved session no longer valid — drop it and carry on as a guest.
            setToken('');
            setAccount(null);
            socket.send(JSON.stringify({ type: 'register', guestId, nickname: nicknameRef.current }));
          } else {
            setAuthError(authMessage(msg));
          }
        } else if (msg.type === 'purchase') {
          setNotice(
            msg.ok
              ? { kind: 'good', text: 'Unlocked and equipped!', key: Date.now() }
              : { kind: 'bad', text: purchaseError(msg.reason), key: Date.now() },
          );
        } else if (msg.type === 'quest_claimed') {
          if (msg.ok) setNotice({ kind: 'good', text: `Quest complete — +${msg.reward} coins!`, key: Date.now() });
        } else if (msg.type === 'match_error') {
          setNotice({
            kind: 'bad',
            text: msg.reason === 'not_enough_coins' ? 'Not enough coins for that wager.' : "Couldn't start that match.",
            key: Date.now(),
          });
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        // The queue lives on the server and does not survive the socket, so
        // stop pretending we are still searching — and say so, rather than
        // dropping the player back to the lobby with no explanation.
        if (searchRef.current) {
          setNotice({
            kind: 'bad',
            text: 'Connection dropped — search cancelled. Tap Play to try again.',
            key: Date.now(),
          });
        }
        applySearch(null);
        retry = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      cancelled = true;
      // Without this the pending retry still fires and starts a second
      // connection chain; repeated teardowns then stack up sockets.
      clearTimeout(retry);
      socket?.close();
    };
  }, [guestId, hasIdentity, setToken]);

  // Registers a guest who picks a nickname while the socket is already open
  // (they opened sign-in first, then backed out and typed a name instead).
  useEffect(() => {
    if (!connected || !nickname || token) return;
    if (you) return;
    wsRef.current?.send(JSON.stringify({ type: 'register', guestId, nickname }));
  }, [connected, nickname, token, you, guestId]);

  const send = (payload) => wsRef.current?.send(JSON.stringify(payload));

  return {
    you,
    leaderboard,
    quests,
    modes,
    match,
    search,
    account,
    incomingEmote,
    authError,
    authBusy,
    clearAuthError: () => setAuthError(null),
    connected,
    everConnected,
    dailyBonus,
    notice,
    clearNotice: () => setNotice(null),
    clearDailyBonus: () => setDailyBonus(null),
    setAvatar: (avatar) => send({ type: 'set_avatar', avatar }),
    setTitle: (title) => send({ type: 'set_title', title }),
    buyAvatar: (avatar) => send({ type: 'buy_avatar', avatar }),
    buyTitle: (title) => send({ type: 'buy_title', title }),
    sendEmote: (emoji) => send({ type: 'emote', emoji }),
    claimQuest: (questId) => send({ type: 'claim_quest', questId }),
    renameNickname: (name) => send({ type: 'set_nickname', nickname: name }),
    signup: (username, password) => {
      setAuthBusy(true);
      setAuthError(null);
      send({ type: 'signup', username, password, guestId });
    },
    login: (username, password) => {
      setAuthBusy(true);
      setAuthError(null);
      send({ type: 'login', username, password });
    },
    logout: () => send({ type: 'logout', token: tokenRef.current }),
    findMatch: (mode = 'classic', wager = 0) => send({ type: 'find_match', mode, wager }),
    playWithAi: () => send({ type: 'play_ai' }),
    cancelSearch: () => {
      applySearch(null);
      send({ type: 'cancel_match' });
    },
    submitGuess: (direction) => send({ type: 'match_guess', direction }),
    leaveMatch: () => {
      applySearch(null);
      setMatch(null);
      send({ type: 'leave_match' });
    },
  };
}

function authMessage(msg) {
  switch (msg.reason) {
    case 'username_taken':
      return 'That name is already taken.';
    case 'bad_username':
      return '3-20 characters, letters, numbers and underscores only.';
    case 'weak_password':
      return 'Password must be at least 8 characters.';
    case 'locked_out':
      return `Too many attempts. Try again in ${Math.ceil((msg.retryInSec ?? 60) / 60)} min.`;
    case 'bad_credentials':
      return 'Wrong username or password.';
    default:
      return "That didn't work. Try again.";
  }
}

function purchaseError(reason) {
  if (reason === 'not_enough_coins') return 'Not enough coins yet.';
  if (reason === 'already_owned') return 'You already own that one.';
  return "Couldn't complete that purchase.";
}
