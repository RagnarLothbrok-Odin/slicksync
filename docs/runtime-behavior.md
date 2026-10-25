# Runtime behavior

Now Playing / History / Watch Time are fed by **two independent pipelines**. Which one owns what is not arbitrary -
each was chosen because the other physically cannot do that job. Changing this split has repeatedly reintroduced
old bugs, so read this before touching it.

| Signal | Source | Owns | Why not the other |
|---|---|---|---|
| **Proxy** (`proxyStreamMonitor.js`) | Polls AIOStreams' built-in proxy stats every 30s | **Live presence only**: Now Playing + the instant "started watching" Discord notification | It sees streams open/close in real time, but is blind to anything routed outside the proxy (e.g. usenet via newznab) |
| **Native** (`sessionTracker.js`, `metricsProcessor.js`) | Polls the provider's own library/watch state every 1m | **The record**: History, duration, Watch Time; for *every* source, usenet included | The provider only checkpoints at pause/stop, so it learns of a session late and then holds it "active" for ~18min (`isActivelyWatching()`'s freshness window, `sessionTracker.js`); useless as a liveness signal |

Rules that keep falling out of this, each fixing a real reported bug:

- **The proxy must never write watch history or durations.** A proxy connection's wall-clock lifetime is not watch
  time (AIOStreams keeps stale connections alive for hours; a 5-minute view once recorded as 22h, then accumulated
  across replays and inflated Watch Time Today to 54h). Native's `overallTimeWatched` deltas are the only real
  duration source.
- **Native must never be the sole basis for Now Playing.** Its freshness window kept an already-exited stream
  showing as playing for ~18 minutes (widened from 15min on 2026-07-20, see `isActivelyWatching()` in
  `sessionTracker.js` for the tuning history); and a single pause is enough to (re)start that window, confirmed
  against real production data, so a paused-but-not-stopped session can show as "playing" for the same length of
  time. `proxyNowPlaying.js`'s `RECENTLY_CLOSED_MS` must stay comfortably above this window; it was bumped in the
  same change to keep the same margin.
- **`mergeProxyNowPlaying` reconciles them per-title, not per-user.** The proxy is authoritative only for content it
  actually carries: it replaces native's entry for a title it's carrying, and suppresses native's *stale echo* of a
  title it recently finished. A title the proxy never carried (usenet) is left alone; native is the only truth for
  it. Suppressing per-user instead blanks out unrelated usenet playback.
- **Duration merges take `max()`, not `sum()`.** Both pipelines observe the *same* minutes; summing double-counted.
- **Recording a delta and advancing the snapshot baseline must be one transaction**; a restart between them made
  the next poll re-record the identical delta.
- **`state.timeOffset`/`timeWatched` and `state.overallTimeWatched` are NOT interchangeable, despite
  `sessionTracker.js` treating them as a `??` fallback chain in several places.** `timeOffset`/`timeWatched` is a
  per-item playback position, bounded by that item's own `state.duration`; safe to read at a single point in
  time. `overallTimeWatched` is cumulative across the account's whole viewing history and can run to absurd values
  (confirmed real example in `stremioWatchedDecoder.js`: `timeOffset` ≈ the current episode's ~54min runtime,
  `overallTimeWatched` ≈ 28.6 **hours** on the same item). `metricsProcessor.js`'s `processLibraryItem` once treated
  a first-ever `overallTimeWatched` observation as "today's delta" and caused a confirmed 16.5-hour single-entry
  bug; **that incident is about `overallTimeWatched` specifically, not a blanket rule against ever reading a
  first-observed value.** `sessionTracker.js`'s session-create path now seeds `durationSeconds` from
  `state.timeOffset` (capped against `state.duration` as a safety net) precisely because that field doesn't have
  the same risk; added 2026-07-17 to fix single-sitting, no-pause watches (Nuvio/Stremio only checkpoint at
  pause/stop, so a straight-through watch produces exactly one checkpoint, and the position-delta computed
  elsewhere in this file needs a second one to produce anything at all otherwise). Do **not** extend this same
  seeding to anything that reads `overallTimeWatched` directly (including `metricsProcessor.js`'s WatchActivity
  delta computation); that field genuinely needs two observations to diff safely.
