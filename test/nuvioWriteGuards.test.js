// A Nuvio addon list is written in one call (sync_push_addons) where the
// backend has it. Most tests here run against a backend without it (it
// answers 404), where replacing the list is delete-then-insert, so what keeps a person's
// list from being left empty is what happens around it: one write at a time
// per list, no start while the backend is being held back, no duplicate
// addresses in what is inserted, and, once the old list is gone, an insert that
// gets through a busy backend and a restore that does too.
const test = require('node:test')
const assert = require('node:assert/strict')
const nuvio = require('../server/providers/nuvio')
const { createNuvioProvider } = nuvio
const supabase = require('../server/providers/supabase')

const realFetch = global.fetch

const jwt = () => ['h', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64'), 's'].join('.')
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const tick = () => new Promise((resolve) => setImmediate(resolve))

let rowId = 0
const row = (userId, profileId, url, sortOrder) => ({ id: `r${++rowId}`, user_id: userId, profile_id: profileId, url, name: '', enabled: true, sort_order: sortOrder, created_at: '2026-01-01T00:00:00Z' })
const addon = (url, name = '') => ({ transportUrl: url, transportName: name, manifest: { name } })

// A stand-in for Nuvio's PostgREST addons table. Every request yields to the
// event loop first, so writes that are not kept apart really do interleave.
function backend(t, rows = []) {
  const state = {
    rows: rows.map((r) => ({ ...r })),
    events: [],          // { method, profile, body? } for the addons table
    other: [],           // requests to anything else (the breaker probe)
    signIns: 0,          // token refreshes asked for
    failPosts: 0,        // the next N inserts answer 500
    postPlan: [],        // how the next inserts answer, in order: a status, or { status, retryAfter } (seconds)
    failGets: 0,         // the next N reads answer 500
    holdDelete: null,    // { profile, promise } - a delete for that profile waits
    onSnapshot: null,    // runs while a read of the addons table is being answered
    afterDelete: null,   // runs once a delete has been done, before it is answered
    pushSupported: false, // sync_push_addons exists (an up-to-date backend)
    pushes: [],          // { profile, addons } for each sync_push_addons
    pushStatus: null,    // the next sync_push_addons answers this status instead
  }
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    const method = init.method || 'GET'
    if (u.pathname === '/auth/v1/token') { state.signIns++; return json({ access_token: jwt(), refresh_token: 'next' }) }
    if (u.pathname === '/rest/v1/probe') { state.other.push(method); return json({}, 429) }
    if (u.pathname === '/rest/v1/rpc/sync_push_addons') {
      const { p_profile_id: profile, p_addons: list } = JSON.parse(init.body)
      state.pushes.push({ profile, addons: list })
      await tick()
      if (!state.pushSupported) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404)
      if (state.pushStatus) { const status = state.pushStatus; state.pushStatus = null; return json({}, status) }
      // Swapped over in one step, as the real function does in one transaction.
      const user = state.pushUser || 'u1'
      state.rows = state.rows.filter((r) => !(r.user_id === user && r.profile_id === profile))
        .concat(list.map((a) => row(user, profile, a.url, a.sort_order)))
      return new Response(null, { status: 204 })
    }
    assert.equal(u.pathname, '/rest/v1/addons', `unexpected request to ${u.pathname}`)
    const user = (u.searchParams.get('user_id') || '').replace(/^eq\./, '')
    const profile = (u.searchParams.get('profile_id') || '').replace(/^eq\./, '')
    const mine = (r) => (!user || r.user_id === user) && (!profile || String(r.profile_id) === profile)
    const body = init.body ? JSON.parse(init.body) : undefined
    state.events.push({ method, profile, body })
    await tick()
    if (method === 'GET') {
      if (state.failGets > 0) { state.failGets--; return json({}, 500) }
      if (state.onSnapshot) await state.onSnapshot()
      return json(state.rows.filter(mine).map((r) => ({ ...r })))
    }
    if (method === 'DELETE') {
      if (state.holdDelete && state.holdDelete.profile === profile) await state.holdDelete.promise
      state.rows = state.rows.filter((r) => !mine(r))
      if (state.afterDelete) await state.afterDelete()
      return new Response(null, { status: 204 })
    }
    if (method === 'POST') {
      const planned = state.postPlan.shift()
      if (planned !== undefined) {
        const { status, retryAfter } = typeof planned === 'number' ? { status: planned } : planned
        return json({}, status, retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) })
      }
      if (state.failPosts > 0) { state.failPosts--; return json({}, 500) }
      const made = body.map((r) => ({ id: `r${++rowId}`, created_at: '2026-01-01T00:00:00Z', ...r }))
      state.rows.push(...made)
      return json(made)
    }
    throw new Error(`unexpected ${method}`)
  }
  // The waits between tries are real timers; these keep them to a millisecond.
  // A test that cares about them sets its own.
  const kept = { ...nuvio._test.WRITE_RETRY }
  Object.assign(nuvio._test.WRITE_RETRY, { insertMs: [1, 1], restoreMs: [1, 1, 1], maxWaitMs: 15000 })
  t.after(() => { global.fetch = realFetch; supabase._test.resetCircuit(); Object.assign(nuvio._test.WRITE_RETRY, kept) })
  state.urls = (userId, profileId) => state.rows
    .filter((r) => r.user_id === userId && r.profile_id === profileId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => r.url)
  state.methods = () => state.events.map((e) => e.method)
  return state
}

