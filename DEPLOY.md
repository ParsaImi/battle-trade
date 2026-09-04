# Deploying Battle Trade

Docker Compose, one public port. Everything runs on a single host.

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

Open `http://<public-ip>:<PUBLIC_PORT>/` in a browser.

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
