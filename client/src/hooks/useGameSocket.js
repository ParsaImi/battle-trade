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

export function useGameSocket(guestId, nickname) {
  const [you, setYou] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [quests, setQuests] = useState([]);
  const [modes, setModes] = useState([]);
  const [match, setMatch] = useState(null);
  // Server-driven matchmaking: { status: 'searching' | 'found', ... }.
  // null means we are not looking for a match.
  const [search, setSearch] = useState(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [dailyBonus, setDailyBonus] = useState(null);
  const [notice, setNotice] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!nickname) return;

    let cancelled = false;
    let socket;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setEverConnected(true);
        socket.send(JSON.stringify({ type: 'register', guestId, nickname }));
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
          setSearch(null);
          setMatch(msg.match);
        } else if (msg.type === 'matchmaking') {
          if (msg.status === 'cancelled') {
            setSearch(null);
            if (msg.reason === 'opponent_left') {
              setNotice({ kind: 'bad', text: 'Your opponent left before the match started.', key: Date.now() });
            }
          } else {
            setSearch(msg);
          }
        } else if (msg.type === 'registered') {
          if (msg.dailyBonus > 0) setDailyBonus(msg.dailyBonus);
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
        // The queue lives on the server and does not survive the socket,
        // so stop pretending we are still searching.
        setSearch(null);
        setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [guestId, nickname]);

  const send = (payload) => wsRef.current?.send(JSON.stringify(payload));

  return {
    you,
    leaderboard,
    quests,
    modes,
    match,
    search,
    connected,
    everConnected,
    dailyBonus,
    notice,
    clearNotice: () => setNotice(null),
    clearDailyBonus: () => setDailyBonus(null),
    setAvatar: (avatar) => send({ type: 'set_avatar', avatar }),
    setTitle: (title) => send({ type: 'set_title', title }),
    buyAvatar: (avatar) => send({ type: 'buy_avatar', avatar }),
    claimQuest: (questId) => send({ type: 'claim_quest', questId }),
    renameNickname: (name) => send({ type: 'set_nickname', nickname: name }),
    findMatch: (mode = 'classic', wager = 0) => send({ type: 'find_match', mode, wager }),
    cancelSearch: () => {
      setSearch(null);
      send({ type: 'cancel_match' });
    },
    submitGuess: (direction) => send({ type: 'match_guess', direction }),
    leaveMatch: () => {
      setSearch(null);
      setMatch(null);
      send({ type: 'leave_match' });
    },
  };
}

function purchaseError(reason) {
  if (reason === 'not_enough_coins') return 'Not enough coins yet.';
  if (reason === 'already_owned') return 'You already own that one.';
  return "Couldn't complete that purchase.";
}