- **WatchActivity's delta baseline is the running max `overallTimeWatched` ever seen for an item, not just the
  single most recent snapshot.** Nuvio's multi-profile merge (`providers/nuvio.js`) falls back to an empty
  progress array when one profile's `sync_pull_watch_progress` call fails transiently; if a *different* profile
  that watched the same item long ago is fetched successfully that same poll, its old frozen reading can briefly
  become the only available data for that item, then self-correct next poll. Comparing against only the prior
  snapshot treated that recovery as new watching (confirmed real case: a snapshot dropped 6543120→909494 across
  profile-fetch failures, then "recovered" to 6389553; a value already recorded six days earlier; producing a
  bogus 5480-second/91-minute entry that inflated "Watch Time Today"). `getMaxOverallTimeWatched()` fixes this by
  construction: recovering to a previously-seen value can never register as progress. Added 2026-07-18; a rewatch
  that resets progress to near-zero and climbs back up is also suppressed under this rule, an accepted tradeoff
  consistent with the "one History row per title" design. `scripts/reconcile-stale-snapshot-spikes.js` flags
  already-written oversized rows from before this fix, for review.
- **A checkpoint at the end of the runtime is the one that means "stopped".** The freshness window exists
  because a checkpoint cannot tell a pause from a stop, but a position in the last 2% of `state.duration`
  (`hasReachedEnd()` in `sessionTracker.js`) is playback that ended. Such a session is still created or updated
  (duration, History), then closed on that poll instead of lingering in Now Playing for the whole window - and it
  is not reactivated while the provider keeps reporting that same final position. `metricsBuilder.js` leaves such
  a session out of Now Playing in the meantime. Pinned by `test/sessionTracker.test.js`.
- **Day bucketing goes through `dateUtils.js`**, never `toISOString()` (which is always UTC). See the Timezone section below.

## Timezone

Background pollers have no request context to infer a viewer's timezone from, so "today" is an explicit setting:
`AppAccount.sync.accountTimezone` (Settings → Privacy & Display), read via `resolveAccountTimezone()` in
[server/utils/dateUtils.js](../server/utils/dateUtils.js), defaulting to `ACCOUNT_TIMEZONE` env / `America/Los_Angeles`.
Anything deciding what day something happened must use `getAccountDateString()`.

The Settings page auto-fills this from the browser's own `Intl.DateTimeFormat().resolvedOptions().timeZone` the
first time anyone opens Settings on an account that's never had one explicitly saved (tracked via the
`accountTimezoneIsDefault` flag `GET /api/settings` returns) and immediately persists it - so in practice nobody
has to manually pick from the dropdown, but the *stored* value is still what every background job reads, per the
paragraph above. Change it manually if you ever travel or move.

## Notifications

One Discord webhook, configured once in Settings → Notifications, with per-type toggles on `AppAccount.sync`:
`notifyOnActivity` / `notifyOnSync` / `notifyOnInvite` / `notifyOnVault`. Vault alerts ride the same webhook
(`vaultMonitor.js`); there is deliberately no separate Vault notification config. The "started watching"
notification fires from the **proxy** (instant); the native pipeline must not also send it (it fired at stop time,
which read as an end-of-watch notification).

## Posters

- Native/library items: the provider's own poster, with a Cinemeta-by-ID backfill (`libraryHelpers.js`).
- Proxy-detected items (filename-parsed title only): **strict** Cinemeta title search -
  `searchCinemetaPosterByTitle()` returns a poster *only* on an exact normalized-title match, plus an exact year
  match when the filename carries a year. No confident match ⇒ no poster, never a guessed one. A previous fuzzy
  lookup (the removed AIOMetadata integration) routinely picked the wrong same-titled film.
- Jellyfin-compatible servers: metahub for IMDb ids; titles with no IMDb id use the server's own Primary image
  (`jellyfinImages.js`), with the image tag in the address so new art is a new cache entry. `/api/img` lets those
  exact addresses through on a private server only on instances allowed to reach private addresses, and never
  follows a redirect from one.

## AIOStreams configurations: what SlickSync writes

SlickSync holds the configuration password for people added with it, and reads their configuration every 30
minutes for outside changes (`aiostreamsConfig.js`). It writes only five things, each through `writeConfig`,
preceded by `noteOutsideChanges` and followed by `rebaseline` so the write is never reported as an outside change:
profile variants (`aioProfileVariants.js`), debrid keys matching a rotated Vault key for people opted in
(`aioServiceKeys.js`), the SlickTrax link when AIOStreams watch history is turned on (`aioSlickTrax.js`), and
household users added from the household card or their PINs changed (`aioHousehold.js` - personas are matched by
id, never name, through AIOStreams' own `sha256("jellyfin-persona:<uuid>:<id>")` user id), and an earlier version
put back from the configuration's history (`aioConfigHistory.js`, keeping today's services, household users and
API keys by default). Every version seen is kept in `AioConfigSnapshot`, encrypted with the account key (it holds
debrid keys) and listed in `scripts/consolidate-encryption-keys.js`.
AIOStreams replaces the whole configuration on save, so each write changes only its own part of what it just read.
Anything new that writes to a configuration follows the same sequence and is added here and to the header of
`aiostreamsConfig.js`.
