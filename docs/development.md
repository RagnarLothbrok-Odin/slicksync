# Development tooling

SlickSync is a Bun workspace. Run installs and shared commands from the repository root. The root package owns server dependencies and shared tools; `client` owns the Next.js application. Commit only the root `bun.lock`.

## Local setup

Install the Bun version declared in the root `packageManager` field, then run
`bun install --frozen-lockfile` from the repository root. Copy `.env.example` to
`.env` and configure private login credentials and a random `JWT_SECRET`.

For local SQLite development, add `DATABASE_URL="file:./dev.db"` to `.env`.
Prisma resolves this relative path beside the schema in `prisma/`.
Select the schema, generate the client, and create the local database:

```sh
cp prisma/schema.sqlite.prisma prisma/schema.prisma
bunx --no-install prisma generate
bunx --no-install prisma db push --schema prisma/schema.prisma
bun run dev
```

Open `http://localhost:3000`. The backend listens on port 4000 and the frontend
proxies `/api` requests to it. Use a separate development database; these commands
are for a fresh local setup, not a production migration.

```sh
bun run type-check
bun run build
bun run test
bun run lint
```

`dev:private` and `dev:public` are legacy convenience scripts with fixed development
credentials. Prefer `bun run dev` with your own environment configuration. Public
mode additionally needs a PostgreSQL database and the PostgreSQL Prisma schema.

## Lint and format

Biome extends Ultracite's core and Next presets, with four-space JavaScript indentation and a 100-character line width. Console logging and the existing hook dependency policy match the reference project. Server, scripts, and tests retain their CommonJS globals. Generated files, runtime data, and scratch directories are excluded.

- `bun run lint` checks client types and runs Biome without changing files.
- `bun run lint:fix` applies Biome's safe fixes. Review the diff before committing.
- `bun run format:check` checks formatting.
- `bun run format` writes formatting changes.

The shared preset is adapted to the existing project rather than forcing structural rewrites:

- File names may use camelCase, PascalCase, or kebab-case, matching server utilities, React components, and existing route modules.
- Serial awaits remain valid for ordered provider writes and bounded polling. JSX callbacks and inline regular expressions are not rejected solely on speculative performance grounds; hoisting a stateful global regex can change behavior.
- Native confirmation dialogs and encrypted-backup passphrase prompts remain permitted. Component and theme overrides keep their deliberate CSS cascade without a global selector ordering requirement.
- Native image elements remain valid for arbitrary provider artwork and authenticated image paths. Image dimensions are still checked.
- Async API implementations may return immediately without an artificial await. Nullish equality checks keep their defined handling of both null and undefined. Bitwise operations remain available for binary codecs.
- Defensive boundary checks remain valid even when a static type assumes the value is present. Existing handler size is not used as a reason to force structural rewrites during cleanup.
- Existing ternaries, loop increments, object access, public parameter order, deliberate switch fallthrough to no action, barrel exports, property deletion, forEach, and explicit fire-and-forget void calls are allowed.

Type-safety, correctness, security, accessibility, unused-code, and formatting checks remain enabled. A failing lint command is not a passing baseline.

## Tests

`bun run test` runs the full suite under Bun with per-file isolation and a 30-second timeout. The latest verification passed all 845 tests under both Bun and Node. TCP safety tests synchronize with the listener accepting a connection, so they do not depend on event-loop timing.

The obsolete Node retry runner and stdout redirection shim have been removed. Test failures now fail the command directly without an automatic second run.
