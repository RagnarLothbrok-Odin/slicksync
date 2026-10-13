const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const express = require('express')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = 'unit-test-signing-secret-not-for-use'
process.env.ENCRYPTION_KEY = 'unit-test-encryption-key-not-for-use-0123456789'
delete process.env.NODE_ENV
delete process.env.MAX_PUBLIC_ACCOUNTS

// The two sign-ins that would call out to Stremio and Nuvio are answered
// locally; the router picks these up when it loads.
require('../server/utils/stremio').validateStremioAuthKey = async () => ({ user: { email: 'person@example.com' } })
require('../server/providers/nuvioAuth').exchangeNuvioTvLogin = async () => ({
  user: { id: 'nuvio-user-1', email: 'person@example.com' },
  refreshToken: 'refresh-1',
})

const publicAuth = require('../server/routes/publicAuth')
const jellyfinConnect = require('../server/utils/jellyfinConnect')
const { identityEmail } = require('../server/providers/jellyfinAuth')
const twoFactor = require('../server/utils/twoFactor')
const webauthn = require('../server/utils/webauthn')
const { issueAccessToken, issueRefreshToken, cookieName, parseCookies, verifyAccountToken } = require('../server/utils/auth')

const DB_ERROR = "Invalid `prisma.appAccount.findUnique()` invocation: Can't reach database server at `postgres:5432`"
const GENERIC = 'Something went wrong - please try again'
const realFetch = global.fetch

