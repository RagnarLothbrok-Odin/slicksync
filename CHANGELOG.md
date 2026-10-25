# Changelog

The in-app version history lives in
[`client/public/changelog.json`](./client/public/changelog.json). Existing entries
include inherited upstream releases and do not all describe changes made by this
independent fork. New entries should describe this fork's changes.

## Checks

[`checks.yml`](./.github/workflows/checks.yml) runs on pushes to `main`, pull
requests, and manual dispatch. It installs the Bun workspace with the frozen
lockfile, runs the tests, then runs lint and TypeScript checks. It does not build
or publish an image. Branch protection must be configured separately to require it.

## Container publishing

[`release.yml`](./.github/workflows/release.yml) runs when a stable GitHub Release
is published. It validates that the `v<major>.<minor>.<patch>` tag matches the
root package version, runs tests and lint once, then builds private and public
modes natively for Linux amd64 and arm64.

After all four builds succeed, it publishes combined architecture manifests to
`ghcr.io/ragnarlothbrok-odin/slicksync` with these tags:

| Mode | Moving tag | Version tag example |
|---|---|---|
| Private / SQLite | `private` | `private-v1.102.0` |
| Public / PostgreSQL | `public` | `public-v1.102.0` |

Draft releases, prereleases and tag pushes alone do not publish images. There is
no manual branch publishing, beta channel, automatic version bump, GitHub Release
creation, or automatic deployment to a server. Image publishing runs after the
GitHub Release is public, so wait for the workflow to finish before pulling.

## Preparing a release

Only publish when intentionally requested. Review changes since the latest
release tag, update the in-app changelog and root package version, and commit
those changes before tagging `v<version>`. Publish a stable GitHub Release
for that tag to publish the images. Include release notes when preparing the
GitHub Release. Update Bun's lockfile if package metadata changes require it.
