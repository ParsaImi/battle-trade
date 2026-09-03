import Modal from './Modal';
import { ACHIEVEMENTS } from './achievements';
import Avatar from './Avatar';

function winRate(stats) {
  if (!stats?.matchesPlayed) return '—';
  return `${Math.round((stats.matchesWon / stats.matchesPlayed) * 100)}%`;
}

function accuracy(stats) {
  const calls = (stats?.roundsCorrect ?? 0) + (stats?.roundsWrong ?? 0);
  if (!calls) return '—';
  return `${Math.round((stats.roundsCorrect / calls) * 100)}%`;
}

export default function ProfileModal({ you, onClose }) {
  const stats = you?.stats ?? {};
  const unlocked = you?.achievements ?? [];
  const xpPct = you?.xpForNextLevel ? Math.round((you.xpIntoLevel / you.xpForNextLevel) * 100) : 0;

  return (
    <Modal onClose={onClose} width={420}>
      <div className="profile-head">
        <div className="profile-avatar"><Avatar id={you?.avatar} /></div>
        <div className="profile-head-text">
          <h3 className="modal-title profile-name">{you?.nickname}</h3>
          {you?.title && <span className="profile-title">{you.title}</span>}
        </div>
      </div>

      <div className="xp-block">
        <div className="xp-row">
          <span className="xp-level">Level {you?.level ?? 1}</span>
          <span className="xp-count">
            {you?.xpIntoLevel ?? 0} / {you?.xpForNextLevel ?? 100} XP
          </span>
        </div>
        <div className="xp-bar">
          <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-cell">
          <span className="stat-num">{stats.matchesPlayed ?? 0}</span>
          <span className="stat-label">Matches</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{stats.matchesWon ?? 0}</span>
          <span className="stat-label">Wins</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{winRate(stats)}</span>
          <span className="stat-label">Win rate</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{accuracy(stats)}</span>
          <span className="stat-label">Accuracy</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{stats.bestStreak ?? 0}</span>
          <span className="stat-label">Best streak</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{stats.roundsPlayed ?? 0}</span>
          <span className="stat-label">Rounds</span>
        </div>
      </div>

      <h4 className="section-heading">
        Achievements <span className="section-count">{unlocked.length}/{ACHIEVEMENTS.length}</span>
      </h4>
      <div className="achievement-grid">
        {ACHIEVEMENTS.map((a) => {
          const got = unlocked.includes(a.id);
          const value = stats[a.metric] ?? 0;
          return (
            <div key={a.id} className={`achievement ${got ? 'earned' : ''}`} title={`${a.desc}${got ? '' : ` (${Math.min(value, a.target)}/${a.target})`}`}>
              <span className="achievement-icon">{got ? a.icon : '🔒'}</span>
              <span className="achievement-label">{a.label}</span>
            </div>
          );
        })}
      </div>

      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
