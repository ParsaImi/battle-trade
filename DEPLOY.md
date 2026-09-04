# Deploying Battle Trade

Docker Compose on a single host. **Play at <https://194-5-97-185.sslip.io/>**.

> ## Serve it over HTTPS. This is not optional.
>
> Iranian ISPs (and other filtered networks) let the WebSocket *handshake*
> through and then drop the frames that follow. The socket upgrades, goes
> silent, and the game shows a red connection dot forever. Measured against
> this box from an affected network, same moment:
>
> | | `ws://…:80/ws` | `wss://…:443/ws` |
> |---|---|---|
> | handshake opened | no | yes (603ms) |
> | frames received | 0 | full session |
>
> Under TLS the frames are opaque and the connection survives. The client
> follows the page protocol, so serving over https switches it to `wss://`
> with no code change. `FORCE_HTTPS=1` redirects http to https.

```
internet ──▶ :${PUBLIC_PORT} ──▶ web (nginx) ──┬──▶ /     static React bundle
                                               └──▶ /ws   proxy ──▶ server:8787
```

The game server is **not** published to the host — nginx is the only way in.
That means one firewall port, no CORS, and `wss://` works automatically if you
put TLS in front later, because the client follows the page's protocol.

---

## First deploy

Install Docker (Ubuntu):

```bash
curl -fsSL https://get.docker.com | sh
```

Then, on the server:

```bash
git clone https://github.com/ParsaImi/battle-trade.git
cd battle-trade
cp .env.example .env      # edit PUBLIC_PORT if 80 is taken
docker compose up -d --build
```

Check it:

```bash
docker compose ps
curl -s localhost:${PUBLIC_PORT:-80}/health
```

`/health` returns `{"ok":true,...}` proxied from the game server, so a good
response proves nginx *and* the server *and* the link between them.

### Get a trusted certificate

```bash
./scripts/issue-cert.sh
```

That obtains a Let's Encrypt certificate for `TLS_HOST`, installs it where
nginx reads it, and turns on the http→https redirect. The `certbot` service
renews every 12h; nginx reloads every 6h to pick up the new file.

**Why `sslip.io`?** A bare IP cannot be given a publicly trusted certificate.
`194-5-97-185.sslip.io` resolves straight back to `194.5.97.185`, needs no
registration or DNS of your own, and is on the Public Suffix List so Let's
Encrypt treats it as its own domain for rate limits. If you get a real domain,
point an A record at this box, change `TLS_HOST` in `.env`, and re-run the
script — nothing else changes.

Until a certificate is issued the entrypoint generates a self-signed one so
the container still boots. That works technically but every visitor gets a
browser warning and some browsers refuse outright, so do not ship on it.

Then open **<https://194-5-97-185.sslip.io/>**.

## Updating

```bash
git pull
docker compose up -d --build
```

Player data survives — it lives in the `player-data` named volume, not the
image.

## Player data

`data.json` is written to `/app/data` inside the server container, backed by
the `player-data` volume.

Back it up:

```bash
docker compose cp server:/app/data/data.json ./data-backup-$(date +%F).json
```

Restore:

```bash
docker compose cp ./data-backup-2026-09-04.json server:/app/data/data.json
docker compose restart server
```

> `DATA_DIR` must point at a **directory**, never at the file. Saves write a
> temp file and `rename()` it over `data.json`; renaming across a
> bind-mounted single file fails with `EBUSY`.

## Logs

```bash
docker compose logs -f server
docker compose logs -f web
```

## Firewall

```bash
sudo ufw allow ${PUBLIC_PORT:-80}/tcp
```

## Things worth knowing

- **`VITE_WS_URL` is baked in at build time**, not read at runtime. Leave it
  empty for this single-origin setup. Setting it as a container environment
  variable does nothing — it has to be a build arg.
- **Graceful shutdown works here** (unlike on Windows). `docker compose stop`
  sends SIGTERM, `init: true` forwards it to node, and the server flushes
  player data synchronously before exiting.
- **nginx re-resolves the upstream** through Docker's DNS every 10s, so a
  restarted server container with a new IP is picked up without a reload.
- Adding TLS later: put Caddy or nginx+certbot in front on 443 and proxy to
  the `web` container. No client rebuild needed.
