const test = require('node:test')
const assert = require('node:assert/strict')
const usersRouter = require('../server/routes/users')

// ---- harness ------------------------------------------------------------------

// The router built the way index.js builds it, over a fake database. Only the
// parts a test sets up are answered; the rest is never reached.
function buildRouter(prisma) {
  return usersRouter({
    prisma,
    getAccountId: () => 'acct',
    scopedWhere: (req, where) => where,
    INSTANCE_TYPE: 'private',
    decrypt: (value) => value,
    encrypt: (value) => value,
  })
}

// Runs one route's handler directly, the way express would, and returns what
// it answered.
async function call(router, method, routePath, req) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `no ${method} ${routePath} route`)
  const res = { statusCode: 200, body: undefined }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await layer.route.stack[0].handle({ query: {}, body: {}, headers: {}, ...req }, res)
  return res
}

const realNow = Date.now
function clockAt(t, iso) {
  let now = Date.parse(iso)
  Date.now = () => now
  t.after(() => { Date.now = realNow })
  return { set: (next) => { now = Date.parse(next) }, advance: (ms) => { now += ms } }
}

let accountCounter = 0
// Each test gets an account of its own: the account's time zone is looked up
// once a minute and remembered per account.
const freshAccount = () => `stats-acct-${++accountCounter}`

function statsFixture({ movies = [], episodes = [], timezone = 'America/Los_Angeles', user = {} } = {}) {
  const accountId = freshAccount()
  const state = {
    accountId,
    movieReads: 0,
    episodeReads: 0,
    failNext: false,
    gate: null, // a promise the history reads wait for, when a test wants them slow
    user: { id: 'user-1', accountId, username: 'Alex', avatarUrl: null, colorIndex: 3, publicStatsSlug: 'slug-1', publicStatsEnabled: true, email: 'alex@example.com', ...user },
    movies,
    episodes,
  }
  const read = (counter, rows) => async () => {
    state[counter]++
    if (state.gate) await state.gate
    if (state.failNext) { state.failNext = false; throw new Error('database unavailable') }
    return rows()
  }
  state.prisma = {
    user: {
      findFirst: async ({ where }) => (
        state.user.publicStatsSlug === where.publicStatsSlug && state.user.publicStatsEnabled === where.publicStatsEnabled ? { ...state.user } : null
      ),
    },
    movieWatchHistory: { findMany: read('movieReads', () => state.movies) },
    episodeWatchHistory: { findMany: read('episodeReads', () => state.episodes) },
    appAccount: { findFirst: async () => ({ sync: JSON.stringify({ accountTimezone: timezone }) }) },
  }
  state.router = buildRouter(state.prisma)
  state.view = (slug = 'slug-1') => call(state.router, 'get', '/public-stats/:slug', { params: { slug } })
  return state
}

const watch = (iso, extra = {}) => ({ itemName: 'Some Film', poster: null, durationSeconds: 60, watchedAt: new Date(iso), ...extra })
const episode = (iso, extra = {}) => ({ showName: 'Some Show', poster: null, durationSeconds: 60, watchedAt: new Date(iso), ...extra })

// ---- what the page says --------------------------------------------------------

test('public stats: only the curated fields, with totals and top titles', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({
    movies: [
      { itemName: 'Heat', poster: 'heat.jpg', durationSeconds: 7200, watchedAt: new Date('2026-09-01T12:00:00Z') },
      { itemName: 'Crew', poster: 'crew.jpg', durationSeconds: 3600, watchedAt: new Date('2026-09-02T12:00:00Z') },
      { itemName: '', poster: null, durationSeconds: 999, watchedAt: new Date('2026-09-03T12:00:00Z') },
      { itemName: 'Unfinished', poster: null, durationSeconds: null, watchedAt: new Date('2026-09-04T12:00:00Z') },
    ],
    episodes: [
      { showName: 'Crew', poster: null, durationSeconds: 1800, watchedAt: new Date('2026-09-05T12:00:00Z') },
      { showName: 'Dune', poster: 'dune.jpg', durationSeconds: 9000, watchedAt: new Date('2026-09-06T12:00:00Z') },
    ],
  })
  const res = await f.view()
  assert.equal(res.statusCode, 200)
  assert.deepEqual(Object.keys(res.body), ['username', 'avatarUrl', 'colorIndex', 'totalWatchHours', 'totalTitles', 'streak', 'topTitles'])
  assert.equal(res.body.username, 'Alex')
  // 7200 + 3600 + 999 + 0 + 1800 + 9000 = 22599 seconds, 6.2775 hours
  assert.equal(res.body.totalWatchHours, 6.3)
  // The nameless row is not a title; a movie and a show with one name are one.
  assert.equal(res.body.totalTitles, 4)
  assert.deepEqual(res.body.topTitles, [
    { name: 'Dune', poster: 'dune.jpg' },
    { name: 'Heat', poster: 'heat.jpg' },
    { name: 'Crew', poster: 'crew.jpg' },
    { name: 'Unfinished', poster: null },
  ])
  assert.equal(res.body.streak, 0)
})

