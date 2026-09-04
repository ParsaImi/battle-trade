# Battle Trade — Project Handoff

> Paste this whole file into a new chat to resume development with full context.

**Repo:** https://github.com/ParsaImi/battle-trade
**Local path:** `C:\Users\pc\Desktop\Claude\battle-trade`
**Status:** Playable end-to-end. Frontend feature-complete for v1; backend hardened and tested.

---

## 1. What this is

A browser game where players predict whether a **fake, randomly-generated** candlestick chart
will go up or down. No real money, no real market data, no financial advice — the charts are a
random walk generated server-side. Coins are worthless in-game currency.

Core loop: pick a mode → matchmaking animation → see a partial chart → call Up / Down / Hold →
chart animates to reveal the outcome → win coins → spend them on cosmetics.

Mobile-first (most players are expected on phones).

---

## 2. Running it

Two processes. Both must run.

```bash
cd battle-trade/server && npm install && npm run dev
```

```bash
cd battle-trade/client && npm install && npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:8787 (health check at `/health`)
- **LAN / phone access:** both bind `0.0.0.0`. Open `http://<your-lan-ip>:5173` on a phone on the
  same Wi-Fi. The server logs its LAN addresses on startup.

Backend tests: `cd server && npm test` — 43 checks: `test/hardening.mjs` (11, see §9) and
`test/pvp.mjs` (32, matchmaking and PvP). `npm run test:pvp` runs just the latter.

**Deployed:** <http://194.5.97.185/> — Docker Compose on an Ubuntu VPS, one public port.
See `DEPLOY.md` for the runbook (build, update, back up player data, logs).

Env vars (server): `PORT`, `HOST`, `ALLOWED_ORIGINS`, `DATA_DIR` (save directory — must be a
directory, not the file), `MATCH_WAIT_MS` (queue wait before the AI fallback, default 30000),
`PREMATCH_MS` (VS card + countdown, default 3600).
Env vars (client): `VITE_WS_URL`, `VITE_WS_PORT` — normally unnecessary; the client derives the
WebSocket host from the page URL.

---

## 3. Architecture

```
battle-trade/
├── server/                     Node + Express + ws. Authoritative for ALL game logic.
│   ├── src/
│   │   ├── index.js            HTTP + WebSocket server, message routing, rate limiting,
│   │   │                       heartbeat, graceful shutdown
│   │   ├── match.js            Match class — mode-aware round/phase state machine
│   │   ├── chart.js            Fake candlestick generation (random walk)
│   │   ├── store.js            Player records, coins, stats, quests, persistence
│   │   ├── gameData.js         Avatar catalog, quest pool, achievements, XP curve
│   │   ├── gameModes.js        The 5 game mode definitions
│   │   ├── matchmaking.js      PvP queue — pairs waiting players, 30s AI fallback
│   │   ├── opponents.js        Server-owned opponent identity (AI and real players)
│   │   └── logger.js           Timestamped logger
│   ├── test/hardening.mjs      Backend abuse/durability test suite
│   └── data.json               Player save file (gitignored; auto-created)
└── client/                     React 19 + Vite 8
    ├── public/avatars/*.svg    9 pixel-art avatar images
    └── src/
        ├── App.jsx             Screen router: nickname → lobby → matchmaking → match
        ├── App.css             ~2900 lines. Single stylesheet, CSS custom properties
        ├── components/         ~28 components
        ├── hooks/              useGameSocket, useGuest, useKeyboardControls, useMuted, ...
        └── lib/sound.js        Web Audio sound engine (no audio files)
```

**Key architectural rule:** the server is authoritative. The client renders state and sends
intents. Never move scoring, payouts, or validation into the client.

