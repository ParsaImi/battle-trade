import CoinIcon from './CoinIcon';
import Avatar from './Avatar';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Leaderboard({ entries, guestId }) {
  return (
    <div className="leaderboard">
      <h2>Weekly Leaderboard</h2>
      {entries.length === 0 && <p className="text-dim">No coins earned yet this week — be the first.</p>}
      <ol>
        {entries.map((e, i) => (
          <li key={e.guestId} className={`${e.guestId === guestId ? 'is-you' : ''} ${i < 3 ? `rank-${i + 1}` : ''}`}>
            <span className="rank">{MEDALS[i] ?? `#${i + 1}`}</span>
            <Avatar id={e.avatar} className="lb-avatar" />
            <span className="name">
              {e.nickname}
              {e.title && <span className="lb-title">{e.title}</span>}
            </span>
            <span className="coins">
              <CoinIcon size={14} />
              {e.weeklyCoins.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
