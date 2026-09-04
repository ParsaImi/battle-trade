import { useCallback, useEffect, useRef, useState } from 'react';
import CandlestickChart from './CandlestickChart';
import CoinIcon from './CoinIcon';
import MarketChatter from './MarketChatter';
import QuickEmotes from './QuickEmotes';
import Avatar from './Avatar';
import { playClick } from '../lib/sound';
import { useKeyboardControls } from '../hooks/useKeyboardControls';

const OUTCOME_TITLE = { win: 'You Win!', loss: 'You Lose', draw: 'Draw' };
const AUTO_RETURN_SECONDS = 8;
// Must match VISIBLE_COUNT in server/src/chart.js — used only to measure how
// dramatic a round's price swing was, for the market-chatter flavor text.
const VISIBLE_COUNT = 28;
const DRAMATIC_PCT = 0.02;
const BIG_DRAMATIC_PCT = 0.05;
// A wrong call this close to flat gets a "so close" instead of a flat "wrong" —
// near-misses sting in a way that keeps people playing one more round.
const NEAR_MISS_PCT = 0.004;

function swingPct(candles) {
  if (!candles || candles.length <= VISIBLE_COUNT) return null;
  const split = candles[VISIBLE_COUNT - 1]?.close;
  const final = candles[candles.length - 1]?.close;
  if (split == null || final == null) return null;
  return (final - split) / split;
}

function RoundResultText({ outcome, opponentName, nearMiss, solo }) {
  // Solo modes have no rival to report on.
  const botText = solo ? '' : outcome.botDelta > 0 ? `${opponentName} got it right.` : `${opponentName} got it wrong.`;

  if (outcome.playerGuess === 'hold') {
    return <>You held — no gain, no loss. {botText}</>;
  }
  if (outcome.playerGuess === null) {
    return <>Time ran out — no guess, no gain or loss. {botText}</>;
  }
  if (outcome.playerDelta > 0) {
    return <>You called it right! {botText}</>;
  }
  if (nearMiss) {
    return (
      <>
        <span className="near-miss">So close!</span> It barely moved the other way. {botText}
      </>
    );
  }
  return <>You called it wrong. {botText}</>;
}

