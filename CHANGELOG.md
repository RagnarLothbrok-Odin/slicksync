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

[`private-release.yml`](./.github/workflows/private-release.yml) runs when a
`v*.*.*` tag is pushed, or when manually dispatched. Both triggers publish images.
It repeats the checks, builds natively for Linux amd64 and arm64, and publishes
a combined image to `ghcr.io/ragnarlothbrok-odin/slicksync:private`.

Only the moving `private` image tag is published. There is no version image tag,
public image workflow, beta trigger, automatic version bump, GitHub Release
creation, or automatic deployment to a server. A manual dispatch uses the selected
ref as `APP_VERSION`, so it can replace `:private` with a branch build.

## Preparing a release

Only publish when intentionally requested. Review changes since the latest
release tag, update the in-app changelog and root package version, and commit
those changes before tagging `v<version>`. Pushing that tag publishes the image;
a GitHub Release and release notes are separate steps. Update Bun's lockfile if
package metadata changes require it.
