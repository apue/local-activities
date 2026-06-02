# Local Wechat2RSS Collector

This guide sets up the PoC source path from a Mac-local Wechat2RSS Docker
service to the deployed local-activities collector APIs.

The goal is operator-controlled ingestion:

```text
Mac Docker Wechat2RSS
-> local collector command
-> authenticated Vercel collector APIs
-> Supabase records
```

Do not expose the Wechat2RSS admin UI, token, or container port to the public
internet.

## Prerequisites

- Docker Desktop or Docker Engine with Compose support.
- Node.js 24 LTS and pnpm 11.
- A Wechat2RSS private deployment license.
- A WeChat Reading account that the operator can scan/login with.
- A collector API key and collector ID for the deployed app.

The deployed Vercel/Supabase boundary is verified separately by:

```bash
pnpm env:check --env-file .env.local --target local-app
pnpm smoke:admin-readonly --env-file .env.local
```

## Configure Wechat2RSS

Copy the local Wechat2RSS template:

```bash
cp .env.wechat2rss.example .env.wechat2rss
```

Fill:

- `LIC_EMAIL`
- `LIC_CODE`
- `RSS_TOKEN`

Keep the default binding unless you have a specific local-network reason to
change it:

```text
WECHAT2RSS_BIND_HOST=127.0.0.1
WECHAT2RSS_PORT=4000
RSS_HOST=127.0.0.1:4000
RSS_HTTPS=0
```

Start the service:

```bash
docker compose -f docker-compose.wechat2rss.yml --env-file .env.wechat2rss up -d
docker compose -f docker-compose.wechat2rss.yml --env-file .env.wechat2rss logs
```

Open the admin UI:

```text
http://127.0.0.1:4000
```

Use the service token from `RSS_TOKEN` or from the startup logs if the service
generated one.

## Login WeChat Reading

Wechat2RSS does not use your Mac browser profile as the login store. The browser
only opens the local admin UI and displays the QR/login flow. The container keeps
service state in the Docker volume.

In the Wechat2RSS admin UI:

1. Open `微信账号`.
2. Click `添加账号`.
3. Scan the QR code with WeChat.
4. If mobile WeChat asks for an abnormal-login or location check, complete it in
   the web page.

If the account enters risk control, do not bypass it. Wait for Wechat2RSS to
retry naturally or follow the official Wechat2RSS instructions for manual
recovery. The collector should surface this as `fetch_blocked` or
`login_required`.

## Add Official Accounts

Use the Wechat2RSS UI for early PoC onboarding:

- Paste a WeChat article URL into the subscription form.
- Or add by official account ID when known.

Adding a subscription can trigger an update task. Avoid repeatedly adding the
same account just to force refreshes.

## Configure The Collector

Copy the collector template:

```bash
cp .env.collector.example .env.collector
```

Fill:

- `COLLECTOR_API_KEY`
- `COLLECTOR_ID`
- `WECHAT2RSS_TOKEN`

`WECHAT2RSS_TOKEN` must match `RSS_TOKEN` in `.env.wechat2rss`.

For production Vercel:

```text
APP_BASE_URL=https://local-activities.vercel.app
COLLECTOR_BASE_URL=https://local-activities.vercel.app
```

## Smoke Check

Run a read-only Wechat2RSS check:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
```

Expected success shape:

```text
Wechat2RSS smoke kind=ok health=healthy accounts=1 articles=...
```

Expected operator-action failures:

- `missing=WECHAT2RSS_BASE_URL,WECHAT2RSS_TOKEN`: fill `.env.collector`.
- `failure=login_required`: scan/login an account in the Wechat2RSS UI.
- `failure=fetch_blocked`: account risk-control or provider fetch block.

## Run One Sync

After the read-only smoke is healthy, upload recent article snapshots:

```bash
pnpm collector:wechat2rss:once --env-file .env.collector
```

Expected success shape:

```text
Wechat2RSS sync kind=uploaded run=wechat2rss-... articles=... uploaded=...
```

This command is safe to run manually. It queries a bounded lookback window and
deduplicates articles within the run by article URL and content hash. Future
scheduling should call the same command or a wrapper around the same sync logic.

## Troubleshooting

`docker compose ... config` fails:

- Check `.env.wechat2rss` exists.
- Check Docker Compose is installed.
- To validate with the example file before creating `.env.wechat2rss`, run:

  ```bash
  WECHAT2RSS_ENV_FILE=.env.wechat2rss.example docker compose -f docker-compose.wechat2rss.yml --env-file .env.wechat2rss.example config
  ```

The admin UI does not load:

- Check `docker compose -f docker-compose.wechat2rss.yml --env-file .env.wechat2rss logs`.
- Check the port is not already used.
- Keep `WECHAT2RSS_BIND_HOST=127.0.0.1` for local-only access.

`pnpm smoke:wechat2rss` reports `login_required`:

- Open `http://127.0.0.1:4000`.
- Add or refresh a WeChat account.
- Complete QR login or verification in the UI.

`pnpm smoke:wechat2rss` reports `fetch_blocked`:

- Treat it as provider/account risk.
- Do not increase polling frequency.
- Wait or follow Wechat2RSS account recovery instructions.

`pnpm collector:wechat2rss:once` reports `collector_upload_failed`:

- Check `COLLECTOR_BASE_URL`.
- Check `COLLECTOR_API_KEY`.
- Run `/api/collector/ping` or the existing collector auth smoke when available.

## References

- Wechat2RSS deployment guide: https://wechat2rss.xlab.app/deploy/deploy
- Wechat2RSS configuration: https://wechat2rss.xlab.app/deploy/config
- Wechat2RSS API reference: https://wechat2rss.xlab.app/deploy/api
- Wechat2RSS usage guide: https://wechat2rss.xlab.app/deploy/guide