const provider = (userId, profileId) => createNuvioProvider({ refreshToken: 'refresh', userId, profileId })
const quiet = (t) => { t.mock.method(console, 'error', () => {}) }

test('two writes for one person and profile run one after the other, even from separate providers', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  // A provider is built fresh for every operation, so the order has to hold
  // across instances, not just inside one.
  await Promise.all([
    provider('u1', 1).setAddons([addon('https://a.example/manifest.json'), addon('https://b.example/manifest.json')]),
    provider('u1', 1).setAddons([addon('https://c.example/manifest.json')]),
  ])
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'POST', 'GET', 'DELETE', 'POST'], 'each write finishes before the next one starts')
  assert.deepEqual(db.urls('u1', 1), ['https://c.example/manifest.json'], 'the list is the last write, not a mixture')
})

test('a clear and a replace for the same list are kept apart as well', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  await Promise.all([
    provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]),
    provider('u1', 1).clearAddons(),
  ])
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'POST', 'DELETE'], 'the clear waits for the replace to finish')
  assert.deepEqual(db.urls('u1', 1), [], 'and, being last, is what the list ends as')
})

test('another profile of the same login does not wait for a write that is stuck', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://one.example/manifest.json', 0), row('u1', 2, 'https://two.example/manifest.json', 0)])
  let release
  db.holdDelete = { profile: '1', promise: new Promise((resolve) => { release = resolve }) }
  const stuck = provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  await provider('u1', 2).setAddons([addon('https://b.example/manifest.json')])
  assert.deepEqual(db.urls('u1', 2), ['https://b.example/manifest.json'], 'profile 2 was written while profile 1 was held')
  assert.deepEqual(db.urls('u1', 1), ['https://one.example/manifest.json'], 'profile 1 has not been touched yet')
  release()
  await stuck
  assert.deepEqual(db.urls('u1', 1), ['https://a.example/manifest.json'])
  assert.deepEqual(db.urls('u1', 2), ['https://b.example/manifest.json'], 'and writing one profile never changes the other')
})

test('a write that fails does not hold up the one queued behind it', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  db.failGets = 1
  const first = provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  const second = provider('u1', 1).setAddons([addon('https://b.example/manifest.json')])
  await assert.rejects(first, (e) => e.status === 500)
  await second
  assert.deepEqual(db.urls('u1', 1), ['https://b.example/manifest.json'])
})

test('the same address twice is written once, keeping the first and the order', async (t) => {
  quiet(t)
  const db = backend(t, [])
  await provider('u2', 3).setAddons([
    addon('https://a.example/manifest.json', 'A'),
    addon('https://b.example/manifest.json', 'B'),
    addon(' HTTPS://A.EXAMPLE/manifest.json ', 'A again'),
  ])
  const post = db.events.find((e) => e.method === 'POST')
  assert.deepEqual(post.body.map((r) => [r.url, r.name, r.sort_order, r.profile_id, r.user_id]), [
    ['https://a.example/manifest.json', 'A', 0, 3, 'u2'],
    ['https://b.example/manifest.json', 'B', 1, 3, 'u2'],
  ])
})

