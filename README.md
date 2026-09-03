# Battle Trade

A fast, arcade-style chart-prediction game. You get a candlestick chart cut off
partway through — call whether it goes **Up**, **Down**, or **Hold** to sit the
round out. Win matches, earn coins, climb the weekly leaderboard.

> **It's a game.** Every chart is randomly generated and fake. The coins are
> fake too — there is no real money in Battle Trade, and nothing here is
> financial advice.

## Game modes

| Mode | How it works |
| --- | --- |
| ⚔️ **Classic 1v1** | Best of 3 against a rival, volleyball rules — you must lead by 2, so ties go to overtime. |
| 💀 **Survival** | Solo sudden death. No Hold button. One wrong call ends the run; each round survived pays more than the last. |
| ⚡ **Blitz** | A 60-second session clock, ~4 seconds per round. Your score is net correct calls. |
| 🎰 **High Stakes** | Wager coins up front against a sharper opponent. A win pays double, a draw refunds, a loss keeps it. |
| 🏆 **Gauntlet** | Three rivals back to back — Rookie, Pro, Legend — each more accurate than the last. Lose once and the run is over. |

## Scoring

Each round is scored `+1` for a correct call, `−1` for a wrong one, and `0` for
a Hold (or letting the timer run out). Holding risks nothing and earns nothing.

## Progression

- **Coins** from wins, daily quests, and a daily login bonus
- **XP and levels** on an escalating curve
- **Daily quests** — three per day, drawn from a pool by a day-seeded shuffle so
  everyone gets the same set
- **10 achievements**, tracked against lifetime stats
- **Avatar shop** — the only coin sink, purely cosmetic
- **Weekly leaderboard**, resetting every Monday (UTC)

## Running it

Two processes: a Node WebSocket server and a Vite dev server.

```bash
cd server && npm install && npm run dev
```

```bash
cd client && npm install && npm run dev
```

The client expects the server at `ws://localhost:8787`. Override with a
`VITE_WS_URL` environment variable if you host it elsewhere.

## How it's put together

```
server/
  src/index.js      WebSocket + HTTP entry point
  src/match.js      Mode-driven match state machine
  src/gameModes.js  Mode definitions (rounds, clocks, bot accuracy, payouts)
  src/store.js      Player state, coins, quests, achievements, persistence
  src/chart.js      Fake candlestick generation
client/
  src/App.jsx       Screen routing: name entry → lobby → matchmaking → match
  src/components/   UI
  src/hooks/        Socket, keyboard controls, local preferences
  src/lib/sound.js  Web Audio sound effects (no audio files)
```

The server is authoritative: it generates every chart, resolves every round,
and owns all coin and progression maths. The client only renders and sends
input.

Player state lives in `server/data.json`, which is created on first run and is
deliberately not committed. There are no accounts or passwords — a "guest id"
is generated in the browser and kept in `localStorage`.

## Notes

- The opponent in versus modes is the computer. It's presented as an ordinary
  trader with a name and avatar, but it is not a real player, and the game
  never claims otherwise.
- The "players online" figure and the trade-floor chatter are cosmetic
  atmosphere, not real presence data.
- Avatars are image files in `client/public/avatars/`. Drop a replacement at
  the same path to swap the art.
