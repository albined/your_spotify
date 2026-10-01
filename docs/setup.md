# Running this fork

Use the production Dockerfiles in this repository to build the fork. The
`yooooomi/your_spotify_*` images in the older Compose example belong to upstream.

## Docker

You need Git, Docker with Compose, and a Spotify application.

```sh
git clone https://github.com/albined/your_spotify.git
cd your_spotify
```

Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
For a local installation, register this redirect URI:

```text
http://127.0.0.1:8080/oauth/spotify/callback
```

Spotify requires an explicit loopback address such as `127.0.0.1` for local HTTP
redirects; `localhost` is not accepted. See its
[redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).
Copy the app's Client ID and Client Secret from its settings. If other people
will sign in, add them through the dashboard's user management for development mode.

Create `docker-compose-personal.yml` in the repository root:

```yaml
services:
  app:
    environment:
      SPOTIFY_PUBLIC: "your_client_id"
      SPOTIFY_SECRET: "your_client_secret"
```

This file is ignored by Git. Start the app:

```sh
docker compose -f docker-compose-prod.yml -f docker-compose-personal.yml up -d --build
```

Open <http://127.0.0.1:3000> and sign in with Spotify. The API runs on port 8080;
MongoDB stores its data in `db_data`. Historical exports can be imported from
Settings → Account → Import listening history.

For access from another machine, override `API_ENDPOINT` on both `app` and `web`,
and `CLIENT_ENDPOINT` on `app`, with URLs that the browser can reach. Use HTTPS
outside loopback and register `<API_ENDPOINT>/oauth/spotify/callback` with Spotify.
Keep the URLs consistent, including any path prefix.

## Configuration and backups

Add server settings under `services.app.environment` in the personal Compose file.

| Setting | Purpose |
| --- | --- |
| `API_ENDPOINT` | Browser-facing API URL; also set it on `web`. |
| `CLIENT_ENDPOINT` | Browser-facing web URL. |
| `MONGO_ENDPOINT` | Database connection; defaults to `mongodb://mongo:27017/your_spotify`. |
| `TIMEZONE` | Default statistics timezone; users can choose their own in Settings. |
| `CORS` | Allowed browser origins, comma-separated; usually unnecessary. |
| `LOG_LEVEL` | Use `info` for normal use; the supplied Compose file sets `debug`. |

Backups are optional and disabled by default. The
[imports and recovery guide](listening-time-imports.md#backups) covers scheduled
backups, backups before imports, persistent upload storage and restores. Its
backup Compose override uses the service name `server`; this production setup
uses `app`, so adapt the override name before combining them.

Before updating an existing installation, make a database backup. Then pull the
latest code and repeat the Compose command above. Startup runs database migrations.

## Development

With the same personal Compose file, run `./dev.sh` for development containers
with source mounts. The Dockerfiles use Node 25 and pnpm. For host-side checks:

```sh
pnpm install --frozen-lockfile
pnpm --filter @your_spotify/client typecheck
pnpm --filter @your_spotify/server typecheck
```

The old `LOCAL_INSTALL.md` describes the upstream Yarn setup; use the current
package scripts and Dockerfiles for this fork.