test('addresses that differ in the case of the path or query are different addons; scheme and host case is not', async (t) => {
  quiet(t)
  const db = backend(t, [])
  await provider('u2', 3).setAddons([
    addon('https://a.example/AbC123/manifest.json', 'first'),
    addon('https://a.example/abc123/manifest.json', 'second'),
    addon('HTTPS://A.Example/AbC123/manifest.json', 'first again'),
    addon('https://b.example/x?key=AbC', 'third'),
    addon('https://b.example/x?key=abc', 'fourth'),
  ])
  const post = db.events.find((e) => e.method === 'POST')
  assert.deepEqual(post.body.map((r) => r.url), [
    'https://a.example/AbC123/manifest.json',
    'https://a.example/abc123/manifest.json',
    'https://b.example/x?key=AbC',
    'https://b.example/x?key=abc',
  ])
})

test('an empty list still clears the person, and only their profile', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://one.example/manifest.json', 0), row('u1', 2, 'https://two.example/manifest.json', 0)])
  await provider('u1', 2).setAddons([])
  assert.deepEqual(db.methods(), ['GET', 'DELETE'], 'deleted, nothing inserted')
  assert.deepEqual(db.urls('u1', 2), [])
  assert.deepEqual(db.urls('u1', 1), ['https://one.example/manifest.json'])
})

test('something that is not a list is refused before anything is deleted', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  await assert.rejects(provider('u1', 1).setAddons(undefined), TypeError)
  assert.equal(db.events.length, 0)
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
})

test('an insert that keeps failing still restores the previous list', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  // The insert is sent again after a failure, so it has to fail every time.
  db.failPosts = 1 + nuvio._test.WRITE_RETRY.insertMs.length
  await assert.rejects(provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 500)
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'POST', 'POST', 'POST', 'GET', 'POST'], 'three tries at the new list, a look at what the list holds, then the restore')
})

test('an insert the backend answers 429 to is sent again and the new list is written', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  db.postPlan = [429, 429]
  await provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'POST', 'POST', 'POST'])
  assert.deepEqual(db.urls('u1', 1), ['https://a.example/manifest.json'])
  // The tries are never held back, but two 429s are still two 429s: the next
  // person's replace is stopped at its first read.
  assert.equal(supabase.isCircuitOpen(), true)
  assert.equal(supabase._test.breakerState().circuitTrips, 1)
})

test('a backend that answers every insert with 429 stops the next person before their list is deleted', async (t) => {
  quiet(t)
  t.mock.method(console, 'warn', () => {})
  const db = backend(t, [row('p1', 1, 'https://old.example/manifest.json', 0), row('p2', 1, 'https://old.example/manifest.json', 0)])
  db.postPlan = new Array(40).fill(429)
  await assert.rejects(provider('p1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 429)
  assert.equal(supabase.isCircuitOpen(), true)
  const deletes = () => db.events.filter((e) => e.method === 'DELETE').length
  assert.equal(deletes(), 1)
  await assert.rejects(provider('p2', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 503)
  assert.equal(deletes(), 1, 'the second person was never deleted')
  assert.deepEqual(db.urls('p2', 1), ['https://old.example/manifest.json'])
})

test('the backend being held back after the delete does not stop the insert, and the cooldown is left as it was', async (t) => {
  quiet(t)
  t.mock.method(console, 'warn', () => {})
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  // Other people's 429s open the breaker right after this write's delete.
  db.afterDelete = async () => { await openBreaker(db); db.afterDelete = null }
  await provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  assert.deepEqual(db.urls('u1', 1), ['https://a.example/manifest.json'], 'the new list is there, not an empty one')
  assert.equal(supabase.isCircuitOpen(), true, 'a success of ours does not close what others opened')
  assert.equal(supabase._test.breakerState().circuitTrips, 1, 'and nothing of ours lengthened it')
})

test('the restore gets through a held-back backend as well', async (t) => {
  quiet(t)
  t.mock.method(console, 'warn', () => {})
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  db.afterDelete = async () => { await openBreaker(db); db.afterDelete = null }
  db.failPosts = 1 + nuvio._test.WRITE_RETRY.insertMs.length
  await assert.rejects(provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 500)
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'], 'the old list is back')
})

test('the restore is sent again too, so one more 429 does not leave the person empty', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  // Every try at the new list, then the first try at the restore.
  db.postPlan = [429, 429, 429, 429]
  await assert.rejects(provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 429)
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
  assert.equal(supabase.isCircuitOpen(), true, 'the 429s opened it once, and the tries that came after did not lengthen it')
  assert.equal(supabase._test.breakerState().circuitTrips, 1)
})

test('a delete that went through but was never answered leaves an empty list, and the new one is still written', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  db.afterDelete = async () => { db.afterDelete = null; throw new Error('connection dropped') }
  await provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'GET', 'POST'], 'the list was read back, found empty, and written')
  assert.deepEqual(db.urls('u1', 1), ['https://a.example/manifest.json'])
})

