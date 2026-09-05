import Avatar from './Avatar';
import CoinIcon from './CoinIcon';
import './TournamentView.css';

// The bracket, shown between ties. Everything here comes from the server —
// the client never decides who advanced.
export default function TournamentView({ bracket, finished, onLeave }) {
  if (!bracket) return null;
  const { rounds, roundName, prize, champion, complete } = bracket;
  const roundLabels = ['Quarter-finals', 'Semi-finals', 'Final'];

  return (
    <div className="tournament-screen">
      <div className="tournament-head">
        <h2 className="tournament-title">
          {complete ? 'Tournament over' : roundName}
        </h2>
        <span className="tournament-pot">
          <CoinIcon size={14} /> {prize.toLocaleString()} pot
        </span>
      </div>

      {complete && champion && (
        <div className={`tournament-champion ${champion.you ? 'is-you' : ''}`}>
          <div className="tournament-champ-avatar">
            <Avatar id={champion.avatar} />
          </div>
          <span className="tournament-champ-name">
            {champion.you ? 'You won it' : `${champion.nickname} took it`}
          </span>
          {champion.you && (
            <span className="tournament-champ-prize">
              <CoinIcon size={14} /> +{prize.toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="bracket">
        {rounds.map((ties, r) => (
          <div key={r} className="bracket-round">
            <span className="bracket-round-label">{roundLabels[r] ?? `Round ${r + 1}`}</span>
            {ties.map((tie, i) => (
              <div key={i} className="bracket-tie">
                {[tie.a, tie.b].map((p, k) => {
                  const won = tie.winner === p.seat;
                  const decided = tie.winner !== null;
                  return (
                    <div
                      key={k}
                      className={`bracket-seat ${p.you ? 'is-you' : ''} ${
                        decided ? (won ? 'won' : 'lost') : ''
                      }`}
                    >
                      <div className="bracket-avatar">
                        <Avatar id={p.avatar} />
                      </div>
                      <span className="bracket-name">{p.you ? 'You' : p.nickname}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="tournament-note">
        {complete
          ? 'Every entry went into the pot. The winner takes all of it.'
          : 'Win your tie to go through. Three wins takes the pot.'}
      </p>

      {(complete || finished) && (
        <div className="modal-actions">
          <button type="button" onClick={onLeave}>
            Back to lobby
          </button>
        </div>
      )}
    </div>
  );
}