test('public stats: an unknown or switched-off link is a 404 that reads no history', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({ user: { publicStatsEnabled: false } })
  const res = await f.view('slug-1')
  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.body, { error: 'This stats page is not available' })
  assert.equal((await f.view('nope')).statusCode, 404)
  assert.equal(f.movieReads + f.episodeReads, 0)
})

// ---- the streak, in the account's own time zone --------------------------------

test('streak: days are the account\'s own, so a watch before local midnight is not pushed into tomorrow', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z') // 13:00 on Oct 12 in Los Angeles
  const f = statsFixture({
    movies: [watch('2026-10-11T05:00:00Z')], // 22:00 Oct 10 there
    episodes: [
      episode('2026-10-12T05:00:00Z'), // 22:00 Oct 11 there
      episode('2026-10-12T08:00:00Z'), // 01:00 Oct 12 there - the same UTC day as the one above
    ],
  })
  // Three local days in a row. Counting in UTC saw two watches on one day and
  // one on the day before, and called it two.
  assert.equal((await f.view()).body.streak, 3)
})

test('streak: yesterday keeps it alive, a missed day ends it', async (t) => {
  const clock = clockAt(t, '2026-10-12T20:00:00Z') // Oct 12 in Los Angeles
  const f = statsFixture({ movies: [watch('2026-10-12T06:30:00Z')] }) // 23:30 on Oct 11 there
  assert.equal((await f.view()).body.streak, 1)
  clock.advance(24 * 3600 * 1000) // Oct 13: nothing on the 12th, nothing today
  assert.equal((await f.view()).body.streak, 0)
})

test('streak: a watch just after local midnight belongs to the new day', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({ movies: [watch('2026-10-12T07:30:00Z')] }) // 00:30 Oct 12 in Los Angeles
  // That is today there, so the streak is today's - and nothing yesterday.
  assert.equal((await f.view()).body.streak, 1)
})

test('streak: runs straight through the spring and autumn clock changes', async (t) => {
  const clock = clockAt(t, '2026-03-10T22:00:00Z')
  // Noon local on Mar 6-10 2026; the clocks went forward on the 8th.
  const spring = ['2026-03-06T20:00:00Z', '2026-03-07T20:00:00Z', '2026-03-08T19:00:00Z', '2026-03-09T19:00:00Z', '2026-03-10T19:00:00Z']
  const f = statsFixture({ movies: spring.map((iso) => watch(iso)) })
  assert.equal((await f.view()).body.streak, 5)

  // The same week with the 8th missing breaks it there.
  const gap = statsFixture({ movies: spring.filter((iso) => !iso.startsWith('2026-03-08')).map((iso) => watch(iso)) })
  assert.equal((await gap.view()).body.streak, 2)

  // Noon local on Oct 30 - Nov 2 2026; the clocks went back on Nov 1.
  clock.set('2026-11-02T21:00:00Z')
  const autumn = ['2026-10-30T19:00:00Z', '2026-10-31T19:00:00Z', '2026-11-01T20:00:00Z', '2026-11-02T20:00:00Z']
  const g = statsFixture({ movies: autumn.map((iso) => watch(iso)) })
  assert.equal((await g.view()).body.streak, 4)
})

test('streak: a long history is not capped', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const days = 500
  const rows = Array.from({ length: days }, (_, i) => watch(new Date(Date.parse('2026-10-12T20:00:00Z') - i * 86400000).toISOString()))
  const f = statsFixture({ movies: rows })
  assert.equal((await f.view()).body.streak, days)
})

// ---- the cache -------------------------------------------------------------------

test('cache: a second view within five minutes reads no history, and a view after that does', async (t) => {
  const clock = clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({ movies: [watch('2026-10-12T18:00:00Z')] })

  const first = await f.view()
  const second = await f.view()
  assert.deepEqual(second.body, first.body)
  assert.deepEqual([f.movieReads, f.episodeReads], [1, 1])

  clock.advance(5 * 60 * 1000 - 1)
  await f.view()
  assert.deepEqual([f.movieReads, f.episodeReads], [1, 1])

  clock.advance(2)
  await f.view()
  assert.deepEqual([f.movieReads, f.episodeReads], [2, 2])
})