test('a delete that failed without deleting anything is reported as it was', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  const real = global.fetch
  global.fetch = async (url, init = {}) => (init.method === 'DELETE' ? json({}, 500) : real(url, init))
  await assert.rejects(provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 500)
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
  assert.deepEqual(db.methods(), ['GET', 'GET'], 'the read-back found the list still there, and nothing was inserted')
})

test('an insert that landed but was never answered is not undone or reported as a failure', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  // Every try lands in the table, and the answer is lost each time.
  const real = global.fetch
  global.fetch = async (url, init = {}) => {
    const res = await real(url, init)
    if (init.method === 'POST' && String(url).includes('/rest/v1/addons')) return json({}, 504)
    return res
  }
  await provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  assert.deepEqual([...new Set(db.urls('u1', 1))], ['https://a.example/manifest.json'])
  assert.equal(db.urls('u1', 1).includes('https://old.example/manifest.json'), false, 'the old list was not put back on top')
})

test('when the old list cannot be written back either, the error says so and tells them to sync', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0), row('u1', 1, 'https://old2.example/manifest.json', 1)])
  db.postPlan = new Array(20).fill(500)
  await assert.rejects(
    provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]),
    (e) => e.code === 'ADDON_LIST_NOT_RESTORED' && /could not be written back/.test(e.message) && /sync/i.test(e.message) && e.status === 500
  )
  assert.deepEqual(db.urls('u1', 1), [], 'which is the empty list it describes')
  assert.equal(db.methods().filter((m) => m === 'POST').length, 3 + 4, 'three tries at the new list, four at the restore, then it stopped')
})

test('a failed write never puts an addon address in the log', async (t) => {
  const errors = []
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')) })
  const db = backend(t, [row('u-log', 1, 'https://old.example/manifest.json?token=abc', 0)])
  db.postPlan = new Array(20).fill(500)
  await assert.rejects(provider('u-log', 1).setAddons([addon('https://a.example/manifest.json?token=xyz')]))
  assert.ok(errors.some((line) => /rollback also failed/.test(line)), 'the loss is logged')
  assert.equal(errors.some((line) => /token=/.test(line)), false, 'but with no address, and so no key')
})

test('what the backend says about a refused row is not logged, only the status and its code', async (t) => {
  const errors = []
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')) })
  backend(t, [row('u-log2', 1, 'https://old.example/manifest.json', 0)])
  const real = global.fetch
  global.fetch = async (url, init = {}) => (init.method === 'POST' && String(url).includes('/rest/v1/addons')
    ? json({ code: '23505', message: 'duplicate key', details: 'Key (user_id, profile_id, url)=(u1, 1, https://new.example/m.json?key=NEWSECRET) already exists.' }, 409)
    : real(url, init))
  await assert.rejects(provider('u-log2', 1).setAddons([addon('https://new.example/m.json?key=NEWSECRET')]), (e) => e.status === 409)
  assert.ok(errors.some((line) => /POST addons failed \(409\) code 23505/.test(line)))
  assert.equal(errors.some((line) => /NEWSECRET|new\.example/.test(line)), false)
})

test('a bad request is not sent again', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  db.postPlan = [400]
  await assert.rejects(provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 400)
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'POST', 'POST'], 'one try at the new list, one at the restore')
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
})

