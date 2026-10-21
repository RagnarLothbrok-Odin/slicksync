// "Remove from Activity": one viewing - a person, a title (an episode for a
// show), one day - taken off the Activity page AND out of their watch time
// and history, because it was wrong (a test, someone else on their account).
//
// What it removes, all limited to that person, that title and that day:
//   - the history entry (a film's or an episode's watched record) if it was
//     recorded that day,
//   - that day's watch time for the title,
//   - the viewing sessions that started that day.
// Everything removed goes to the Trash first (kind 'viewing') and comes back
// from there for 30 days - see restoreExtendedKind in trash.js.

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

/**
 * from/to: the start and end of that day on the viewer's clock (ISO).
 * day: that day as YYYY-MM-DD, for the per-day watch time rows.
 */
async function removeViewing(prisma, accountId, userId, { itemId, videoId = null, day, from, to } = {}) {
  if (!itemId || !day || !from || !to) throw fail('Missing which viewing to remove')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw fail('Bad day')
  const start = new Date(from)
  const end = new Date(to)
  if (!(start < end) || end - start > 2 * 86400000) throw fail('Bad day range')
  const person = await prisma.user.findFirst({ where: { id: userId, accountId }, select: { id: true, username: true } })
  if (!person) throw fail('Person not found', 404)

  const isEpisode = !!videoId
  // Watch time rows are dated by day; one either side of the viewer's day is
  // checked so a timezone difference can't miss it, but only rows whose own
  // date matches the day are taken.
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const near = { gte: new Date(dayStart.getTime() - 86400000), lt: new Date(dayStart.getTime() + 2 * 86400000) }
  const sameDay = (d) => new Date(d).toISOString().slice(0, 10) === day
  const inRange = { gte: start, lt: end }

  const [movies, episodes, activity, sessions] = await Promise.all([
    isEpisode ? [] : prisma.movieWatchHistory.findMany({ where: { accountId, userId, itemId, watchedAt: inRange } }),
    isEpisode ? prisma.episodeWatchHistory.findMany({ where: { accountId, userId, videoId, watchedAt: inRange } }) : [],
    prisma.watchActivity.findMany({ where: { accountId, userId, itemId, date: near, ...(isEpisode ? { videoId } : {}) } }).then((rows) => rows.filter((r) => sameDay(r.date))),
    prisma.watchSession.findMany({ where: { accountId, userId, itemId, startTime: inRange, isActive: false, ...(isEpisode ? { videoId } : {}) } }),
  ])
  const total = movies.length + episodes.length + activity.length + sessions.length
  if (!total) throw fail('Nothing recorded for that viewing - it may already be gone', 404)

  const name = movies[0]?.itemName || episodes[0]?.showName || sessions[0]?.itemName || itemId
  const ep = episodes[0] || sessions.find((s) => s.season != null)
  const what = ep?.season != null ? `${name} S${ep.season} E${ep.episode}` : name
  const trash = await prisma.trashItem.create({
    data: {
      accountId,
      kind: 'viewing',
      label: `${what} - ${person.username}, ${day}`,
      payload: JSON.stringify({ userId, movies, episodes, activity, sessions }),
    },
  })
  await prisma.$transaction([
    prisma.movieWatchHistory.deleteMany({ where: { id: { in: movies.map((r) => r.id) } } }),
    prisma.episodeWatchHistory.deleteMany({ where: { id: { in: episodes.map((r) => r.id) } } }),
    prisma.watchActivity.deleteMany({ where: { id: { in: activity.map((r) => r.id) } } }),
    prisma.watchSession.deleteMany({ where: { id: { in: sessions.map((r) => r.id) } } }),
  ])
  try { require('./metricsCache').clearMetricsForAccount(accountId) } catch { /* optional */ }
  try { require('./continueWatching').invalidateContinueWatching(accountId) } catch { /* optional */ }
  return {
    trashId: trash.id,
    label: what,
    removed: { history: movies.length + episodes.length, watchTimeSeconds: activity.reduce((n, r) => n + (r.watchTimeSeconds || 0), 0), sessions: sessions.length },
  }
}

/** Puts a removed viewing back (from the Trash). Rows recorded again since are kept. */
async function restoreViewing(prisma, payload) {
  let restored = 0
  const put = async (model, rows) => {
    for (const row of rows || []) {
      try { await prisma[model].create({ data: row }); restored++ } catch { /* recorded again since - keep the newer row */ }
    }
  }
  await put('movieWatchHistory', payload.movies)
  await put('episodeWatchHistory', payload.episodes)
  await put('watchActivity', payload.activity)
  await put('watchSession', payload.sessions)
  return restored
}

module.exports = { removeViewing, restoreViewing }
