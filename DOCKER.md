# Docker

How the image is built and what runs inside it. For installing and updating,
follow the [README](./README.md#-setup); this describes the machinery
behind it.

## One image, two processes

Frontend and backend are built into a single image and started together by
`scripts/start.sh`, which is PID 1 in the container.

```
container
├── Next.js frontend   :3000   ← the only port you need to expose
└── Express backend    :4000   ← internal; the frontend proxies /api to it
```

Both ports are declared, but only `3000` is worth publishing. Put a reverse
proxy in front of it for TLS; SlickSync does not terminate TLS itself.

Keep internal ports at 3000 and 4000: the frontend proxy and image healthcheck use
these defaults. To avoid a host port collision, change the host mapping to
`"3001:3000"` in Compose.

## Build stages

The Dockerfile is multi-stage, and the last stage deliberately does not
inherit the build's dependency tree.

| Stage | What it does |
|---|---|
| `base` | Bun on Alpine, plus openssl and curl |
| `deps` | Installs everything, including what is only needed to build |
| `prod-deps` | Installs runtime dependencies only |
| `builder` | Generates the Prisma client and builds the frontend |
| `production` | Copies the runtime tree from `prod-deps`, the built app and the generated Prisma client from `builder` |

That split is why the published image does not carry Biome, concurrently or the
rest of the build tooling. Note that `prisma` itself is a runtime dependency,
not a build one: the start script applies the schema on every boot, so an
image without it would reach for the network at startup.

## Instance types

`INSTANCE` is a build argument. Stable releases publish both private and public images.

| | `:private` | `:public` |
|---|---|---|
| Database | SQLite in `/app/data` | PostgreSQL, separate container |
| Accounts | one instance, no signup | self-registered, isolated per account |
| Schema applied by | `prisma db push` on boot | `migrate deploy`, then a guarded push |

## Compose file

`docker-compose.private.yml` runs the single-household SQLite deployment and uses `ghcr.io/ragnarlothbrok-odin/slicksync:private` from this fork.

It reads `.env` (copy `.env.example`) and requires a real `JWT_SECRET`.

Build locally before starting if the fork image has not been published:

```sh
docker build --build-arg INSTANCE=private -t ghcr.io/ragnarlothbrok-odin/slicksync:private .
docker compose -f docker-compose.private.yml up -d --pull never
```

The release workflow publishes both modes to GHCR and needs no Docker Hub credentials.
Beta images are not published.

### Public deployment

`docker-compose.public.yml` runs the public image with PostgreSQL 16. Copy
`.env.example` to `.env`, set independent random `JWT_SECRET` and `ENCRYPTION_KEY`
values, and set `POSTGRES_PASSWORD` to a URL-safe value, for example the output of
`openssl rand -hex 32`. The app waits for PostgreSQL's healthcheck before starting.
Only frontend port 3000 is published; the database stays on the Compose network.

```sh
docker compose -f docker-compose.public.yml up -d
```

For a local source build before images are published:

```sh
docker build --build-arg INSTANCE=public -t ghcr.io/ragnarlothbrok-odin/slicksync:public .
docker compose -f docker-compose.public.yml up -d --pull never
```

Public mode allows account registration and isolates account data. Put the app
behind HTTPS before exposing it. Preserve both `pgdata` (PostgreSQL records) and
`slicksync_data` (files and backups), along with the encryption key. Do not switch
an existing private SQLite installation to public mode expecting automatic data
migration. Run the two modes as separate deployments if both are needed.

## The data volume

The compose file mounts a volume at `/app/data`. That directory holds
the SQLite database on private instances, and on every instance it holds the
generated encryption key, Vault backups, avatars and the poster cache.

It has to outlive the container. `docker compose pull && docker compose up -d`
replaces the container, and without the volume it takes the encryption key
with it; which would leave every stored provider credential unreadable.

## Looking inside

```bash
docker compose -f docker-compose.private.yml logs -f
docker compose -f docker-compose.private.yml exec slicksync sh
docker compose -f docker-compose.private.yml exec slicksync sh -c 'echo $APP_VERSION'
```

The image declares a healthcheck against both the frontend and backend, including
a backend database check, so `docker ps` reports
health without you polling anything.

## Environment

Everything configurable is documented in `.env.example`, which is the
authoritative list. The supplied Compose file requires `JWT_SECRET`. Public deployments need their
PostgreSQL connection configuration; the public Compose file supplies it from
`POSTGRES_PASSWORD` and requires an explicit `ENCRYPTION_KEY`. On a private instance an
encryption key generates itself on first boot and is kept in the data volume.

## Startup and updates

The frontend runs from `client/.next/standalone/client/server.js`, with its static
assets copied alongside it during the image build. The startup script launches
both processes and forwards shutdown signals.

Back up the data volume before updating. Private startup currently applies
`prisma db push --accept-data-loss --skip-generate` and continues even if that
command fails. It is schema synchronization, not a versioned migration or a
rollback mechanism. Review schema changes before deploying a new image.

The `private` filename and image tag identify the single-household application
mode, not repository or GHCR package visibility. Keep the explicit Compose filename
in commands. Published stable GitHub Releases produce moving `:private` and `:public` tags,
plus `:private-v<version>` and `:public-v<version>` tags for that release. Both
support Linux amd64 and arm64. To pin a deployment, change its Compose `image`
to the matching version tag. Record an image digest for an exact immutable pin.

Creating a draft, pushing a tag alone, or publishing a prerelease does not
publish images. The release tag must be `v<major>.<minor>.<patch>` and match the
root package version. Publishing images never updates a running server by itself.