test('a conflict on the restore means the rows are there, so the list is not called empty', async (t) => {
  quiet(t)
  const db = backend(t, [row('u2', 1, 'https://old.example/manifest.json', 0)])
  db.postPlan = [500, 500, 500, 409]
  await assert.rejects(provider('u2', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 500 && e.code !== 'ADDON_LIST_NOT_RESTORED')
  assert.equal(db.methods().filter((m) => m === 'POST').length, 4, 'three tries at the new list, one at the restore - a conflict is not tried again')
})

test('the wait before another try is at least what the backend asked for, and never past the cap', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  nuvio._test.WRITE_RETRY.insertMs = [1]
  db.postPlan = [{ status: 429, retryAfter: 0.15 }]
  let started = Date.now()
  await provider('u1', 1).setAddons([addon('https://a.example/manifest.json')])
  assert.ok(Date.now() - started >= 140, 'waited for the Retry-After')

  nuvio._test.WRITE_RETRY.maxWaitMs = 20
  db.postPlan = [{ status: 429, retryAfter: 60 }]
  started = Date.now()
  await provider('u1', 1).setAddons([addon('https://b.example/manifest.json')])
  assert.ok(Date.now() - started < 2000, 'a minute-long Retry-After is cut to the cap')
  assert.deepEqual(db.urls('u1', 1), ['https://b.example/manifest.json'])
})

test('a write that is being sent again still holds its place in the queue', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  db.postPlan = [429]
  await Promise.all([
    provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]),
    provider('u1', 1).setAddons([addon('https://b.example/manifest.json')]),
  ])
  assert.deepEqual(db.methods(), ['GET', 'DELETE', 'POST', 'POST', 'GET', 'DELETE', 'POST'], 'the second write waited for the first to finish')
  assert.deepEqual(db.urls('u1', 1), ['https://b.example/manifest.json'])
})


// Two 429s in a row open the breaker for everyone.
async function openBreaker(db) {
  for (let i = 0; i < 2; i++) {
    await assert.rejects(supabase.supabaseGet('probe', {}, 'token'), (e) => e.status === 429)
  }
  assert.equal(supabase.isCircuitOpen(), true)
  return db
}

test('while the backend is being held back, a replace is refused and nothing is touched', async (t) => {
  quiet(t)
  t.mock.method(console, 'warn', () => {})
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  await openBreaker(db)
  const before = db.events.length
  await assert.rejects(
    provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]),
    (e) => e.status === 503 && /unavailable/i.test(e.message),
    'an ordinary failed sync, not a silent success'
  )
  assert.equal(db.events.length, before, 'no read, delete or insert was sent')
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'], 'the list is as it was')
  await assert.rejects(provider('u1', 1).clearAddons(), (e) => e.status === 503)
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
})

