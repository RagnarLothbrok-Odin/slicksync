// Nuvio sends no poster, and often no name, so every title in a person's
// library is looked up on Cinemeta. That runs every minute for every Nuvio
// person; what was found has to be kept between polls, the lookups have to be
// few at a time and time out, and a lookup that goes wrong must only ever leave
// the name as it was.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createNuvioProvider, _test } = require('../server/providers/nuvio')

const realFetch = global.fetch
const DEFAULTS = { ..._test.META }

const jwt = () => ['h', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64'), 's'].join('.')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const tick = () => new Promise((resolve) => setImmediate(resolve))

const watched = (id, { type = 'movie', title = '' } = {}) => ({
  content_id: id, content_type: type, title, last_watched: '2026-01-01T00:00:00Z', position: 600, duration: 6000, video_id: '', season: null, episode: null,
})
const found = (name) => ({ meta: { name, poster: `https://img.example/${name}.jpg` } })

// Stands in for Nuvio's backend and for Cinemeta. `cinemeta(path, init)` answers
// each title lookup; every lookup is recorded.
function world(t, { progress = [], cinemeta = async (path) => json(found(`Title ${path.split('/').pop().replace('.json', '')}`)) } = {}) {
  _test.clearMetaCache()
  const state = { asked: [], inFlight: 0, mostInFlight: 0 }
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    if (u.hostname === 'v3-cinemeta.strem.io') {
      state.asked.push(u.pathname)
      state.inFlight++
      state.mostInFlight = Math.max(state.mostInFlight, state.inFlight)
      try { return await cinemeta(u.pathname, init) } finally { state.inFlight-- }
    }
    if (u.pathname === '/auth/v1/token') return json({ access_token: jwt(), refresh_token: 'next' })
    if (u.pathname === '/rest/v1/rpc/sync_pull_profiles') return json([])
    if (u.pathname === '/rest/v1/rpc/sync_pull_library') return json([])
    if (u.pathname === '/rest/v1/rpc/sync_pull_watch_progress') return json(progress)
    if (u.pathname === '/rest/v1/rpc/sync_pull_watched_items') return json([])
    throw new Error(`unexpected request to ${u.pathname}`)
  }
  t.after(() => {
    global.fetch = realFetch
    Object.assign(_test.META, DEFAULTS)
    _test.clearMetaCache()
  })
  state.library = async () => {
    const items = await createNuvioProvider({ refreshToken: 'refresh', userId: 'meta-user' }).getLibrary()
    return Object.fromEntries(items.map((i) => [i._id, { name: i.name, poster: i.poster }]))
  }
  return state
}

test('a second poll reuses what the first one found', async (t) => {
  const w = world(t, { progress: [watched('tt0000001'), watched('tt0000002', { type: 'series' })] })
  const first = await w.library()
  assert.deepEqual(w.asked.sort(), ['/meta/movie/tt0000001.json', '/meta/series/tt0000002.json'])
  assert.deepEqual(first.tt0000001, { name: 'Title tt0000001', poster: 'https://img.example/Title tt0000001.jpg' })
  const second = await w.library()
  assert.equal(w.asked.length, 2, 'nothing was asked for again')
  assert.deepEqual(second, first, 'and the items come out the same')
})

test('a name Nuvio already sent is kept, and only the poster is filled in', async (t) => {
  const w = world(t, { progress: [watched('tt0000001', { title: 'Name From Nuvio' })] })
  const items = await w.library()
  assert.equal(items.tt0000001.name, 'Name From Nuvio')
  assert.equal(items.tt0000001.poster, 'https://img.example/Title tt0000001.jpg')
})

test('lookups run a few at a time', async (t) => {
  const progress = Array.from({ length: 20 }, (_, i) => watched(`tt${String(i + 1).padStart(7, '0')}`))
  const w = world(t, { progress, cinemeta: async (path) => { await tick(); await tick(); return json(found(path)) } })
  await w.library()
  assert.equal(w.asked.length, 20)
  assert.ok(w.mostInFlight > 1, 'more than one at once')
  assert.ok(w.mostInFlight <= _test.META.concurrency, `never more than ${_test.META.concurrency} at once (saw ${w.mostInFlight})`)
})

