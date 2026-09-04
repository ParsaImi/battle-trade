import { useCallback, useEffect, useRef, useState } from 'react';
import { useGuest } from './hooks/useGuest';
import { useGameSocket } from './hooks/useGameSocket';
import Lobby from './components/Lobby';
import MatchView from './components/MatchView';
import Matchmaking from './components/Matchmaking';
import ConfirmLeaveDialog from './components/ConfirmLeaveDialog';
import WagerModal from './components/WagerModal';
import AuthModal from './components/AuthModal';
import { MODE_BY_ID } from './components/gameModes';
import Toast from './components/Toast';
import Confetti from './components/Confetti';
import BrandLogo from './components/BrandLogo';
import { playCorrect, playWrong, playWin, playLose } from './lib/sound';
import './App.css';

function useCountdown(endsAt) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return remaining;
}

function NicknamePrompt({ onSubmit, onSignIn }) {
  const [value, setValue] = useState('');
  return (
    <div className="nickname-screen">
      <div className="nickname-card">
        <BrandLogo size={56} />
        <h1>Welcome to Battle Trade</h1>
        <p>No real money, ever — just coins and bragging rights.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) onSubmit(trimmed);
          }}
        >
          <input
            autoFocus
            maxLength={20}
            placeholder="What's your trader name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" disabled={!value.trim()}>
            Enter the arena
          </button>
        </form>
        {/* Guest play is the default path; an account is offered, never
            required. */}
        <button type="button" className="nickname-alt" onClick={onSignIn}>
          Already have an account? <span>Sign in</span>
        </button>
        <div className="warning-note">
          <strong>Warning</strong>
          It's just a game, have fun!
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { guestId, nickname, setNickname, token, setToken } = useGuest();
  // Declared before useGameSocket because the socket needs to know whether the
  // sign-in dialog is open: a player with no nickname and no session still
  // needs a connection to log in on.
  // null when closed, otherwise 'login' | 'signup'.
  const [authOpen, setAuthOpen] = useState(null);
  const {
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
    clearAuthError,
    connected,
    everConnected,
    dailyBonus,
    clearDailyBonus,
    notice,
    clearNotice,
    setAvatar,
    setTitle,
    buyAvatar,
    buyTitle,
    claimQuest,
    renameNickname,
    findMatch,
    cancelSearch,
    playWithAi,
    signup,
    login,
    logout,
    submitGuess,
    leaveMatch,
    sendEmote,
  } = useGameSocket(guestId, nickname, token, setToken, authOpen !== null);
  const remaining = useCountdown(match?.phaseEndsAt);
  const [selectedMode, setSelectedMode] = useState('classic');
  const [wagerOpen, setWagerOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [confettiKey, setConfettiKey] = useState(null);
  const [confettiIntense, setConfettiIntense] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [toast, setToast] = useState(null);
  const flashKeyRef = useRef(null);

  // Single toast lane — daily bonus, purchases, quest claims, achievements
  // and level-ups all surface through here rather than stacking overlays.
  const pushToast = useCallback((text, kind = 'good') => {
    setToast({ text, kind, key: `${Date.now()}-${Math.random()}` });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!notice) return;
    pushToast(notice.text, notice.kind);
    clearNotice();
  }, [notice, pushToast, clearNotice]);

  // Keep the locally-cached nickname (what future 'register' calls send on
  // reconnect) in sync with the server's copy — otherwise a rename made
  // through Settings gets silently clobbered back on the next reconnect.
  useEffect(() => {
    // Only while playing as a guest. The stored nickname belongs to THIS
    // device's guest, and an account's name is not that — copying it over meant
    // signing out left the account's name stuck on the local guest.
    if (account) return;
    if (you?.nickname && you.nickname !== nickname) {
      setNickname(you.nickname);
    }
  }, [account, you?.nickname, nickname, setNickname]);

  // Fires a full-screen red/green pulse + a matching beep: once per resolved
  // round, and once for the final match outcome (a draw gets neither).
  useEffect(() => {
    if (!match) {
      flashKeyRef.current = null;
      return;
    }
    if (match.phase === 'guess' && match.round === 1 && !match.roundOutcome) {
      flashKeyRef.current = null;
      return;
    }

    // 'neutral' covers a held (or timed-out) round: no flash, no sound —
    // matches the "just watching" rule for Hold.
    let key = null;
    let type = null;
    if (match.phase === 'reveal' && match.roundOutcome) {
      key = `round-${match.round}`;
      const { playerDelta } = match.roundOutcome;
      type = playerDelta > 0 ? 'win' : playerDelta < 0 ? 'loss' : 'neutral';
    } else if (match.phase === 'complete' && match.matchResult && match.matchResult.outcome !== 'draw') {
      key = 'complete';
      type = match.matchResult.outcome === 'win' ? 'win' : 'loss';
    }

    if (key && type && flashKeyRef.current !== key) {
      flashKeyRef.current = key;
      if (type === 'neutral') return;
      setFlash({ type, key });
      const t = setTimeout(() => setFlash(null), 750);
      if (key === 'complete') {
        if (type === 'win') {
          const streak = match.matchResult.streak;
          playWin(streak);
          setConfettiKey(key + Date.now());
          if (streak >= 3) {
            setConfettiIntense(true);
            setCelebrating(true);
            setTimeout(() => setCelebrating(false), 500);
          } else {
            setConfettiIntense(false);
          }
        } else {
          playLose();
        }
      } else {
        type === 'win' ? playCorrect() : playWrong();
      }
      return () => clearTimeout(t);
    }
  }, [match]);

  // Daily login bonus toast, self-clearing after a few seconds.
  useEffect(() => {
    if (!dailyBonus) return;
    const t = setTimeout(clearDailyBonus, 3200);
    return () => clearTimeout(t);
  }, [dailyBonus, clearDailyBonus]);

  // Announce level-ups and newly-earned achievements once per match result.
  const announcedRef = useRef(null);
  useEffect(() => {
    const result = match?.matchResult;
    if (!result) return;
    const stamp = `${result.playerScore}-${result.botScore}-${result.delta}-${result.streak}`;
    if (announcedRef.current === stamp) return;
    announcedRef.current = stamp;

    if (result.leveledUpTo) {
      pushToast(`Level up! You're now level ${result.leveledUpTo}`, 'good');
    }
    (result.newAchievements ?? []).forEach((a, i) => {
      setTimeout(() => pushToast(`${a.icon} Achievement unlocked: ${a.label}`, 'good'), (i + 1) * 900);
    });
  }, [match?.matchResult, pushToast]);

  // A saved session skips the prompt entirely — the server will tell us who
  // this is. Without one, the guest path asks for a name as it always has.
  if (!nickname && !token) {
    return (
      <>
        <NicknamePrompt onSubmit={setNickname} onSignIn={() => setAuthOpen('login')} />
        {authOpen && (
          <AuthModal
            mode={authOpen}
            account={account}
            error={authError}
            busy={authBusy}
            onLogin={login}
            onSignup={signup}
            onClearError={clearAuthError}
            onClose={() => {
              setAuthOpen(null);
              clearAuthError();
            }}
          />
        )}
      </>
    );
  }

  const activeMode = MODE_BY_ID[selectedMode] ?? MODE_BY_ID.classic;

  // The server runs matchmaking: it queues us for a real opponent, then
  // announces who we are facing. Nothing starts locally any more.
  const handlePlay = () => {
    // High Stakes needs a wager chosen before the match can start.
    if (activeMode.wager) {
      setWagerOpen(true);
      return;
    }
    findMatch(selectedMode, 0);
  };

  const handleWagerConfirm = (amount) => {
    setWagerOpen(false);
    findMatch(selectedMode, amount);
  };

  const handlePlayAgain = () => {
    if (activeMode.wager) {
      setWagerOpen(true);
      return;
    }
    findMatch(selectedMode, 0);
  };

  const matchInProgress = match && match.phase !== 'complete';

  const requestLeave = () => {
    if (matchInProgress) {
      setConfirmLeaveOpen(true);
    } else {
      leaveMatch();
    }
  };

  const confirmLeave = () => {
    setConfirmLeaveOpen(false);
    leaveMatch();
  };

  return (
    <div className={`app ${celebrating ? 'celebration-mode' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="brand-link"
          onClick={() => {
            if (match) requestLeave();
          }}
        >
          <BrandLogo size={28} />
          <span className="brand-wordmark">Battle Trade</span>
        </button>
        <div className={`conn-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Connected' : 'Reconnecting…'} />

        {/* Signing in was only reachable from Settings once you were playing.
            A guest should be able to find it without going looking. */}
        {account ? (
          <span className="topbar-account" title={`Signed in as ${account}`}>
            {account}
          </span>
        ) : (
          <button type="button" className="topbar-signin" onClick={() => setAuthOpen('login')}>
            Sign in
          </button>
        )}
      </header>

      {everConnected && !connected && (
        <div className="reconnect-banner">
          <span className="reconnect-spinner" />
          Connection lost — reconnecting…
        </div>
      )}

      {flash && <div key={flash.key} className={`flash-overlay flash-${flash.type}`} />}
      {confettiKey && <Confetti key={confettiKey} />}
      <Toast text={dailyBonus ? `+${dailyBonus} daily login bonus!` : null} toastKey={dailyBonus} />
      <Toast text={toast?.text} toastKey={toast?.key} kind={toast?.kind} offset={dailyBonus ? 52 : 0} />

      {search ? (
        <Matchmaking
          search={search}
          avatar={you?.avatar || 'nomad'}
          nickname={you?.nickname || nickname}
          onCancel={cancelSearch}
          onPlayAi={playWithAi}
        />
      ) : match ? (
        <MatchView
          match={match}
          you={you}
          opponent={match.opponent}
          onGuess={submitGuess}
          onLeave={requestLeave}
          onPlayAgain={handlePlayAgain}
          remaining={remaining}
          onEmote={sendEmote}
          incomingEmote={incomingEmote}
        />
      ) : (
        <Lobby
          you={you}
          guestId={guestId}
          leaderboard={leaderboard}
          quests={quests}
          modes={modes}
          selectedMode={selectedMode}
          onSelectMode={setSelectedMode}
          onSetAvatar={setAvatar}
          onSetTitle={setTitle}
          onBuyAvatar={buyAvatar}
          onBuyTitle={buyTitle}
          onClaimQuest={claimQuest}
          onRename={renameNickname}
          onPlay={handlePlay}
          account={account}
          onSignIn={() => setAuthOpen(account ? 'login' : 'signup')}
          onSignOut={logout}
        />
      )}

      {confirmLeaveOpen && (
        <ConfirmLeaveDialog onConfirm={confirmLeave} onCancel={() => setConfirmLeaveOpen(false)} />
      )}

      {authOpen && (
        <AuthModal
          mode={authOpen}
          account={account}
          error={authError}
          busy={authBusy}
          onLogin={login}
          onSignup={signup}
          onClearError={clearAuthError}
          onClose={() => {
            setAuthOpen(null);
            clearAuthError();
          }}
        />
      )}

      {wagerOpen && (
        <WagerModal
          coins={you?.coins ?? 0}
          options={activeMode.wagerOptions ?? [100, 250, 500, 1000]}
          onConfirm={handleWagerConfirm}
          onClose={() => setWagerOpen(false)}
        />
      )}
    </div>
  );
}
