import { useEffect, useState } from 'react';
import Leaderboard from './Leaderboard';
import SettingsModal from './SettingsModal';
import AvatarPickerModal from './AvatarPickerModal';
import TitlePickerModal from './TitlePickerModal';
import HowToPlayModal from './HowToPlayModal';
import ShopModal from './ShopModal';
import QuestsModal from './QuestsModal';
import ProfileModal from './ProfileModal';
import ModeSelect from './ModeSelect';
import CoinBurst from './CoinBurst';
import CoinIcon from './CoinIcon';
import { MODE_BY_ID } from './gameModes';
import { useOnlinePlayers } from '../hooks/useOnlinePlayers';
import { useMuted } from '../hooks/useMuted';
import Avatar from './Avatar';
import { startAmbient, stopAmbient } from '../lib/sound';

const TICKER_MS = 4200;

// Fallback only — the server sends a real XP-based level once connected.
function levelFor(coins) {
  return Math.floor((coins ?? 0) / 100) + 1;
}

function buildTickerMessages(leaderboard, online) {
  const messages = leaderboard.slice(0, 5).map((e, i) => `🏆 ${e.nickname} is ranked #${i + 1} this week with ${e.weeklyCoins.toLocaleString()} coins`);
  messages.push(`👥 ${online.toLocaleString()} traders online right now`);
  messages.push('⚡ New matches happening every few seconds');
  return messages;
}

function useTicker(leaderboard, online) {
  const messages = buildTickerMessages(leaderboard, online);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), TICKER_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  return messages[index % messages.length] ?? '';
}