test('a lookup that hangs times out, leaves the names as they were and does not fail the library', async (t) => {
  const hang = (path, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason))
  })
  const w = world(t, { progress: [watched('tt0000001', { title: 'Kept' }), watched('tt0000002')], cinemeta: hang })
  _test.META.timeoutMs = 20
  const items = await w.library()
  assert.deepEqual(items.tt0000001, { name: 'Kept', poster: null })
  assert.deepEqual(items.tt0000002, { name: '', poster: null })
})

test('a lookup that errors or answers badly leaves the names as they were', async (t) => {
  const answers = { '/meta/movie/tt0000001.json': () => { throw new Error('socket hang up') }, '/meta/movie/tt0000002.json': () => json({}, 500), '/meta/movie/tt0000003.json': () => new Response('not json', { status: 200 }) }
  const w = world(t, {
    progress: [watched('tt0000001', { title: 'One' }), watched('tt0000002', { title: 'Two' }), watched('tt0000003', { title: 'Three' })],
    cinemeta: async (path) => answers[path](),
  })
  const items = await w.library()
  assert.deepEqual(Object.values(items).map((i) => i.name), ['One', 'Two', 'Three'])
})

// A clock the test moves by hand, so lifetimes are checked at their real
// values without waiting or racing the machine.
function clock(t) {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  return { advance(ms) { now += ms } }
}
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

test('a failed lookup is asked again sooner than a title Cinemeta has no record of', async (t) => {
  const time = clock(t)
  const w = world(t, {
    progress: [watched('tt0000001'), watched('tt0000002')],
    cinemeta: async (path) => (path.endsWith('tt0000001.json') ? json({}, 404) : json({}, 503)),
  })
  await w.library()
  assert.equal(w.asked.length, 2)
  time.advance(MINUTE)
  await w.library()
  assert.equal(w.asked.length, 2, 'a minute on, neither is asked again')
  time.advance(5 * MINUTE)
  await w.library()
  assert.deepEqual(w.asked.slice(2), ['/meta/movie/tt0000002.json'], 'after a few minutes only the one that failed is tried again')
  time.advance(HOUR)
  await w.library()
  assert.equal(w.asked.slice(3).includes('/meta/movie/tt0000001.json'), true, 'and the one with no record is tried again after an hour')
})

test('what was found is kept for a day', async (t) => {
  const time = clock(t)
  const w = world(t, { progress: [watched('tt0000001')] })
  await w.library()
  time.advance(23 * HOUR)
  await w.library()
  assert.equal(w.asked.length, 1, 'still known after 23 hours')
  time.advance(2 * HOUR)
  await w.library()
  assert.equal(w.asked.length, 2, 'asked again once it has expired')
})

test('the cache holds only so many titles', async (t) => {
  const w = world(t, { progress: ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004', 'tt0000005'].map((id) => watched(id)) })
  _test.META.max = 3
  await w.library()
  assert.equal(_test.metaCacheSize(), 3)
})

test('past the time budget the rest wait for the next poll, and names that are missing go first', async (t) => {
  const w = world(t, { progress: [watched('tt0000001', { title: 'Has A Name' }), watched('tt0000002')] })
  _test.META.concurrency = 1
  _test.META.budgetMs = 0
  const items = await w.library()
  assert.equal(w.asked.length, 0, 'out of budget: nothing was asked')
  assert.deepEqual(items.tt0000002, { name: '', poster: null })

  _test.META.budgetMs = DEFAULTS.budgetMs
  await w.library()
  assert.deepEqual(w.asked, ['/meta/movie/tt0000002.json', '/meta/movie/tt0000001.json'], 'the title with no name is asked for first')
})