async function startApp(t, options = {}) {
  const {
    prisma, instanceType = 'public', privateAuth = null, account = null, encrypt = (value) => `enc:${value}`, extra = {},
  } = options
  const router = publicAuth({
    prisma,
    INSTANCE_TYPE: instanceType,
    PRIVATE_AUTH_ENABLED: !!privateAuth,
    PRIVATE_AUTH_USERNAME: privateAuth?.username ?? null,
    PRIVATE_AUTH_PASSWORD: privateAuth?.password ?? null,
    DEFAULT_ACCOUNT_ID: 'default',
    issueAccessToken,
    issueRefreshToken,
    cookieName,
    isProdEnv: () => false,
    parseCookies,
    verifyAccountToken,
    encrypt,
    ...extra,
  })
  const app = express()
  app.use(express.json())
  // Stands in for the sign-in gate: some routes only run for a known account.
  app.use((req, _res, next) => { if (account) req.appAccountId = account; next() })
  app.use('/api/public-auth', router)
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}/api/public-auth`
}

const post = (base, path, body = {}, headers = {}) =>
  realFetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

// A database that is down: every query fails with text a person must not see.
function brokenPrisma() {
  const fail = async () => { throw new Error(DB_ERROR) }
  const model = new Proxy({}, { get: () => fail })
  return new Proxy({}, { get: () => model })
}

// ------------------------------------------------------ what a failure says

const FAILING_ROUTES = [
  ['register', '/register', { uuid: '3f1c7a52-9b6e-4d0a-8c1e-2a5b7d9e4f10', password: 'abcd' }],
  ['login', '/login', { uuid: 'someone', password: 'pw' }],
  ['verify-2fa', '/verify-2fa', () => ({ pendingToken: twoFactor.createPendingChallenge('acc-1'), code: '123456' })],
  ['passkey/options', '/passkey/options', {}],
  ['passkey/verify', '/passkey/verify', () => {
    webauthn.putChallenge('auth:challenge-1', { challenge: 'c', rpID: '127.0.0.1', origin: 'http://127.0.0.1' })
    return { challengeId: 'challenge-1', credential: { id: 'credential-1' } }
  }],
  ['stremio-login', '/stremio-login', { authKey: 'key-1' }],
  ['nuvio-login', '/nuvio-login', { code: 'c', deviceNonce: 'n', anonToken: 'a' }],
  ['unlink-stremio', '/unlink-stremio', { password: 'pw' }],
  ['unlink-uuid', '/unlink-uuid', {}],
  ['set-credentials', '/set-credentials', { password: 'abcd' }],
]

for (const [name, path, body] of FAILING_ROUTES) {
  test(`${name}: a database failure answers with a fixed message and logs the real error`, async (t) => {
    const logged = []
    t.mock.method(console, 'error', (...args) => { logged.push(args) })
    const base = await startApp(t, { prisma: brokenPrisma(), account: 'acc-1' })
    const res = await post(base, path, typeof body === 'function' ? body() : body)
    const text = await res.text()
    assert.equal(res.status, 500)
    assert.ok(!text.includes('postgres'), `body leaked: ${text}`)
    assert.ok(!text.includes('invocation'), `body leaked: ${text}`)
    assert.equal(JSON.parse(text).message, GENERIC)
    assert.ok(logged.some((args) => args.some((a) => String(a?.message || a).includes('postgres:5432'))), 'the real error is logged')
  })
}

test('me: a database failure answers with a fixed message', async (t) => {
  t.mock.method(console, 'error', () => {})
  const base = await startApp(t, { prisma: brokenPrisma(), account: 'acc-1' })
  const res = await realFetch(`${base}/me`)
  const text = await res.text()
  assert.equal(res.status, 500)
  assert.ok(!text.includes('postgres'))
  assert.equal(JSON.parse(text).message, GENERIC)
})

test('private-login: a database failure answers with a fixed message', async (t) => {
  t.mock.method(console, 'error', () => {})
  const base = await startApp(t, { prisma: brokenPrisma(), instanceType: 'private', privateAuth: { username: 'admin', password: 'correct horse' } })
  const res = await post(base, '/private-login', { username: 'admin', password: 'correct horse' })
  const text = await res.text()
  assert.equal(res.status, 500)
  assert.ok(!text.includes('postgres'))
  assert.equal(JSON.parse(text).message, GENERIC)
})

test('reset and account deletion no longer echo the error either', async (t) => {
  t.mock.method(console, 'error', () => {})
  const base = await startApp(t, { prisma: brokenPrisma(), account: 'acc-1' })
  for (const [method, path] of [['POST', '/reset'], ['DELETE', '/account']]) {
    const res = await realFetch(`${base}${path}`, { method })
    const body = await res.json()
    assert.equal(res.status, 500, path)
    assert.ok(!JSON.stringify(body).includes('postgres'), path)
    assert.equal(body.error, undefined, path)
  }
})

test('a sign-in the person can fix keeps its own explanation', async (t) => {
  const base = await startApp(t, {
    prisma: { appAccount: { findUnique: async () => null } },
  })
  const wrongId = await post(base, '/login', { uuid: 'nobody', password: 'pw' })
  assert.equal(wrongId.status, 401)
  assert.equal((await wrongId.json()).message, 'Invalid credentials')
  const missing = await post(base, '/login', {})
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).message, 'uuid and password are required')
})

// ----------------------------------------------- the household's own password

test('private-login: the right credentials sign in, spaces around them are ignored', async (t) => {
  const prisma = { appAccount: { findUnique: async () => ({ twoFactorEnabled: false }) } }
  const base = await startApp(t, { prisma, instanceType: 'private', privateAuth: { username: 'admin', password: 'pässwörd ✓' } })
  const res = await post(base, '/private-login', { username: '  admin ', password: ' pässwörd ✓  ' })
  assert.equal(res.status, 200)
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('sfm_at=')))
})

test('private-login: a wrong name, a wrong password or a different length is refused', async (t) => {
  const prisma = { appAccount: { findUnique: async () => ({ twoFactorEnabled: false }) } }
  const base = await startApp(t, { prisma, instanceType: 'private', privateAuth: { username: 'admin', password: 'correct horse' } })
  const attempts = [
    { username: 'admin', password: 'correct hors' },
    { username: 'admin', password: 'correct horse battery staple' },
    { username: 'admin', password: 'x' },
    { username: 'adm1n', password: 'correct horse' },
    { username: 'a', password: 'correct horse' },
    { username: 'root', password: 'nope' },
  ]
  for (const body of attempts) {
    const res = await post(base, '/private-login', body)
    assert.equal(res.status, 401, JSON.stringify(body))
    assert.equal((await res.json()).message, 'Invalid credentials')
    assert.equal(res.headers.getSetCookie().length, 0)
  }
})

test('private-login: both answers are worked out even when the name is already wrong', async (t) => {
  const prisma = { appAccount: { findUnique: async () => ({ twoFactorEnabled: false }) } }
  const base = await startApp(t, { prisma, instanceType: 'private', privateAuth: { username: 'admin', password: 'correct horse' } })
  const compare = t.mock.method(crypto, 'timingSafeEqual')
  const res = await post(base, '/private-login', { username: 'wrong', password: 'also wrong' })
  assert.equal(res.status, 401)
  assert.equal(compare.mock.callCount(), 2)
})

// ---------------------------------------- who is already signed in (jellyfin)

const SERVER = { serverUrl: 'https://jf.example.com', serverId: 'server-1', kind: 'jellyfin', kindLabel: 'Jellyfin' }
const LOGIN = { userId: 'jf-user-1', userName: 'alice', token: 'jf-token-1', serverId: 'server-1' }
const IDENTITY = identityEmail(SERVER.serverUrl, LOGIN.userId)

function jellyfinDb(rows = []) {
  const events = []
  const accounts = rows.map((r) => ({ uuid: null, email: null, passwordHash: null, linkedProvider: null, ...r }))
  const find = (where) => accounts.find((a) => Object.entries(where).every(([k, v]) => a[k] === v)) || null
  const prisma = {
    appAccount: {
      findUnique: async ({ where }) => find(where),
      update: async ({ where, data }) => Object.assign(find(where), data),
      create: async ({ data }) => { const row = { id: `new-${accounts.length + 1}`, ...data }; accounts.push(row); events.push(['create', row.id]); return row },
    },
    user: {
      findFirst: async ({ where }) => (where.accountId === 'acc-1' && where.jellyfinUserId === LOGIN.userId ? { id: 'person-1' } : null),
      update: async () => ({}),
      create: async ({ data }) => ({ id: 'person-new', ...data }),
    },
  }
  return { prisma, events, accounts, calls: [] }
}

// The server sign-in itself is answered locally; what the route does with the
// result, and when it hands the fresh token to the other rows, is recorded.
function stubJellyfin(t, db) {
  const saved = { signInFromBody: jellyfinConnect.signInFromBody, rememberSignIn: jellyfinConnect.rememberSignIn }
  jellyfinConnect.signInFromBody = async () => ({ probe: SERVER, login: LOGIN })
  jellyfinConnect.rememberSignIn = async (...args) => { db.events.push(['remember']); db.calls.push(args) }
  t.after(() => Object.assign(jellyfinConnect, saved))
}

const sessionCookie = (cookies) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')

// A server retires the token a device held the moment that device signs in
// again. So the fresh one goes to the rows holding that login straight after
// the sign-in, before anything that can still refuse - otherwise a refused
// request leaves those rows with a token that has just stopped working.
test('jellyfin-login: the fresh sign-in is handed to the rows holding it before anything else happens', async (t) => {
  const db = jellyfinDb()
  stubJellyfin(t, db)
  const base = await startApp(t, { prisma: db.prisma })
  const res = await post(base, '/jellyfin-login', { serverUrl: SERVER.serverUrl })
  assert.equal(res.status, 200)
  assert.deepEqual(db.events, [['remember'], ['create', 'new-1']])
  assert.equal(db.calls[0][0], db.prisma)
  assert.equal(db.calls[0][2], SERVER)
  assert.equal(db.calls[0][3], LOGIN)
  // Which rows take it is decided by the server address, not by a household.
  assert.equal(db.calls[0].length, 4)
})

test('jellyfin-login: a sign-in refused as already linked elsewhere still hands the fresh token over', async (t) => {
  const db = jellyfinDb([{ id: 'acc-1', email: 'mine@example.com' }, { id: 'acc-2', email: IDENTITY }])
  stubJellyfin(t, db)
  const base = await startApp(t, { prisma: db.prisma })
  const res = await post(base, '/jellyfin-login', {}, { cookie: sessionCookie({ sfm_at: issueAccessToken('acc-1') }) })
  assert.equal(res.status, 409)
  assert.deepEqual(db.events, [['remember']])
})

test('jellyfin-login: a signed-in account is found from either session cookie', async (t) => {
  for (const cookies of [{ sfm_at: issueAccessToken('acc-1') }, { sfm_rt: issueRefreshToken('acc-1') }]) {
    const db = jellyfinDb([{ id: 'acc-1' }])
    stubJellyfin(t, db)
    const base = await startApp(t, { prisma: db.prisma })
    const res = await post(base, '/jellyfin-login', {}, { cookie: sessionCookie(cookies) })
    assert.equal(res.status, 200, Object.keys(cookies)[0])
    // Linked to the signed-in account, not a new one.
    assert.equal(db.accounts.length, 1)
    assert.equal(db.accounts[0].email, IDENTITY)
    assert.deepEqual(db.events, [['remember']])
  }
})

test('jellyfin-login: a token that is not an account session does not pass as a sign-in', async (t) => {
  const secret = process.env.JWT_SECRET
  const notAccounts = [
    jwt.sign({ typ: 'superadmin' }, secret),
    jwt.sign({ accId: 'acc-1', typ: 'superadmin' }, secret),
    jwt.sign({ accId: 'acc-1', typ: 'portal' }, secret),
    jwt.sign({ sub: 'person-1', provider: 'nuvio' }, secret),
  ]
  for (const token of notAccounts) {
    const db = jellyfinDb([{ id: 'acc-1' }])
    stubJellyfin(t, db)
    const base = await startApp(t, { prisma: db.prisma })
    const res = await post(base, '/jellyfin-login', {}, { cookie: sessionCookie({ sfm_at: token }) })
    assert.equal(res.status, 200)
    // Treated as nobody signed in: a new account for the server login.
    assert.equal(db.accounts.length, 2)
    assert.equal(db.accounts[0].email, null, 'acc-1 was not linked')
    assert.deepEqual(db.events, [['remember'], ['create', 'new-2']])
  }
})

test('jellyfin-login: a token signed with some other secret does not pass either', async (t) => {
  const db = jellyfinDb([{ id: 'acc-1' }])
  stubJellyfin(t, db)
  const base = await startApp(t, { prisma: db.prisma })
  const forged = jwt.sign({ accId: 'acc-1', typ: 'access' }, 'a-secret-that-is-not-ours')
  const res = await post(base, '/jellyfin-login', {}, { cookie: sessionCookie({ sfm_at: forged }) })
  assert.equal(res.status, 200)
  assert.equal(db.accounts[0].email, null)
})