export default function Lobby({
  you,
  guestId,
  leaderboard,
  quests,
  modes,
  selectedMode,
  onSelectMode,
  onSetAvatar,
  onSetTitle,
  onBuyAvatar,
  onBuyTitle,
  onClaimQuest,
  onRename,
  onPlay,
  account,
  onSignIn,
  onSignOut,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [titlePickerOpen, setTitlePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Brand-new players get the rules once, automatically, instead of having
  // to find the "?" button on their own.
  const [rulesOpen, setRulesOpen] = useState(() => !localStorage.getItem('battle-trade:seenRules'));
  const [shopOpen, setShopOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const avatar = you?.avatar || 'bull';
  const online = useOnlinePlayers();
  const ticker = useTicker(leaderboard, online);
  const [muted, toggleMuted] = useMuted();

  const crowd = leaderboard.slice(0, 6);
  const crowdExtra = Math.max(0, online - crowd.length);
  const claimable = (quests ?? []).filter((q) => q.complete && !q.claimed).length;
  const level = you?.level ?? levelFor(you?.coins);
  const activeMode = MODE_BY_ID[selectedMode] ?? MODE_BY_ID.classic;
  const xpPct = you?.xpForNextLevel ? Math.round((you.xpIntoLevel / you.xpForNextLevel) * 100) : 0;

  useEffect(() => {
    startAmbient();
    return () => stopAmbient();
  }, []);

  const scrollToLeaderboard = () => {
    document.getElementById('leaderboard-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="lobby-screen">
      <main className="lobby-main">
        <div className="lobby-topline">
          <div className="online-badge">
            <span className="online-dot" />
            {online.toLocaleString()} players online
          </div>

        </div>

        <div className="activity-ticker">
          <span key={ticker} className="activity-ticker-text">
            {ticker}
          </span>
        </div>

        <section className="player-hero">
          {/* Tap your own face to change it. No badge on top of it — the
              portrait is the control. */}
          <div className="avatar-block">
            <button
              type="button"
              className="avatar-circle avatar-circle-btn"
              onClick={() => setPickerOpen(true)}
              aria-label="Change avatar"
            >
              <Avatar id={avatar} />
            </button>
          </div>

          <h2 className="lobby-name">{you?.nickname}</h2>

          <div className="identity-badges">
            <span className="id-badge">Lv. {level}</span>
            <span className="id-badge">Win Streak {you?.streak ?? 0} ⚡</span>
            <span className="id-badge id-badge-coins">
              <CoinIcon size={12} />
              <CoinBurst value={you?.coins ?? 0} />
            </span>
            <div className="id-badge-title-wrap">
              <button type="button" className="id-badge id-badge-title" onClick={() => setTitlePickerOpen(true)}>
                {you?.title || 'Pick a title'} <span className="id-badge-edit">✎</span>
              </button>
            </div>
          </div>

          {you?.xpForNextLevel ? (
            <div className="xp-track" title={`${you.xpIntoLevel} / ${you.xpForNextLevel} XP to level ${level + 1}`}>
              <div className="lobby-xp">
                <div className="lobby-xp-fill" style={{ width: `${xpPct}%` }} />
              </div>
              <span className="xp-track-label">
                {you.xpIntoLevel}/{you.xpForNextLevel} XP
              </span>
            </div>
          ) : null}
        </section>

        <section className="mode-panel">
          <ModeSelect modes={modes} selected={selectedMode} onSelect={onSelectMode} bests={you?.bests} />

          <div className="play-block">
            <button type="button" className="play-btn" onClick={onPlay}>
              ▶ Play {activeMode.name}
            </button>
            <p className="lobby-hint">{activeMode.blurb ?? activeMode.tagline}</p>
          </div>
        </section>

        {crowd.length > 0 && (
          <div className="lobby-crowd">
            <span className="lobby-crowd-label">In the lobby</span>
            <div className="lobby-crowd-row">
              {crowd.map((p) => (
                <div key={p.guestId} className="crowd-avatar" title={p.nickname}>
                  <Avatar id={p.avatar} />
                </div>
              ))}
              {crowdExtra > 0 && <div className="crowd-avatar crowd-more">+{crowdExtra}</div>}
            </div>
          </div>
        )}
      </main>

      <aside className="lobby-rail" id="leaderboard-panel">
        {/* Quests live in the rail too, so the daily hook is visible without
            opening a modal. */}
        <div className="rail-card">
          <div className="rail-head">
            <h2>Daily Quests</h2>
            {claimable > 0 && <span className="rail-pill">{claimable} ready</span>}
          </div>
          <div className="rail-quests">
            {(quests ?? []).map((q) => {
              const pct = Math.round((q.progress / q.target) * 100);
              return (
                <button
                  type="button"
                  key={q.id}
                  className={`rail-quest ${q.complete && !q.claimed ? 'ready' : ''} ${q.claimed ? 'claimed' : ''}`}
                  onClick={() => (q.complete && !q.claimed ? onClaimQuest(q.id) : setQuestsOpen(true))}
                >
                  <span className="rail-quest-top">
                    <span className="rail-quest-label">{q.label}</span>
                    <span className="rail-quest-reward">
                      {q.claimed ? '✓' : <><CoinIcon size={11} />{q.reward}</>}
                    </span>
                  </span>
                  <span className="rail-quest-bar">
                    <span className="rail-quest-fill" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              );
            })}
            {(quests ?? []).length === 0 && <p className="text-dim">Loading today's quests…</p>}
          </div>
        </div>

        <Leaderboard entries={leaderboard} guestId={guestId} />
      </aside>

      {/* Fixed bottom nav — the primary navigation on mobile, where most
          players are. The page reserves space for it so it never covers
          the Play button. */}
      <nav className="bottom-ribbon">
        <button type="button" className="ribbon-btn" onClick={() => setProfileOpen(true)} aria-label="Profile and stats">
          👤
        </button>
        <button type="button" className="ribbon-btn ribbon-badged" onClick={() => setQuestsOpen(true)} aria-label="Daily quests">
          📋
          {claimable > 0 && <span className="ribbon-badge">{claimable}</span>}
        </button>
        <button type="button" className="ribbon-btn" onClick={() => setShopOpen(true)} aria-label="Shop">
          🛍️
        </button>
        <button type="button" className="ribbon-btn" onClick={scrollToLeaderboard} aria-label="Leaderboard">
          🏆
        </button>
        <button
          type="button"
          className="ribbon-btn"
          onClick={() => toggleMuted(!muted)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={!muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button type="button" className="ribbon-btn" onClick={() => setRulesOpen(true)} aria-label="How to play">
          ❓
        </button>
        <button type="button" className="ribbon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          ⚙️
        </button>
      </nav>

      {settingsOpen && (
        <SettingsModal
          nickname={you?.nickname}
          onRename={onRename}
          account={account}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {rulesOpen && (
        <HowToPlayModal
          onClose={() => {
            localStorage.setItem('battle-trade:seenRules', '1');
            setRulesOpen(false);
          }}
        />
      )}
      {titlePickerOpen && (
        <TitlePickerModal
          you={you}
          onSelect={onSetTitle}
          onBuy={onBuyTitle}
          onClose={() => setTitlePickerOpen(false)}
        />
      )}
      {pickerOpen && (
        <AvatarPickerModal
          you={you}
          onSelect={onSetAvatar}
          onOpenShop={() => {
            setPickerOpen(false);
            setShopOpen(true);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {shopOpen && (
        <ShopModal you={you} onBuy={onBuyAvatar} onEquip={onSetAvatar} onClose={() => setShopOpen(false)} />
      )}
      {questsOpen && <QuestsModal quests={quests ?? []} onClaim={onClaimQuest} onClose={() => setQuestsOpen(false)} />}
      {profileOpen && <ProfileModal you={you} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