test('cache: a cached view still shows the person\'s current name and picture', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({ movies: [watch('2026-10-12T18:00:00Z')] })
  assert.equal((await f.view()).body.username, 'Alex')
  f.user.username = 'Alexandra'
  f.user.avatarUrl = '/avatars/new.png'
  const again = await f.view()
  assert.equal(again.body.username, 'Alexandra')
  assert.equal(again.body.avatarUrl, '/avatars/new.png')
  assert.equal(f.movieReads, 1)
})

test('cache: views that arrive together share one scan', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({ movies: [watch('2026-10-12T18:00:00Z')] })
  let open
  f.gate = new Promise((resolve) => { open = resolve })

  const views = Array.from({ length: 5 }, () => f.view())
  await new Promise((resolve) => setImmediate(resolve))
  open()
  const answers = await Promise.all(views)

  assert.deepEqual([f.movieReads, f.episodeReads], [1, 1])
  assert.ok(answers.every((a) => a.statusCode === 200 && a.body.streak === 1))
})

test('cache: a link that is switched off answers 404 at once, and a new one is worked out afresh', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const f = statsFixture({ movies: [watch('2026-10-12T18:00:00Z')] })
  assert.equal((await f.view()).statusCode, 200)

  f.user.publicStatsEnabled = false
  assert.equal((await f.view()).statusCode, 404)

  f.user.publicStatsEnabled = true
  assert.equal((await f.view()).statusCode, 200)
  assert.equal(f.movieReads, 2)
})

test('cache: a failed scan is an error for that view only and is not remembered', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  const originalError = console.error
  console.error = () => {}
  t.after(() => { console.error = originalError })
  const f = statsFixture({ movies: [watch('2026-10-12T18:00:00Z')] })
  f.failNext = true
  assert.equal((await f.view()).statusCode, 500)
  const retry = await f.view()
  assert.equal(retry.statusCode, 200)
  assert.equal(retry.body.streak, 1)
})

test('cache: holds a bounded number of links, dropping the one worked out longest ago', async (t) => {
  clockAt(t, '2026-10-12T20:00:00Z')
  let reads = 0
  const accountId = freshAccount()
  const prisma = {
    user: { findFirst: async ({ where }) => ({ id: `u-${where.publicStatsSlug}`, accountId, username: where.publicStatsSlug, avatarUrl: null, colorIndex: 0 }) },
    movieWatchHistory: { findMany: async () => { reads++; return [] } },
    episodeWatchHistory: { findMany: async () => [] },
    appAccount: { findFirst: async () => null },
  }
  const router = buildRouter(prisma)
  const view = (slug) => call(router, 'get', '/public-stats/:slug', { params: { slug } })

  for (let i = 0; i <= 500; i++) await view(`link-${i}`) // 501 links
  assert.equal(reads, 501)
  await view('link-500')
  assert.equal(reads, 501, 'the newest is still remembered')
  await view('link-0')
  assert.equal(reads, 502, 'the oldest was let go')
})

// ---- PUT /users/:id -----------------------------------------------------------------

test('updating a user no longer needs the native bcrypt module, and a password field is ignored', async (t) => {
  assert.ok(!Object.keys(require.cache).some((file) => /[\\/]node_modules[\\/]bcrypt[\\/]/.test(file)), 'native bcrypt was loaded')

  const updates = []
  const person = { id: 'user-9', accountId: 'acct', providerType: 'stremio', username: 'old', email: 'old@example.com', isActive: true, stremioAddons: null }
  const prisma = {
    user: {
      findFirst: async () => ({ ...person }),
      update: async (args) => { updates.push(args); return { ...person, ...args.data } },
    },
    group: { findMany: async () => [] },
  }
  const router = buildRouter(prisma)
  // The last-seen lookup after the update is best effort and reports its own failure.
  const originalWarn = console.warn
  console.warn = () => {}
  t.after(() => { console.warn = originalWarn })
  const res = await call(router, 'put', '/:id', { params: { id: 'user-9' }, body: { username: 'new-name', password: 'not-a-column' } })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.id, 'user-9')
  assert.deepEqual(updates.map((u) => u.data), [{ username: 'new-name' }])
})
