import { useEffect, useRef, useState } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8787';

export function useGameSocket(guestId, nickname) {
  const [you, setYou] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [quests, setQuests] = useState([]);
  const [modes, setModes] = useState([]);
  const [match, setMatch] = useState(null);
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
          setMatch(msg.match);
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
    startMatch: (mode = 'classic', wager = 0) => send({ type: 'start_match', mode, wager }),
    submitGuess: (direction) => send({ type: 'match_guess', direction }),
    leaveMatch: () => {
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