test('a refused write does not even sign in again first', async (t) => {
  quiet(t)
  t.mock.method(console, 'warn', () => {})
  const db = backend(t, [row('u-new', 1, 'https://old.example/manifest.json', 0)])
  await openBreaker(db)
  // Nobody has signed this login in yet, so a write that went ahead would
  // start by refreshing its token.
  await assert.rejects(provider('u-new', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 503)
  assert.equal(db.signIns, 0)
})

test('the backend being held back after the snapshot is read stops the write before the delete', async (t) => {
  quiet(t)
  const db = backend(t, [row('u1', 1, 'https://old.example/manifest.json', 0)])
  // Other people's 429s open the breaker while this write is between its
  // read and its delete. The delete is refused by its own call - the first
  // thing it does is ask the breaker - so it is never sent.
  db.onSnapshot = async () => { await openBreaker(db); db.onSnapshot = null }
  await assert.rejects(provider('u1', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 503 && /unavailable/i.test(e.message))
  assert.deepEqual(db.methods(), ['GET'], 'only the read happened - no delete, so no empty list')
  assert.deepEqual(db.urls('u1', 1), ['https://old.example/manifest.json'])
})

test('a person on a backend of their own is held back by that backend, not by the standard one', async (t) => {
  quiet(t)
  t.mock.method(console, 'warn', () => {})
  const db = backend(t, [row('u-std', 1, 'https://old.example/manifest.json', 0), row('u-own', 1, 'https://old.example/manifest.json', 0)])
  const own = { url: 'http://203.0.113.7:8000', anonKey: 'pk-example' }
  const onOwn = () => createNuvioProvider({ refreshToken: 'refresh', userId: 'u-own', profileId: 1, resolveServerConfig: async () => own })

  await openBreaker(db) // the standard backend is being held back
  await onOwn().setAddons([addon('https://a.example/manifest.json')])
  assert.deepEqual(db.urls('u-own', 1), ['https://a.example/manifest.json'], 'their own backend carries on')
  await assert.rejects(provider('u-std', 1).setAddons([addon('https://a.example/manifest.json')]), (e) => e.status === 503)

  supabase._test.resetCircuit()
  for (let i = 0; i < 2; i++) await assert.rejects(supabase.supabaseGet('probe', {}, 'token', own), (e) => e.status === 429)
  assert.equal(supabase.isCircuitOpen(own), true)
  assert.equal(supabase.isCircuitOpen(), false)
  await assert.rejects(onOwn().setAddons([addon('https://b.example/manifest.json')]), (e) => e.status === 503)
  await provider('u-std', 1).setAddons([addon('https://b.example/manifest.json')])
  assert.deepEqual(db.urls('u-std', 1), ['https://b.example/manifest.json'])
})


// ---------------------------------------------------------------- one call

test('an up-to-date backend gets the whole list in one sync_push_addons call, in order, never deleted first', async (t) => {
  const state = backend(t, [row('u1', 1, 'https://a.example/manifest.json', 0), row('u1', 1, 'https://old.example/manifest.json', 1)])
  state.pushSupported = true
  await provider('u1', 1).setAddons([addon('https://b.example/manifest.json', 'B'), addon('https://a.example/manifest.json', 'A')])
  assert.equal(state.pushes.length, 1)
  assert.deepEqual(state.pushes[0].addons, [
    { url: 'https://b.example/manifest.json', name: 'B', enabled: true, sort_order: 0 },
    { url: 'https://a.example/manifest.json', name: 'A', enabled: true, sort_order: 1 },
  ])
  assert.equal(Array.isArray(state.pushes[0].addons), true, 'the list goes as a real array, not a JSON string')
  assert.deepEqual(state.methods().filter((m) => m === 'DELETE' || m === 'POST'), [], 'nothing is deleted or inserted row by row')
  assert.deepEqual(state.urls('u1', 1), ['https://b.example/manifest.json', 'https://a.example/manifest.json'])
})

test('one call: duplicate addresses are sent once', async (t) => {
  const state = backend(t)
  state.pushSupported = true
  await provider('u1', 1).setAddons([addon('https://a.example/manifest.json'), addon('https://a.example/manifest.json'), addon('https://b.example/manifest.json')])
  assert.deepEqual(state.pushes[0].addons.map((a) => a.url), ['https://a.example/manifest.json', 'https://b.example/manifest.json'])
})

test('one call: a failure leaves the old list whole and is reported', async (t) => {
  quiet(t)
  const state = backend(t, [row('u1', 1, 'https://a.example/manifest.json', 0)])
  state.pushSupported = true
  state.pushStatus = 400
  await assert.rejects(provider('u1', 1).setAddons([addon('https://b.example/manifest.json')]))
  assert.deepEqual(state.urls('u1', 1), ['https://a.example/manifest.json'])
  assert.deepEqual(state.methods().filter((m) => m === 'DELETE' || m === 'POST'), [], 'no fallback to delete-and-insert on a real failure')
})

test('a backend without the call (404) gets delete-and-insert instead', async (t) => {
  const state = backend(t, [row('u1', 1, 'https://a.example/manifest.json', 0)])
  await provider('u1', 1).setAddons([addon('https://b.example/manifest.json')])
  assert.equal(state.pushes.length, 1, 'the one call is tried first')
  assert.deepEqual(state.urls('u1', 1), ['https://b.example/manifest.json'])
  assert.ok(state.methods().includes('DELETE') && state.methods().includes('POST'))
})

test('one call: two writes for one list still run one after the other', async (t) => {
  const state = backend(t)
  state.pushSupported = true
  await Promise.all([
    provider('u1', 1).setAddons([addon('https://first.example/manifest.json')]),
    provider('u1', 1).setAddons([addon('https://second.example/manifest.json')]),
  ])
  assert.deepEqual(state.pushes.map((p) => p.addons[0].url), ['https://first.example/manifest.json', 'https://second.example/manifest.json'])
  assert.deepEqual(state.urls('u1', 1), ['https://second.example/manifest.json'])
})
