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

The shared preset is adapted to the existing project rather than forcing structural rewrites:

- File names may use camelCase, PascalCase, or kebab-case, matching server utilities, React components, and existing route modules.
- Serial awaits remain valid for ordered provider writes and bounded polling. JSX callbacks and inline regular expressions are not rejected solely on speculative performance grounds; hoisting a stateful global regex can change behavior.
- Native confirmation dialogs and encrypted-backup passphrase prompts remain permitted. Component and theme overrides keep their deliberate CSS cascade without a global selector ordering requirement.
- Native image elements remain valid for arbitrary provider artwork and authenticated image paths. Image dimensions are still checked.
- Async API implementations may return immediately without an artificial await. Nullish equality checks keep their defined handling of both null and undefined. Bitwise operations remain available for binary codecs.
- Defensive boundary checks remain valid even when a static type assumes the value is present. Existing handler size is not used as a reason to force structural rewrites during cleanup.
- Existing ternaries, loop increments, object access, public parameter order, deliberate switch fallthrough to no action, barrel exports, property deletion, forEach, and explicit fire-and-forget void calls are allowed.

Type-safety, correctness, security, accessibility, unused-code, and formatting checks remain enabled. A failing lint command is not a passing baseline.

## Test runner compatibility

`bun run test` launches the established Node test runner, which preserves per-file process isolation. Node remains a development and CI requirement for this command. The latest complete verification passed all 845 tests after correcting the TCP listener synchronization and a date-insensitive test fixture.

`bun run test:bun` runs the suite under Bun with file isolation and a 30-second test timeout. It currently passes 842 tests, with the TCP address-fallback test in `test/vaultCheckerSafety.test.js` failing. Keep this explicit compatibility check separate until its behavior is resolved; do not disable the test to make the migration pass.