**Client mirrors that must stay in sync with the server** (duplicated deliberately, since the two
packages don't share a module):
- `client/src/components/avatars.js` ↔ `server/src/gameData.js` (AVATAR_CATALOG)
- `client/src/components/achievements.js` ↔ `server/src/gameData.js` (ACHIEVEMENTS)
- `client/src/components/gameModes.js` ↔ `server/src/gameModes.js`
- `client/src/components/titles.js` ↔ `server/src/store.js` (TITLES)
- `MatchView.jsx` `VISIBLE_COUNT = 28` ↔ `server/src/chart.js`

---

## 4. Game mechanics

### Chart
40 candles generated per round via random walk from price 100. First **28** shown during the
guess phase; the remaining 12 are the reveal. Direction = final close vs. close at candle 28.

### Scoring (per round)
| Call | Result |
|---|---|
| Up/Down correct | **+1** |
| Up/Down wrong | **−1** |
| Hold | **0** — no gain, no loss, no flash, no sound |
| Timed out (no call) | **0** — treated as Hold, except in Survival where it ends the run |

The opponent always calls Up/Down (never Hold) at its mode's accuracy.

### The 5 modes

| Mode | Structure | Opponent | Payout |
|---|---|---|---|
| **Classic 1v1** ⚔️ | Min 3 rounds, then **win by 2** (volleyball rule), cap 11 | **a real player**, else 50% AI | 80–120 × streak multiplier |
| **Survival** 💀 | Endless, sudden death. **Hold disabled.** Timeout = death | none (solo) | escalating: `10 + 5n` per round survived |
| **Blitz** ⚡ | 60-second session clock, 4s per round | none (solo) | 25 × net points |
| **High Stakes** 🎰 | Like Classic; wager 100/250/500/1000 up front | **58%** | win = 2× wager, draw = refund, loss = 0 |
| **Gauntlet** 🏆 | 3 stages × 3 rounds, must lead to advance | Rookie 50% → Pro 62% → Legend 72% | 200/stage + 1200 clear bonus |

Solo modes do **not** affect the win streak.

### Economy
- Daily login bonus: **50** coins
- Classic/Gauntlet win: `randomInt(80,120) × min(streak, 5)`
- Draw: 25 coins
- Streak is **uncapped** for display ("Win Streak 17 ⚡") but the payout multiplier caps at **5×**
- Avatars: 3 free (`nomad`, `reaper`, `coder`) + 6 paid — 300 / 600 / 1000 / 1500 / 2500 / 5000

### Progression
- **XP:** win 50, draw 25, loss 15, +5 per correct call
- **Level curve:** 100 XP for L2, each level costs ×1.15 more
- **Daily quests:** 3 per day drawn from a pool of 8 by a day-seeded shuffle (same set all day,
  resets at UTC midnight). Claimable for coins.
- **Achievements:** 10 lifetime, auto-unlock, announced by toast

---

## 5. WebSocket protocol

**Client → Server:** `register`, `set_avatar`, `set_title`, `set_nickname`, `buy_avatar`,
`claim_quest`, `find_match`, `cancel_match`, `match_guess`, `leave_match`

`start_match` is the old name for `find_match` and still works, so a client loaded before the PvP
update keeps functioning.

**Server → Client:** `registered`, `lobby`, `matchmaking`, `match`, `purchase`, `quest_claimed`,
`match_error`

`matchmaking` carries `{ status }`: `searching` (`waitMs`, `startedAt`), `found` (`opponent`,
`startsAt`, `pvp`) or `cancelled` (`reason`). The server owns the pre-match countdown so both
players in a PvP match start round one together.

`lobby` carries `{ you, leaderboard, quests, modes }`. `match` carries the full public match state
(phase, round, scores, candles, roundOutcome, matchResult).

All non-`register` messages require a registered connection. Unknown types are ignored.

---

## 6. Player record shape (`data.json`)

```js
{
  "<guestId>": {
    nickname, avatar, title,
    coins, weeklyCoins, weekKey,      // weekly leaderboard resets Monday UTC
    streak,                            // uncapped consecutive wins
    xp, lastBonusDay,
    unlockedAvatars: [],
    achievements: [],
    bests: { survival, blitz },        // personal bests
    modeStats: { <mode>: {played, won} },
    stats: { matchesPlayed, matchesWon, matchesLost, matchesDrawn,
             roundsPlayed, roundsCorrect, roundsWrong, roundsHeld,
             bestStreak, lifetimeCoins },
    questState: { dayKey, progress: {...}, claimed: [] }
  }
}
```

`ensureShape()` in `store.js` backfills every field on load, so old save files keep working.
**Always add new fields there** when extending the record.

---

## 7. What's built

**Identity & progression** — guest accounts (no login, localStorage id), nicknames + rename,
9 image avatars, 6 equippable titles, XP/levels, 10 achievements, lifetime + per-mode stats,
weekly leaderboard.

**Gameplay** — 5 modes, Up/Down/Hold, win-by-2 overtime, near-miss feedback, swing % readout,
keyboard controls (↑/↓/Space, hidden on touch).

**Economy** — coins, avatar shop, daily bonus, daily quests with claim, wagering.

**Feel** — matchmaking sequence (search → opponent found → 3/2/1 countdown), win/loss screen
flash, confetti, celebration mode on 3+ streak, coin pop with particles, animated counters,
market chatter bubbles, player-triggered emotes, ambient lobby audio, procedural Web Audio SFX
(cha-ching on profit, dry thud on loss, streak-scaled win fanfare).

**UI** — glassmorphism on a violet/cyan palette with an animated aurora background, mobile-first
responsive, bottom nav bar, modals for shop/quests/profile/settings/rules, first-run tutorial.

**Backend hardening** — see §9.

---

## 8. What still needs doing

### High priority
1. **Countdown redesign — IN PROGRESS, INCOMPLETE.** I started replacing the plain 3/2/1 in
   `Matchmaking.jsx` with a 7-segment LED display (ticker/terminal style) and did not finish.
   Current code still renders plain numbers in `.mm-countdown-number`. Either finish or revert.
2. **Replace the placeholder Discord link** — `client/src/components/SettingsModal.jsx` has
   `https://discord.gg/replace-with-your-invite`. It's live on a public repo.
3. ~~**Deployment.**~~ **DONE (2026-09-04).** Live on an Ubuntu VPS at <http://194.5.97.185/> via
   Docker Compose. nginx serves the built client and reverse-proxies the WebSocket at `/ws` on the
   same origin, so the whole game runs on **one public port** — no CORS, and `wss://` will work
   unchanged once TLS is added. Runbook: `DEPLOY.md`. `VITE_WS_URL` is deliberately left empty.
4. **`data.json` won't scale.** Whole-file rewrite on every save, entire dataset in memory. Fine
   for tens of players; replace with SQLite (better-sqlite3) before real traffic.

### Medium
5. ~~**Real multiplayer.**~~ **DONE for Classic 1v1 (2026-09-04).** A server-side queue pairs two
   waiting players; after 30s with nobody found (`MATCH_WAIT_MS`) the player gets an AI opponent.
   `Match` now has two seats and `publicState(viewerId)` renders it per player. Still open:
   **reconnect** — a refresh mid-match forfeits rather than rejoining. Survival/Blitz are solo and
   Gauntlet is a scripted AI ladder, so neither should be PvP; **High Stakes could be**, but needs
   a zero-sum wager rule decided first (today the house pays the winner). The queue already keys
   on wager, so enabling it is `pvp: true` in `gameModes.js` plus tests.
6. **Anti-cheat.** Nothing stops opening two tabs with different guest ids. Fine for a casual
   game; matters if leaderboards become competitive.
7. ~~**Server-side opponent identity.**~~ **DONE.** `client/src/components/bot.js` is gone;
   `server/src/opponents.js` decides the identity when the match is announced, so the "found" card
   and the match always agree and it no longer changes on refresh.
8. **Sound polish** — the brief mentioned layered "crowd reaction" on massive wins; currently
   approximated with oscillators. Real samples would be better.
9. **More coin sinks** — only avatars today. Title unlocks, chart themes, emote packs.

### Low
10. Match history / replays, friends, seasons, push notifications, i18n (the owner is a Persian
    speaker — RTL support may matter), accessibility pass (focus rings, screen-reader labels).

---

## 9. Backend hardening (done — with a real bug found)

**Critical bug found and fixed:** sending the literal text `null` over the WebSocket crashed the
**entire server**, disconnecting every player. `JSON.parse("null")` returns `null`, then
`msg.type` threw *outside* the try/catch. A 4-character remote DoS. Reproduced, then fixed.

Now in place:
- Payload validated as a plain object with a string `type`; whole handler wrapped in try/catch;
  `uncaughtException`/`unhandledRejection` log instead of exiting
- **Atomic saves** — write temp → keep `.bak` → rename. Recovers from a corrupt save on startup.
  Debounce 1000ms → 400ms
- **Rate limiting** — token bucket (30 burst, 12/s refill) + 750ms `start_match` cooldown
- **16KB** max WebSocket frame
- **Heartbeat** ping/pong every 30s, drops dead sockets and their orphaned match timers
- **Wager refund** if match construction throws
- `HOST`/`PORT`/`ALLOWED_ORIGINS` env config, timestamped logger, `/health` with uptime +
  connections + player count

`npm test` → 11 checks: malformed frames, pre-auth actions, bogus field values, 400-message
flood, oversized frame, health, durability, no temp file leaked, corrupt-save recovery.
All pass. One is **skipped on Windows** — see below.

---

## 10. Hard-won lessons (read this before debugging)

**Constructor callback fires before assignment (hit this TWICE).**
`this.onChange()` called synchronously inside a constructor runs *before* `const x = new Foo(...)`
finishes, so a callback closing over `x` sees `undefined` — or throws a TDZ error with `const`.
Fix: a `{ silent: true }` flag on the first phase, then send the initial state manually after
construction. Both `Match` and the old `RoundEngine` had this.

**Stale CSS overrides are invisible killers.**
Mobile mode tiles rendered as one word per line. Cause: a `@media (max-width:460px){ .mode-tile
{ width:92px } }` rule left over from an earlier horizontal-scroller design. Same class of bug hit
`.mode-tile-name { text-align:center }`. **When you redesign a component, grep for every rule
touching its classes** — App.css is ~2900 lines and later rules silently win.

**Windows can't deliver SIGTERM to a child process.**
`child.kill('SIGTERM')` maps to `TerminateProcess`; the handler never runs and exit code is
`null`. The graceful-shutdown flush is correct and matters on Linux, but is **unverifiable and
ineffective on Windows**. Local durability comes from atomic writes + the short debounce. The test
is explicitly skipped on win32 rather than left as a misleading pass.

> **Now confirmed working in Docker (2026-09-04).** `docker compose stop` produces
> `SIGTERM received — flushing player data` in the server log, and player data survived a full
> `down`/`up` cycle. The Linux path was correct all along — it was only ever unverifiable on
> Windows. `init: true` in compose is what forwards the signal to node.

**PowerShell reports success as failure.**
Redirecting a native command's stderr (`2>&1`) wraps output in an ErrorRecord and sets `$?` false
even on exit code 0. `git push` writes progress to stderr, so a successful push *looks* like a red
error. Read the actual output before believing a failure.

**`gh` stores its token in the Windows keyring, not `hosts.yml`.**
I checked for the config file, found nothing, and wrongly concluded login had failed. `gh auth
status` is the only reliable check.

**PATH doesn't refresh in running processes.**
After installing a CLI, already-open terminals keep the old PATH. Use the full binary path
(`& "C:\Program Files\GitHub CLI\gh.exe"`) or fully restart the terminal.

**React hooks must precede every early return.**
`MatchView` has `if (!match) return null` — all hooks (including `useCallback` for the keyboard
handler and the Blitz clock `useEffect`) must sit above it or the hook order changes between
renders and React throws.

**Migrating identifiers needs an alias map.**
Switching avatars from emoji ids (`bull`, `shark`) to image ids (`nomad`, `coder`) required
`LEGACY_AVATAR_ALIASES` in `gameData.js` so existing players kept their avatar *and their paid
purchases* (`wolf` → `trader`). Verified against real save data before shipping.

**The in-app browser sandbox blocks non-localhost WebSockets.**
LAN testing failed in the preview pane but worked from a Node client. Don't trust a preview-pane
network failure as an app bug.

**Some networks silently eat WebSocket upgrades (hit this during the deploy).**
After going live, `curl` from the dev machine to `http://194.5.97.185/ws` hung with **0 bytes**
received, while the identical request from the VPS itself returned `101 Switching Protocols`.
The giveaway: nginx's own access log showed `"GET /ws HTTP/1.1" 101` *for the dev machine's IP* —
the server answered correctly and the response was dropped in transit. Plain HTTP to the same
host was fine, so it is not a firewall or a port problem. **Check the server's access log before
blaming the app**, and confirm from a second network (a phone on mobile data).

**Two browser tabs on the same host share a guest id.**
The guest id lives in `localStorage`, which is per-origin — so two tabs on `localhost:5173` are
the *same player*, and the queue refuses to pair a player with itself. To test PvP locally, open
one tab on `http://localhost:5173` and the other on `http://127.0.0.1:5173`: different origins,
separate storage, two real players.

**Automated UI testing races real game timers.**
Tool round-trips often exceed a 10s guess phase, so matches finished between calls. Drive the game
from a single in-page script loop rather than one tool call per action.

---

## 11. Design decisions worth preserving

**Honesty stances.** Three separate requests pushed toward simulating other humans. Each was
delivered in a form that keeps the fun without fabricating people:
- The AI opponent is presented as an ordinary trader with a name and avatar, and is never
  *claimed* to be human.
- "Chat between players" → **unattributed** ambient trade-floor reaction bubbles, not messages
  from named individuals.
- "47 × 💀" reaction counts → **player-triggered** emotes only. No fabricated count of other
  people reacting.
- The "players online" number is cosmetic (random 100–200) — treat it as decoration, not data.

This matters if the game ever goes public: fake chat from named users and invented engagement
counts are the kind of thing that gets an app pulled.

**Hold = truly neutral.** No score change, no red/green flash, no sound. Deliberate — it's the
"sit this one out" option and any feedback would undermine it.

**Uncapped streak, capped multiplier.** The badge shows the real consecutive-win count for
bragging; payouts cap at 5×. The match-complete screen shows the *actual* multiplier applied, not
the raw streak, so the number is never a lie.

**Design references used:** Soccer Stars (mode hub), a dark glassmorphic food-delivery app
(glass panels, rounded cards). Palette intentionally kept violet/cyan + green/red rather than
copying the reference's orange.

**The three starter avatars are recreations.** The owner supplied three reference images; they
could not be extracted from chat, so they were rebuilt as pixel-art SVGs. To use the originals,
drop files at `client/public/avatars/<id>.svg` (or update `src` in `avatars.js` for `.png`).

---

## 12. Current git state

Clean — everything committed and pushed to `origin/main`, including the backend hardening, LAN
access, and the Docker Compose deployment.
