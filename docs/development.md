# Development tooling

SlickSync is a Bun workspace. Run installs and shared commands from the repository root. The root package owns server dependencies and shared tools; `client` owns the Next.js application. Commit only the root `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
bun run type-check
bun run build
bun run test
bun run lint
```

`dev:private` and `dev:public` retain their instance-specific configuration. Existing environment requirements still apply.

## Lint and format

Biome extends Ultracite's core and Next presets, with four-space JavaScript indentation and a 100-character line width. Console logging and the existing hook dependency policy match the reference project. Server, scripts, and tests retain their CommonJS globals. Generated files, runtime data, and scratch directories are excluded.

- `bun run lint` checks client types and runs Biome without changing files.
- `bun run lint:fix` applies Biome's safe fixes. Review the diff before committing.
- `bun run format:check` checks formatting.
- `bun run format` writes formatting changes.

The initial strict Biome import exposes existing source diagnostics. Configuration and manifest files are formatted first; source cleanup belongs in separate, reviewable commits. A failing lint command is not a passing baseline.

## Test runner compatibility

`bun run test` launches the established Node test runner, which preserves per-file process isolation. Node remains a development and CI requirement for this command. The suite contains 843 tests. A prior full run passed; the latest cleanup verification passed 841, with two failures in the TCP checks in `test/vaultCheckerSafety.test.js`. Those checks need investigation before claiming a green full suite.

`bun run test:bun` runs the suite under Bun with file isolation and a 30-second test timeout. It currently passes 842 tests, with the TCP address-fallback test in `test/vaultCheckerSafety.test.js` failing. Keep this explicit compatibility check separate until its behavior is resolved; do not disable the test to make the migration pass.