export default function MatchView({
  match,
  you,
  opponent,
  onGuess,
  onLeave,
  onPlayAgain,
  remaining,
  onEmote,
  incomingEmote,
}) {
  // Server-supplied opponent profile. Solo modes send none.
  const oppName = opponent?.nickname ?? 'Opponent';
  const [autoReturn, setAutoReturn] = useState(null);
  const [chatter, setChatter] = useState(null);
  const wasCompleteRef = useRef(false);
  const chatterRoundRef = useRef(null);

  // Starts (or restarts) an auto-return-to-lobby countdown the moment the
  // match lands on its complete screen — like a post-match lobby that
  // doesn't wait forever for you to click through.
  useEffect(() => {
    const isComplete = match?.phase === 'complete';
    if (isComplete && !wasCompleteRef.current) {
      setAutoReturn(AUTO_RETURN_SECONDS);
    }
    if (!isComplete) {
      setAutoReturn(null);
    }
    wasCompleteRef.current = isComplete;
  }, [match?.phase]);

  useEffect(() => {
    if (autoReturn === null) return;
    if (autoReturn <= 0) {
      onLeave();
      return;
    }
    const t = setTimeout(() => setAutoReturn((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [autoReturn, onLeave]);

  // Ambient "trade floor" flavor bubbles on a dramatic round swing.
  useEffect(() => {
    if (!match || match.phase !== 'reveal' || !match.candles) return;
    if (chatterRoundRef.current === match.round) return;
    chatterRoundRef.current = match.round;

    const splitClose = match.candles[VISIBLE_COUNT - 1]?.close;
    const finalClose = match.candles[match.candles.length - 1]?.close;
    if (splitClose == null || finalClose == null) return;
    const pct = (finalClose - splitClose) / splitClose;
    if (Math.abs(pct) < DRAMATIC_PCT) return;

    setChatter({ key: `${match.round}-${Date.now()}`, direction: pct > 0 ? 'up' : 'down', big: Math.abs(pct) >= BIG_DRAMATIC_PCT });
  }, [match?.phase, match?.round, match?.candles]);

  useEffect(() => {
    if (!match) chatterRoundRef.current = null;
  }, [match]);

  // Declared before the early return so hook order stays stable.
  const handleGuess = useCallback(
    (direction) => {
      playClick();
      onGuess(direction);
    },
    [onGuess],
  );

  useKeyboardControls({
    enabled: match?.phase === 'guess',
    onUp: () => handleGuess('up'),
    onDown: () => handleGuess('down'),
    onHold: () => (match?.holdAllowed === false ? null : handleGuess('hold')),
  });

  // Blitz session clock, ticking independently of the per-round timer.
  const [blitzLeft, setBlitzLeft] = useState(null);
  useEffect(() => {
    if (!match?.deadline) {
      setBlitzLeft(null);
      return;
    }
    const tick = () => setBlitzLeft(Math.max(0, Math.ceil((match.deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [match?.deadline]);

  if (!match) return null;

  const handlePlayAgain = () => {
    setAutoReturn(null);
    onPlayAgain();
  };

  const handleManualLeave = () => {
    setAutoReturn(null);
    onLeave();
  };

  if (match.phase === 'complete' && match.matchResult) {
    const r = match.matchResult;
    const { outcome, delta, multiplier, playerScore, botScore } = r;

    // Each mode reports its result in its own terms.
    let title = OUTCOME_TITLE[outcome];
    let scoreLine = (
      <>
        You {playerScore} — {botScore} {oppName}
      </>
    );

    if (r.mode === 'survival') {
      title = r.survivalScore > 0 ? `${r.survivalScore} Survived` : 'Knocked Out';
      scoreLine =
        r.endReason === 'timeout'
          ? 'The clock ran out on you.'
          : `You called ${r.survivalScore} in a row before the miss.`;
    } else if (r.mode === 'blitz') {
      title = playerScore > 0 ? `${playerScore} Points` : "Time's Up";
      scoreLine = `${r.rounds} rounds in 60 seconds.`;
    } else if (r.mode === 'gauntlet') {
      title = outcome === 'win' ? 'Gauntlet Cleared!' : `Fell at Stage ${r.stagesCleared + 1}`;
      scoreLine = `${r.stagesCleared} of ${r.stagesTotal} rivals beaten.`;
    }

    return (
      <div className="match-screen">
        <div className="match-complete-card">
          <span className="complete-mode-tag">
            {match.modeIcon} {r.modeName}
          </span>
          <h2 className={`outcome outcome-${outcome}`}>{title}</h2>
          {r.newBest && <p className="new-best-flag">🎉 New personal best!</p>}
          <p className="score-line">{scoreLine}</p>
          <p className="coin-line">
            {delta > 0 ? (
              <>
                <CoinIcon size={18} /> +{delta} coins
              </>
            ) : r.wager > 0 ? (
              `Lost your ${r.wager.toLocaleString()} coin wager`
            ) : (
              'No coins this time'
            )}
            {outcome === 'win' && !r.wager && multiplier > 1 ? ` (win streak x${multiplier})` : ''}
          </p>
          <div className="match-actions">
            <button type="button" onClick={handlePlayAgain}>
              Play Again
            </button>
            <button type="button" className="secondary" onClick={handleManualLeave}>
              Back to Lobby
            </button>
          </div>
          {autoReturn !== null && (
            <p className="auto-return-hint">Returning to lobby in {autoReturn}s…</p>
          )}
        </div>
      </div>
    );
  }

  const canGuess = match.phase === 'guess';
  const urgent = match.phase === 'guess' && remaining <= 3;
  const pct = swingPct(match.candles);
  const nearMiss = pct !== null && Math.abs(pct) < NEAR_MISS_PCT;
  const swingLabel = pct === null ? null : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`;

  // Gauntlet scores by stage; every other 1v1 mode by the running total.
  const myScore =
    match.mode === 'gauntlet'
      ? match.stagePlayerScore
      : match.mode === 'survival'
        ? match.survivalScore
        : match.playerScore;
  const theirScore =
    match.mode === 'gauntlet'
      ? match.stageBotScore
      : match.mode === 'survival'
        ? (match.opponentSurvivalScore ?? 0)
        : match.botScore;
  const youLeading = myScore > theirScore;
  const oppLeading = theirScore > myScore;

  return (
    <div className="match-screen">
      <div className="match-view">
        <div className="match-hud">
          <button type="button" className="leave-btn" onClick={handleManualLeave}>
            ← Lobby
          </button>
          {match.mode === 'blitz' ? (
            <div className={`blitz-clock ${blitzLeft !== null && blitzLeft <= 10 ? 'urgent' : ''}`}>
              ⚡ {blitzLeft ?? 60}s left
            </div>
          ) : match.mode === 'survival' ? (
            <div className="survival-counter">💀 Survived {match.survivalScore}</div>
          ) : match.mode === 'gauntlet' ? (
            <div className="stage-badge">
              Stage {Math.min(match.stagesCleared + 1, match.stagesTotal)}/{match.stagesTotal} — {match.stageName}
            </div>
          ) : match.overtime ? (
            <div className="overtime-badge">OVERTIME — Round {match.round}</div>
          ) : (
            <div className="round-pips">
              {Array.from({ length: match.minRounds }).map((_, i) => {
                const roundNum = i + 1;
                const done = roundNum < match.round || (roundNum === match.round && match.phase !== 'guess' && match.phase !== 'reveal');
                const current = roundNum === match.round;
                return <span key={i} className={`pip ${done ? 'done' : ''} ${current ? 'current' : ''}`} />;
              })}
            </div>
          )}
          {canGuess && (
            <div className={`timer-badge ${urgent ? 'urgent' : ''}`}>
              {remaining}s
            </div>
          )}
        </div>

        {match.wager > 0 && (
          <div className="wager-banner">
            <CoinIcon size={14} /> {match.wager.toLocaleString()} on the line
          </div>
        )}

        {match.solo ? (
          <div className="solo-scoreboard">
            <div className="solo-avatar"><Avatar id={you?.avatar} /></div>
            <div className="solo-score-block">
              <span className="solo-score">
                {match.mode === 'survival' ? match.survivalScore : match.playerScore}
              </span>
              <span className="solo-score-label">
                {match.mode === 'survival' ? 'in a row' : 'points'}
              </span>
            </div>
          </div>
        ) : (
          <div className="matchup-row">
            <div className={`matchup-side ${youLeading ? 'leading' : ''}`}>
              <div className="matchup-avatar"><Avatar id={you?.avatar} /></div>
              <span className="matchup-name">{you?.nickname || 'You'}</span>
              <span className="matchup-score">{myScore}</span>
              {match.youAreOut && <span className="knocked-out">Out</span>}
            </div>
            <div className="matchup-vs">VS</div>
            <div className={`matchup-side ${oppLeading ? 'leading' : ''}`}>
              <div className="matchup-avatar"><Avatar id={opponent?.avatar} /></div>
              <span className="matchup-name">
                {match.mode === 'gauntlet' && !match.pvp ? match.stageName : oppName}
              </span>
              {/* Only a real person is badged. A bot is shown as an ordinary
                  trader and is never labelled live. Sits outside
                  .matchup-name, which clips its overflow. */}
              {match.pvp && <span className="live-badge">LIVE</span>}
              <span className="matchup-score">{theirScore}</span>
              {/* Survival: someone already out just watches the rest. */}
              {match.opponentIsOut ? (
                <span className="knocked-out">Out</span>
              ) : (
                /* Their call is in, but not what it was. */
                match.opponentLockedIn && <span className="locked-in">Locked in</span>
              )}
            </div>
          </div>
        )}

        <div className="chart-stage">
          <CandlestickChart
            candles={match.candles}
            roundId={match.round}
            direction={match.roundOutcome?.direction}
            chartMeta={match.chartMeta}
          />
          <MarketChatter triggerKey={chatter?.key} direction={chatter?.direction} big={chatter?.big} />
        </div>

        {match.phase !== 'guess' && swingLabel && (
          <div className={`swing-readout ${pct >= 0 ? 'up' : 'down'}`}>
            {swingLabel}
            <span className="swing-caption">this round</span>
          </div>
        )}

        <div className="guess-row">
          <button className="guess-btn up" disabled={!canGuess} onClick={() => handleGuess('up')}>
            ▲ Up <kbd className="key-hint">↑</kbd>
          </button>
          {match.holdAllowed !== false && (
            <button className="guess-btn hold" disabled={!canGuess} onClick={() => handleGuess('hold')}>
              ✋ Hold <kbd className="key-hint">space</kbd>
            </button>
          )}
          <button className="guess-btn down" disabled={!canGuess} onClick={() => handleGuess('down')}>
            ▼ Down <kbd className="key-hint">↓</kbd>
          </button>
        </div>

        <p className="hint">
          {match.phase === 'guess' &&
            (canGuess
              ? match.holdAllowed === false
                ? 'Call it. No holding in Survival — a miss ends the run.'
                : 'Predict this round — or Hold to sit it out.'
              : '')}
          {match.phase === 'reveal' && 'Revealing…'}
          {match.phase === 'results' && match.roundOutcome && (
            <RoundResultText
              outcome={match.roundOutcome}
              opponentName={match.solo ? 'The chart' : oppName}
              nearMiss={nearMiss}
              solo={match.solo}
            />
          )}
        </p>

        <QuickEmotes onSend={onEmote} incomingEmote={incomingEmote} opponentName={oppName} />
      </div>
    </div>
  );
}
