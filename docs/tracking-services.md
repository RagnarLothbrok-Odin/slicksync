# Tracking services

Nuvio users can link Trakt under **Settings → Tracking services**. Each connection belongs to the selected SlickSync profile. Connect the same Trakt account in Nuvio, and use a separate tracker account for each person whose viewing must stay separate.

Trakt is the first supported service. Stremio and other trackers are not enabled by this integration.

## Instance setup

Register a Trakt developer app and set `TRAKT_TRACKING_CLIENT_ID` on the SlickSync server. The Client ID is public configuration. The connection uses PKCE and does not need a Client Secret.

Register this callback, replacing the origin with the instance's `PUBLIC_APP_URL`:

```text
https://your-instance.example/user/settings/tracking/callback
```

Development builds also permit a registered HTTP loopback callback, such as `http://localhost:3000/user/settings/tracking/callback`. Production requires HTTPS.

Apply the normal Prisma schema synchronization for the instance before starting the updated server. Both database schemas add `TrackingConnection`; existing connections and history are unchanged. Preserve the server encryption key with the database backup, since tracking credentials are encrypted and bound to their account and profile.

## Connection slots

Standard SlickSync authorization uses one Trakt Community App connection. Free Trakt accounts currently allow **two** Community App connections, including any counted connection used by the player. Review the [Trakt announcement](https://github.com/trakt/trakt-api/discussions/943) and [your connected apps](https://app.trakt.tv/settings/apps/connected) before linking.

Disconnecting in SlickSync removes its locally stored authorization. Also remove SlickSync from Trakt's Connected Apps to revoke access and free the slot there.

## Data and accuracy

- **Playback activity:** reads Trakt's current watching report, with playback position estimated from its expiry and runtime. The UI labels the source as Trakt. A saved resume point is not treated as a live pause event.
- **Continue Watching:** adds saved Trakt progress alongside native items, preferring the newer timestamp for the same title and respecting local dismissals.
- **Calendar:** adds the user's Trakt calendar for the next 33 days, preserving UTC airing times and local muted/dismissed episode settings.

The settings panel checks all three sources separately. Provider restrictions, expired authorization, rate limits, or outages can affect individual sources. Available native data remains visible if a supplementary source fails.

After linking, SlickSync reads tracking data only. It does not send playback, watched-state, or calendar changes back to Trakt or Nuvio, and it does not import historical watch events into the local database.

## Verification

Fixture tests cover owner and provider checks, PKCE, callback expiry and replay, encrypted credential boundaries, token-refresh coordination, disconnect races, rate limiting, and conversion of playback, resume points, and calendar entries. A real PKCE sign-in and read access to all three data sources were also verified in a public/PostgreSQL local preview. Playback start, pause, resume, and stop still need a hands-on trial with the same Trakt account enabled in Nuvio.

### Personal Home statistics

For a linked Nuvio profile, Home gets all-time counts and minutes directly from
Trakt's user stats endpoint. Most Watched uses per-title play summaries, including
rewatches. Summary pagination covers distinct titles, never lifetime viewing
events. Today's activity reads only date-filtered history in the account timezone,
with a maximum of two pages. Incomplete daily data is shown as unavailable.

Times use title runtimes, not measured time in the player. Trakt does not supply
streaks or binge counts in its statistics response, so these cards are replaced
with supported episode counts or omitted. No lifetime history scan runs on Home.
Results are cached for five minutes; optional source failures do not hide the
all-time figures. Unavailable aggregate stats fall back explicitly to SlickSync.
Artwork has a two-second budget and cannot keep the statistics loading.

The account header, group membership, sync controls and health remain SlickSync
data. Continue Watching, playback and calendar retain their existing source rules.

Personal playback checks Trakt every 15 seconds while the page is visible. The
progress display advances each second from Trakt's timing, then reconciles on the
next check. This is automatic polling, not a push connection or exact player telemetry.

Continue Watching combines paused movies/episodes with Trakt's direct Continue
Watching list, using the same `up_next_nitro` endpoint and `intent=continue` as its
web client. It reads paginated progress summaries, not historical viewing events
or individual show progress. Episodes with a future or unknown air date are
excluded. Trakt's artwork is used directly, with metadata fallback when missing.
Results are cached for five minutes, and the personal row is no longer capped at
12 items. Paused playback takes priority over a computed next episode for the same
title; Nuvio and Trakt retain the newest entry per title. Local dismissals still apply.
