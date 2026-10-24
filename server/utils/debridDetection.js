// Best-effort correlation: was a watch about to be written to
// MovieWatchHistory/EpisodeWatchHistory actually observed by the AIOStreams
// proxy, and if so, which debrid service resolved the stream? This is
// deliberately narrow in scope - docs/runtime-behavior.md's "the proxy must never write
// watch history or durations" rule is about presence/duration data leaking
// into History; this never touches durationSeconds or watchedAt, only adds
// an informational label, and only when BOTH a confident title+user+time
// correlation to a ProxyStreamSession is found AND that session's URL
// matches a known, confirmed debrid pattern. No match (unrecognized user,
// unrecognized title, or an unrecognized URL shape) means no label -
// never a guess.

const { resolveUserForActiveConnection } = require('./proxyStreamMonitor')

// 3 hours - same window metricsBuilder.js's mergeCrossPipelineDuplicates
// uses to correlate these same two pipelines for the Activity feed. The
// proxy's stream-open/close timestamps and the native pipeline's own
// watchedAt checkpoint can legitimately be that far apart.
const CORRELATION_WINDOW_MS = 3 * 60 * 60 * 1000

// Display names for recognized services. Keys are the values stored in
// MovieWatchHistory/EpisodeWatchHistory.debridService.
const DEBRID_LABELS = {
  torbox: 'TorBox',
}

// Same title or not - the shared rule (titleMatch.js). This used to accept a
// proxy name that merely STARTED with the wanted title, so a play of "The
// Godfather Part II" counted as proof that "The Godfather" was watched and
// could put the wrong debrid label on it.
const { sameTitle } = require('./titleMatch')

/** Whether a proxy row is for `title`, by its parsed name or its matched title's own name. */
function rowIsFor(candidate, title, series = false) {
  return [candidate.displayName || candidate.filename, candidate.metadataName]
    .some((name) => name && sameTitle(name, title, { series }))
}

// Only confirmed URL shapes are recognized - verified against real
// ProxyStreamSession.url values captured on a live instance (see
// scripts/debug-proxy-sessions.js), not from a resolver addon's documented
// conventions alone. Add a new pattern only once you've confirmed it the
// same way - a wrong guess here shows up as a factual-looking label on
// someone's watch history.
function detectDebridService(url) {
  if (!url) return null
  // Torrentio-style: https://<host>/resolve/torbox/<hash>/...
  if (/\/resolve\/torbox\//i.test(url)) return 'torbox'
  // StremThru-style: https://<host>/stremio/torz/<b64>/_/strem/<id>/tb/<hash>/...
  // "tb" is StremThru's own short code for TorBox, appearing as a plain
  // path segment right after the video/item ID.
  if (/\/strem\/[^/]+\/tb\//i.test(url)) return 'torbox'
  return null
}

// Looks for a ProxyStreamSession that plausibly corresponds to the watch
// about to be recorded. Matches on the title (the same title, with an
// episode marker allowed after a show's name - see titleMatch.js) within a
// wide time window, confirmed against the SAME user via
// resolveUserForActiveConnection - a title match alone isn't enough, since
// two users could plausibly watch the same title within the window.
// itemId/videoId are deliberately NOT used as a join key:
// ProxyStreamSession.metadataItemId comes from a fuzzy Cinemeta title
// search (see proxyStreamMonitor.js's attemptPosterLookup), not a verified
// match to the native pipeline's own item ID, so it isn't trustworthy here.
async function findDebridServiceForWatch(prisma, { accountId, userId, title, watchedAt, users, type }) {
  if (!title || !watchedAt || !Array.isArray(users) || users.length === 0) return null
  try {
    const windowStart = new Date(watchedAt.getTime() - CORRELATION_WINDOW_MS)
    const windowEnd = new Date(watchedAt.getTime() + CORRELATION_WINDOW_MS)
    const candidates = await prisma.proxyStreamSession.findMany({
      where: {
        accountId,
        lastSeenAt: { gte: windowStart },
        startTime: { lte: windowEnd },
      },
      select: { aiostreamsUser: true, url: true, displayName: true, filename: true, metadataName: true },
    })
    if (candidates.length === 0) return null

    for (const candidate of candidates) {
      if (!rowIsFor(candidate, title, type === 'series')) continue

      const resolvedUser = resolveUserForActiveConnection(users, candidate.aiostreamsUser)
      if (!resolvedUser || resolvedUser.id !== userId) continue

      const service = detectDebridService(candidate.url)
      if (service) return service
    }
    return null
  } catch (error) {
    console.warn('[DebridDetection] Correlation lookup failed:', error.message)
    return null
  }
}

// Same title+user correlation as findDebridServiceForWatch, but answers a
// narrower question: did the proxy see a REAL, sustained connection for this
// title at all (any URL, not just a recognized debrid pattern)? Used to
// rescue isActuallyWatched()'s 5%-of-runtime heuristic (metricsProcessor.js)
// from false negatives on short-but-genuine debrid/torrent watches - a movie
// stopped a few minutes in never crosses 5% of a 2h+ runtime, so it silently
// never became a MovieWatchHistory row despite the proxy having confirmed a
// real, non-trivial connection existed (a >90s connection rules out the
// preview/hover-autoplay case isActuallyWatched's threshold exists to guard
// against - see docs/runtime-behavior.md on the two-pipeline split for why the
// proxy is authoritative for "did playback happen" but never for duration;
// this only answers the former, the actual recorded duration still comes
// from native's own position data exactly as before).
const MIN_CONFIRMED_CONNECTION_MS = 90 * 1000

async function hasConfirmedProxyPlayback(prisma, { accountId, userId, title, watchedAt, users, type }) {
  if (!title || !watchedAt || !Array.isArray(users) || users.length === 0) return false
  try {
    const windowStart = new Date(watchedAt.getTime() - CORRELATION_WINDOW_MS)
    const windowEnd = new Date(watchedAt.getTime() + CORRELATION_WINDOW_MS)
    const candidates = await prisma.proxyStreamSession.findMany({
      where: {
        accountId,
        lastSeenAt: { gte: windowStart },
        startTime: { lte: windowEnd },
      },
      select: { aiostreamsUser: true, displayName: true, filename: true, metadataName: true, startTime: true, lastSeenAt: true },
    })
    if (candidates.length === 0) return false

    for (const candidate of candidates) {
      if (!rowIsFor(candidate, title, type === 'series')) continue

      const resolvedUser = resolveUserForActiveConnection(users, candidate.aiostreamsUser)
      if (!resolvedUser || resolvedUser.id !== userId) continue

      const connectionMs = candidate.lastSeenAt.getTime() - candidate.startTime.getTime()
      if (connectionMs >= MIN_CONFIRMED_CONNECTION_MS) return true
    }
    return false
  } catch (error) {
    console.warn('[DebridDetection] Confirmed-playback lookup failed:', error.message)
    return false
  }
}

module.exports = { detectDebridService, findDebridServiceForWatch, hasConfirmedProxyPlayback, DEBRID_LABELS }
