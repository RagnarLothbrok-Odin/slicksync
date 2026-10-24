// Which server a person is, and the sign-in that proves it, are written by
// signing in to that server and by nothing else. A household that could write
// them on a person could point that person at someone else's server account
// and be handed that account's next sign-in. So the one household route that
// edits a person in place takes the two notification settings and nothing
// more. A person can also edit their own picture through the same proof
// of identity the rest of their page uses.
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const jwt = require('jsonwebtoken')

const makeUsersRouter = require('../server/routes/users')
const makePublicLibraryRouter = require('../server/routes/publicLibrary')

const SECRET = 'person-field-writes-test-secret'

function fakeDb() {
  const rows = [
    {
      id: 'p1', accountId: 'acc1', username: 'Vic', providerType: 'stremio', isActive: true,
      discordWebhookUrl: null, notifyOnWatch: true, jellyfinServerUrl: null, jellyfinUserId: null, jellyfinToken: null,
    },
    {
      id: 'j1', accountId: 'acc2', username: 'Jay', providerType: 'jellyfin', isActive: true,
      discordWebhookUrl: null, notifyOnWatch: true, jellyfinServerUrl: 'https://jelly.example.com', jellyfinUserId: 'abc', jellyfinToken: 'sealed',
    },
  ]
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v)
  const writes = []
  return {
    rows,
    writes,
    user: {
      findFirst: async ({ where }) => rows.find((r) => matches(r, where)) || null,
      findUnique: async ({ where }) => rows.find((r) => matches(r, where)) || null,
      update: async ({ where, data }) => {
        const row = rows.find((r) => matches(r, where))
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' })
        writes.push(data)
        Object.assign(row, data)
        return { ...row }
      },
      findMany: async () => [],
    },
  }
}

async function serve(t, mount) {
  const app = express()
  app.use(express.json())
  mount(app)
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  return async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
}

function household(t, db, accountId = 'acc1') {
  return serve(t, (app) => {
    app.use('/api/users', makeUsersRouter({ prisma: db, getAccountId: () => accountId, INSTANCE_TYPE: 'public' }))
  })
}

test('PATCH /users/:id takes the webhook and the notify switch', async (t) => {
  const db = fakeDb()
  const call = await household(t, db)
  const done = await call('PATCH', '/api/users/p1', { discordWebhookUrl: '  https://discord.example.com/hook  ', notifyOnWatch: false })
  assert.equal(done.status, 200)
  assert.equal(db.rows[0].discordWebhookUrl, 'https://discord.example.com/hook')
  assert.equal(db.rows[0].notifyOnWatch, false)
  assert.deepEqual(Object.keys(done.body).sort(), ['discordWebhookUrl', 'id', 'notifyOnWatch', 'username'], 'nothing secret comes back')

  const cleared = await call('PATCH', '/api/users/p1', { discordWebhookUrl: '' })
  assert.equal(cleared.status, 200)
  assert.equal(db.rows[0].discordWebhookUrl, null)
})

test('PATCH /users/:id refuses anything that says which server a person is, and writes nothing', async (t) => {
  const db = fakeDb()
  const call = await household(t, db)
  const attempts = [
    { providerType: 'jellyfin', jellyfinServerUrl: 'https://jf.victim.example', jellyfinUserId: 'victim' },
    { jellyfinToken: 'x' },
    { nuvioUserId: 'n', nuvioRefreshToken: 'r' },
    { aioConfigId: 'c', aioConfigPassword: 'p' },
    { stremioAuthKey: 'k' },
    { apiKey: 'k' },
    { accountId: 'acc2' },
    // Allowed fields do not make the others ride along.
    { notifyOnWatch: false, jellyfinUserId: 'victim' },
  ]
  for (const body of attempts) {
    const res = await call('PATCH', '/api/users/p1', body)
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  assert.deepEqual(db.writes, [], 'a refused request is never half-applied')
  assert.equal(db.rows[0].providerType, 'stremio')
  assert.equal(db.rows[0].jellyfinUserId, null)
  assert.equal(db.rows[0].notifyOnWatch, true)
})

test('PATCH /users/:id checks the values, an empty request, and whose person it is', async (t) => {
  const db = fakeDb()
  const call = await household(t, db)
  assert.equal((await call('PATCH', '/api/users/p1', {})).status, 400)
  assert.equal((await call('PATCH', '/api/users/p1', { notifyOnWatch: 'no' })).status, 400)
  assert.equal((await call('PATCH', '/api/users/p1', { discordWebhookUrl: 5 })).status, 400)
  assert.equal((await call('PATCH', '/api/users/p1', { discordWebhookUrl: 'x'.repeat(3000) })).status, 400)
  assert.equal((await call('PATCH', '/api/users/p1', [1, 2])).status, 400)
  // Another household's person is not found, not written.
  assert.equal((await call('PATCH', '/api/users/j1', { notifyOnWatch: false })).status, 404)
  assert.equal(db.rows[1].notifyOnWatch, true)
  assert.deepEqual(db.writes, [])
})

function portal(t, db) {
  return serve(t, (app) => {
    app.use('/api/public-library', makePublicLibraryRouter({
      prisma: db, DEFAULT_ACCOUNT_ID: 'default', encrypt: (v) => v, decrypt: (v) => v,
      getCachedLibrary: () => [], setCachedLibrary: () => {}, JWT_SECRET: SECRET,
    }))
  })
}
const sessionFor = (id) => jwt.sign({ sub: id, provider: 'jellyfin' }, SECRET, { expiresIn: '1h' })

test('a person changes their own two settings with the proof their page already sends', async (t) => {
  const db = fakeDb()
  const call = await portal(t, db)
  const headers = { 'x-stremio-auth': sessionFor('j1') }
  const done = await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', notifyOnWatch: false, discordWebhookUrl: ' https://discord.example.com/h ' }, headers)
  assert.equal(done.status, 200)
  assert.equal(db.rows[1].notifyOnWatch, false)
  assert.equal(db.rows[1].discordWebhookUrl, 'https://discord.example.com/h')
})

test('a person cannot change settings without proof, with someone else\'s, or reach the sign-in fields this way', async (t) => {
  const db = fakeDb()
  const call = await portal(t, db)
  const none = await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', notifyOnWatch: false })
  assert.equal(none.status, 401)
  const other = await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', notifyOnWatch: false }, { 'x-stremio-auth': sessionFor('someone-else') })
  assert.equal(other.status, 401)
  // Only editable profile settings are read; provider identity fields are never written.
  const headers = { 'x-stremio-auth': sessionFor('j1') }
  const sneaky = await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', notifyOnWatch: true, jellyfinUserId: 'victim', providerType: 'stremio' }, headers)
  assert.equal(sneaky.status, 200)
  assert.equal(db.rows[1].jellyfinUserId, 'abc')
  assert.equal(db.rows[1].providerType, 'jellyfin')
  const empty = await call('PATCH', '/api/public-library/user-settings', { userId: 'j1' }, headers)
  assert.equal(empty.status, 400)
  assert.equal((await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', notifyOnWatch: 'yes' }, headers)).status, 400)
})

test('a person can choose their own avatar but cannot change someone else or provider identity', async (t) => {
  const db = fakeDb()
  const call = await portal(t, db)
  const avatarUrl = 'https://api.dicebear.com/10.x/voxel-bot/svg?seed=choice'
  const headers = { 'x-stremio-auth': sessionFor('j1') }
  assert.equal((await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', avatarUrl, colorIndex: 3 }, headers)).status, 200)
  assert.equal(db.rows[1].avatarUrl, avatarUrl)
  assert.equal((await call('PATCH', '/api/public-library/user-settings', { userId: 'p1', avatarUrl }, headers)).status, 401)
  assert.equal((await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', avatarUrl: 'javascript:bad' }, headers)).status, 400)
  assert.equal((await call('PATCH', '/api/public-library/user-settings', { userId: 'j1', colorIndex: -1 }, headers)).status, 400)
})
