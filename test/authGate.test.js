const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const jwt = require('jsonwebtoken')
const express = require('express')

// Own secret and encryption key, so nothing here reads or writes the data folder.
const SECRET = 'unit-test-signing-secret-not-for-use'
process.env.JWT_SECRET = SECRET
process.env.ENCRYPTION_KEY = 'unit-test-encryption-key-not-for-use-0123456789'
delete process.env.INSTANCE_TYPE
delete process.env.INSTANCE

const { createAuthGate, createCsrfGuard } = require('../server/middleware/auth')
const { pathIsAllowlisted, extractBearerToken, parseCookies, cookieName, issueAccessToken, issueRefreshToken, randomCsrfToken } = require('../server/utils/auth')

// ---------------------------------------------------------------- fixtures

// Accounts by id; a missing id is a deleted account.
function fakePrisma(accounts, { failing = false } = {}) {
  const lookups = []
  return {
    lookups,
    appAccount: {
      findUnique: async ({ where }) => {
        lookups.push(where.id)
        if (failing) throw new Error('database is down')
        return accounts[where.id] ?? null
      },
    },
  }
}

const ACCOUNTS = { live: { disabled: false }, off: { disabled: true } }

function makeGate(prisma, overrides = {}) {
  return createAuthGate({
    INSTANCE_TYPE: 'public',
    PRIVATE_AUTH_ENABLED: false,
    JWT_SECRET: SECRET,
    pathIsAllowlisted,
    parseCookies,
    cookieName,
    extractBearerToken,
    issueAccessToken,
    randomCsrfToken,
    isProdEnv: () => false,
    prisma,
    ...overrides,
  })
}

// Runs one request through the gate with plain objects for req and res.
async function through(gate, { path, method = 'GET', bearer, cookies = {} }) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  const req = { method, path, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(cookie ? { cookie } : {}) } }
  const res = {
    statusCode: null,
    body: null,
    cookies: [],
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    cookie(name, value, opts) { this.cookies.push({ name, value, opts }); return this },
  }
  let nextCalled = false
  await gate(req, res, () => { nextCalled = true })
  return { req, res, nextCalled }
}

const at = (accId) => issueAccessToken(accId)
const rt = (accId) => issueRefreshToken(accId)
const sign = (claims) => jwt.sign(claims, SECRET, { expiresIn: '1d' })

// ------------------------------------------------------------ account slots

test('a valid access token opens the account; a refresh token is not an access token', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma)

  const ok = await through(gate, { path: '/api/users', bearer: at('live') })
  assert.equal(ok.nextCalled, true)
  assert.equal(ok.req.appAccountId, 'live')

  const viaCookie = await through(gate, { path: '/api/users', cookies: { sfm_at: at('live') } })
  assert.equal(viaCookie.req.appAccountId, 'live')

  const wrongKind = await through(gate, { path: '/api/users', bearer: rt('live') })
  assert.equal(wrongKind.nextCalled, false)
  assert.equal(wrongKind.res.statusCode, 401)
  assert.equal(wrongKind.res.body.message, 'Invalid or expired token')
})

test('a superadmin session, a portal session or a pending-2FA token is not a login', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma)
  const impostors = {
    superadmin: sign({ typ: 'superadmin' }),
    nuvioPortal: sign({ sub: 'user1', provider: 'nuvio' }),
    jellyfinPortal: sign({ sub: 'user1', provider: 'jellyfin' }),
    pending2fa: sign({ accId: 'live', typ: 'pending-2fa' }),
  }
  for (const [name, token] of Object.entries(impostors)) {
    for (const slot of [{ bearer: token }, { cookies: { sfm_at: token } }]) {
      const gated = await through(gate, { path: '/api/users', ...slot })
      assert.equal(gated.nextCalled, false, name)
      assert.equal(gated.res.statusCode, 401, name)
      assert.equal(gated.req.appAccountId, undefined, name)
    }
    // On an open path it just carries no account.
    const open = await through(gate, { path: '/api/public-library/user-info', bearer: token })
    assert.equal(open.nextCalled, true, name)
    assert.equal(open.req.appAccountId, undefined, name)
    // And in the refresh slot it renews nothing.
    const asRefresh = await through(gate, { path: '/api/users', cookies: { sfm_rt: token } })
    assert.equal(asRefresh.nextCalled, false, name)
    assert.equal(asRefresh.res.cookies.length, 0, name)
  }
  assert.deepEqual(prisma.lookups, [])
})

test('an access token in the refresh slot renews nothing', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const r = await through(gate, { path: '/api/users', cookies: { sfm_rt: at('live') } })
  assert.equal(r.nextCalled, false)
  assert.equal(r.res.statusCode, 401)
  assert.equal(r.res.body.message, 'Authentication required')
  assert.equal(r.res.cookies.length, 0)
})

test('tokens from before the type claim existed still log in, in either slot', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const legacy = sign({ accId: 'live' })
  const viaAccess = await through(gate, { path: '/api/users', cookies: { sfm_at: legacy } })
  assert.equal(viaAccess.req.appAccountId, 'live')
  const viaRefresh = await through(gate, { path: '/api/users', cookies: { sfm_rt: legacy } })
  assert.equal(viaRefresh.nextCalled, true)
  assert.equal(viaRefresh.req.appAccountId, 'live')
})

test('a token signed with the public placeholder is no login', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const forged = jwt.sign({ accId: 'live', typ: 'access' }, 'slicksync-dev-secret-change-me', { expiresIn: '1d' })
  const r = await through(gate, { path: '/api/users', bearer: forged })
  assert.equal(r.nextCalled, false)
  assert.equal(r.res.statusCode, 401)
})

// ------------------------------------------------------ renewal from refresh

test('with no access token at all, a valid refresh cookie renews the session', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const r = await through(gate, { path: '/api/users', cookies: { sfm_rt: rt('live') } })
  assert.equal(r.nextCalled, true)
  assert.equal(r.req.appAccountId, 'live')
  const names = r.res.cookies.map((c) => c.name).sort()
  assert.deepEqual(names, ['sfm_at', 'sfm_csrf'])
  const fresh = r.res.cookies.find((c) => c.name === 'sfm_at')
  assert.equal(jwt.verify(fresh.value, SECRET).accId, 'live')
  assert.equal(jwt.verify(fresh.value, SECRET).typ, 'access')
  assert.equal(fresh.opts.httpOnly, true)
  assert.equal(fresh.opts.maxAge, 30 * 24 * 60 * 60 * 1000)
})

test('an access token that has expired is renewed from the refresh cookie the same way', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const expired = jwt.sign({ accId: 'live', typ: 'access' }, SECRET, { expiresIn: -60 })
  const r = await through(gate, { path: '/api/users', cookies: { sfm_at: expired, sfm_rt: rt('live') } })
  assert.equal(r.nextCalled, true)
  assert.equal(r.req.appAccountId, 'live')
  assert.deepEqual(r.res.cookies.map((c) => c.name).sort(), ['sfm_at', 'sfm_csrf'])
})

test('renewal keeps the disabled and deleted checks: a disabled or deleted account does not renew', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma)

  const disabled = await through(gate, { path: '/api/users', cookies: { sfm_rt: rt('off') } })
  assert.equal(disabled.nextCalled, false)
  assert.equal(disabled.res.statusCode, 401)
  assert.equal(disabled.res.body.message, 'This account has been disabled')
  assert.equal(disabled.res.cookies.length, 0)

  const deleted = await through(gate, { path: '/api/users', cookies: { sfm_rt: rt('gone') } })
  assert.equal(deleted.nextCalled, false)
  assert.equal(deleted.res.statusCode, 401)
  assert.equal(deleted.res.body.message, 'This account no longer exists')

  // The same when the stale access token is what sent it down this path.
  const expired = jwt.sign({ accId: 'off', typ: 'access' }, SECRET, { expiresIn: -60 })
  const stale = await through(gate, { path: '/api/users', cookies: { sfm_at: expired, sfm_rt: rt('off') } })
  assert.equal(stale.res.statusCode, 401)
  assert.equal(stale.res.cookies.length, 0)
})

test('renewal cannot tell the account is allowed when the database is down, so it does not renew', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS, { failing: true }))
  const viaRefresh = await through(gate, { path: '/api/users', cookies: { sfm_rt: rt('live') } })
  assert.equal(viaRefresh.nextCalled, false)
  assert.equal(viaRefresh.res.statusCode, 503)
  assert.equal(viaRefresh.res.cookies.length, 0)
  const viaAccess = await through(gate, { path: '/api/users', bearer: at('live') })
  assert.equal(viaAccess.res.statusCode, 503)
})

test('on a sign-in path a disabled account\'s cookie is not looked up and does not block anything', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma)
  for (const path of ['/api/public-auth/login', '/api/auth/private-login', '/api/public-auth/passkey/verify', '/api/superadmin/login', '/api/public-library/user-info', '/invite/abc/check']) {
    for (const cookies of [{ sfm_at: at('off') }, { sfm_rt: rt('off') }, { sfm_at: at('gone'), sfm_rt: rt('gone') }]) {
      const r = await through(gate, { path, method: 'POST', cookies })
      assert.equal(r.nextCalled, true, path)
      assert.equal(r.res.statusCode, null, path)
    }
  }
  assert.deepEqual(prisma.lookups, [])
})

test('with no token and no refresh cookie: open paths pass, the rest are turned away', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const open = await through(gate, { path: '/api/public-auth/login', method: 'POST' })
  assert.equal(open.nextCalled, true)
  const closed = await through(gate, { path: '/api/users' })
  assert.equal(closed.nextCalled, false)
  assert.equal(closed.res.statusCode, 401)
  assert.equal(closed.res.body.message, 'Authentication required')
})

// ------------------------------------------- /api/ext and /api/health only

test('/api/ext and /api/health answer from a session only while its account is live', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma)
  for (const path of ['/api/ext/account', '/api/ext/continue-watching', '/api/health', '/api/health/']) {
    const live = await through(gate, { path, cookies: { sfm_at: at('live') } })
    assert.equal(live.nextCalled, true, path)
    assert.equal(live.req.appAccountId, 'live', path)

    for (const [accId, message] of [['off', 'This account has been disabled'], ['gone', 'This account no longer exists']]) {
      const refused = await through(gate, { path, cookies: { sfm_at: at(accId) } })
      assert.equal(refused.nextCalled, false, `${path} ${accId}`)
      assert.equal(refused.res.statusCode, 401, `${path} ${accId}`)
      assert.equal(refused.res.body.message, message)
      // ...and a refresh cookie cannot bring a disabled account back either.
      const renewed = await through(gate, { path, cookies: { sfm_rt: rt(accId) } })
      assert.equal(renewed.nextCalled, false, `${path} ${accId} renew`)
      assert.equal(renewed.res.cookies.length, 0)
    }
  }
})

test('/api/ext still lets an API key through when there is no session at all', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma)
  const r = await through(gate, { path: '/api/ext/account', bearer: '0123456789abcdef0123456789abcdef' })
  assert.equal(r.nextCalled, true)
  assert.equal(r.req.appAccountId, undefined)
  assert.deepEqual(prisma.lookups, [])
})

test('the build stamp is not held back by a disabled account\'s cookie', async () => {
  const gate = makeGate(fakePrisma(ACCOUNTS))
  const r = await through(gate, { path: '/api/health/build', cookies: { sfm_at: at('off') } })
  assert.equal(r.nextCalled, true)
})

// ------------------------------------------------------- other instance modes

test('an instance with no login of its own does not run the gate at all', async () => {
  const prisma = fakePrisma(ACCOUNTS)
  const gate = makeGate(prisma, { INSTANCE_TYPE: 'private', PRIVATE_AUTH_ENABLED: false })
  const r = await through(gate, { path: '/api/users' })
  assert.equal(r.nextCalled, true)
  assert.deepEqual(prisma.lookups, [])
})

test('a private instance with a login gates and renews the same way', async () => {
  const gate = makeGate(fakePrisma({ default: { disabled: false } }), { INSTANCE_TYPE: 'private', PRIVATE_AUTH_ENABLED: true })
  const r = await through(gate, { path: '/api/users', cookies: { sfm_rt: rt('default') } })
  assert.equal(r.nextCalled, true)
  assert.equal(r.req.appAccountId, 'default')
  const none = await through(gate, { path: '/api/users' })
  assert.equal(none.res.statusCode, 401)
})

test('with no session, the pages anyone may open stay open and the theme preference they also ask for is refused', async () => {
  // The browser asks for the theme preference on every page, so on these two
  // kinds of install a visitor to a stats link or an invite gets one 401 next
  // to the page's own open requests - the client must not treat it as a logout
  // (see the browser tests at the end of this file).
  for (const overrides of [{}, { INSTANCE_TYPE: 'private', PRIVATE_AUTH_ENABLED: true }]) {
    const gate = makeGate(fakePrisma(ACCOUNTS), overrides)
    const theme = await through(gate, { path: '/api/settings/theme-pref' })
    assert.equal(theme.nextCalled, false)
    assert.equal(theme.res.statusCode, 401)
    for (const path of ['/api/users/public-stats/abc123', '/invite/abc123', '/invite/abc123/status']) {
      assert.equal((await through(gate, { path })).nextCalled, true, path)
    }
  }
})

// ---------------------------------------------------------------------- CSRF

test('the CSRF check skips only the paths that are open, not their look-alikes', () => {
  const guard = createCsrfGuard({ INSTANCE_TYPE: 'public', PRIVATE_AUTH_ENABLED: false, pathIsAllowlisted, parseCookies, cookieName })
  const run = (path, { cookie, header, method = 'POST' } = {}) => {
    const req = { method, path, headers: { ...(cookie ? { cookie } : {}), ...(header ? { 'x-csrf-token': header } : {}) } }
    const res = { code: null, status(c) { this.code = c; return this }, json() { return this } }
    let passed = false
    guard(req, res, () => { passed = true })
    return { passed, code: res.code }
  }
  assert.equal(run('/api/auth/login').passed, true)
  assert.equal(run('/api/auth/login/').passed, true)
  assert.equal(run('/api/auth/login-reset').code, 403)
  assert.equal(run('/api/extra').code, 403)
  assert.equal(run('/api/users').code, 403)
  assert.equal(run('/api/users', { cookie: 'sfm_csrf=abc', header: 'abc' }).passed, true)
  assert.equal(run('/api/users', { method: 'GET' }).passed, true)
})

// --------------------------------------- through a real server: /api/ext, login

function listen(t, app) {
  return new Promise((resolve) => {
    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done) }))
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

test('/api/ext: a disabled account\'s session and its API key are both refused, a live one answers', async (t) => {
  const encryption = require('../server/utils/encryption')
  const crypto = require('node:crypto')
  const KEY_LIVE = 'a1'.repeat(16)
  const KEY_OFF = 'b2'.repeat(16)
  const serverKey = encryption.getServerKey()
  const sealed = (id, key) => encryption.aesGcmEncrypt(crypto.createHash('sha256').update(Buffer.concat([Buffer.from(id), serverKey])).digest(), key)
  const rows = {
    live: { id: 'live', uuid: 'u-live', email: null, disabled: false, apiKeyHash: sealed('live', KEY_LIVE), sync: null },
    off: { id: 'off', uuid: 'u-off', email: null, disabled: true, apiKeyHash: sealed('off', KEY_OFF), sync: null },
  }
  const prisma = {
    appAccount: {
      findMany: async () => Object.values(rows).map((r) => ({ id: r.id, apiKeyHash: r.apiKeyHash, disabled: r.disabled })),
      findUnique: async ({ where }) => rows[where.id] ?? null,
    },
    user: { count: async () => 0 },
    group: { count: async () => 0 },
    addon: { count: async () => 0 },
    inviteRequest: { count: async () => 0 },
  }
  const app = express()
  app.use(createAuthGate({ INSTANCE_TYPE: 'public', PRIVATE_AUTH_ENABLED: false, JWT_SECRET: SECRET, pathIsAllowlisted, parseCookies, cookieName, extractBearerToken, issueAccessToken, randomCsrfToken, isProdEnv: () => false, prisma }))
  app.use('/api/ext', require('../server/routes/externalApi')({ prisma, getAccountId: (req) => req.appAccountId, scopedWhere: () => ({}), reloadDeps: {}, syncGroupUsers: async () => {} }))
  app.post('/api/public-auth/login', (req, res) => res.json({ reached: true, appAccountId: req.appAccountId || null }))
  const base = await listen(t, app)

  const get = (path, headers = {}) => fetch(base + path, { headers })

  // Sessions
  assert.equal((await get('/api/ext/account', { cookie: `sfm_at=${at('live')}` })).status, 200)
  const offSession = await get('/api/ext/account', { cookie: `sfm_at=${at('off')}` })
  assert.equal(offSession.status, 401)
  assert.equal((await offSession.json()).message, 'This account has been disabled')
  assert.equal((await get('/api/ext/account', { cookie: `sfm_rt=${rt('off')}` })).status, 401)
  assert.equal((await get('/api/ext/account', { cookie: `sfm_at=${at('gone')}` })).status, 401)

  // API keys
  assert.equal((await get('/api/ext/account', { authorization: `Bearer ${KEY_LIVE}` })).status, 200)
  const offKey = await get('/api/ext/account', { authorization: `Bearer ${KEY_OFF}` })
  assert.equal(offKey.status, 401)
  assert.equal((await offKey.json()).message, 'This account has been disabled')
  assert.equal((await get('/api/ext/account', { authorization: `Bearer ${'c3'.repeat(16)}` })).status, 401)
  assert.equal((await get('/api/ext/account')).status, 401)

  // A disabled household's stale cookie does not stop a sign-in from the same browser.
  const login = await fetch(base + '/api/public-auth/login', { method: 'POST', headers: { cookie: `sfm_at=${at('off')}; sfm_rt=${rt('off')}` } })
  assert.equal(login.status, 200)
  assert.equal((await login.json()).reached, true)
})

// ------------------------------------------------------------ superadmin login

test('superadmin login: the right password signs in, anything else does not', async (t) => {
  const original = process.env.SUPERADMIN_PASSWORD
  t.after(() => { if (original === undefined) delete process.env.SUPERADMIN_PASSWORD; else process.env.SUPERADMIN_PASSWORD = original })
  process.env.SUPERADMIN_PASSWORD = '  correct horse battery staple  '

  const app = express()
  app.use(express.json())
  app.use('/api/superadmin', require('../server/routes/superadmin')({ prisma: {}, JWT_SECRET: SECRET, isProdEnv: () => false, cookieName, parseCookies }))
  const base = await listen(t, app)
  const login = (password) => fetch(base + '/api/superadmin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })

  const good = await login('correct horse battery staple')
  assert.equal(good.status, 200)
  const cookie = good.headers.get('set-cookie').split(';')[0]
  assert.match(cookie, /^sfm_superadmin=/)
  assert.equal((await fetch(base + '/api/superadmin/session', { headers: { cookie } })).status, 200)

  for (const wrong of ['correct horse battery stapl', 'correct horse battery staplee', 'x', '', 'CORRECT HORSE BATTERY STAPLE', 'é'.repeat(40), undefined, null, 12345]) {
    assert.equal((await login(wrong)).status, 401, String(wrong))
  }

  // An account session is not a superadmin session, and the reverse is checked by the gate tests above.
  const asAccount = await fetch(base + '/api/superadmin/session', { headers: { cookie: `sfm_superadmin=${at('live')}` } })
  assert.equal(asAccount.status, 401)

  process.env.SUPERADMIN_PASSWORD = ''
  assert.equal((await login('anything')).status, 503)
})

// ------------------------------- what the browser does with the gate's 401

// Runs the real client/lib/api.ts (compiled with the client's own TypeScript)
// against a stand-in window whose every request is answered 401, and reports
// where the page was sent. Skipped when the client's packages are not installed.
function loadApiClient(pathname) {
  const nodePath = require('node:path')
  const fs = require('node:fs')
  const vm = require('node:vm')
  const clientDir = nodePath.join(__dirname, '..', 'client')
  let ts
  try { ts = require(require.resolve('typescript', { paths: [clientDir] })) } catch { return null }

  const source = fs.readFileSync(nodePath.join(clientDir, 'lib', 'api.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })

  const stored = { slicksync_token: 'held-token' }
  const location = { pathname, href: pathname }
  const sandbox = {
    window: { location, addEventListener() {} },
    document: { cookie: '', addEventListener() {}, visibilityState: 'visible' },
    localStorage: {
      getItem: (k) => (k in stored ? stored[k] : null),
      setItem: (k, v) => { stored[k] = String(v) },
      removeItem: (k) => { delete stored[k] },
    },
    fetch: async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ message: 'Authentication required' }) }),
    process: { env: {} },
    console,
    setTimeout,
    clearTimeout,
    exports: {},
    module: { exports: {} },
  }
  vm.runInNewContext(outputText, sandbox)
  return { api: sandbox.exports.api, location, stored, pathname }
}

const BROWSER_TESTS_SKIP = loadApiClient('/') ? false : 'client packages are not installed'

// Resolves with where the page was sent (the unchanged path when it stayed) and
// whether the sign-in was kept.
async function sendRequest(pathname, call) {
  const env = loadApiClient(pathname)
  const error = await call(env.api).then(() => null, (e) => e)
  return { error, sentTo: env.location.href, keptSignIn: 'slicksync_token' in env.stored }
}

test('browser: the theme preference asked for on every page never moves anyone', { skip: BROWSER_TESTS_SKIP }, async () => {
  // Pages with no session of their own, and the ordinary ones too: it is a
  // preference, so its 401 is just "keep the colours this device has".
  for (const pathname of ['/u/abc123', '/invite/abc123', '/invite/delete', '/', '/user/library', '/settings']) {
    const r = await sendRequest(pathname, (api) => api.getThemePref())
    assert.equal(r.sentTo, pathname, pathname)
    assert.equal(r.keptSignIn, true, pathname)
    // The caller still sees the refusal; it just does not act on it.
    assert.equal(r.error.response.status, 401, pathname)
  }
})

test('browser: a 401 on the shared stats page does not send the visitor to the login page', { skip: BROWSER_TESTS_SKIP }, async () => {
  const r = await sendRequest('/u/abc123', (api) => api.getUsers())
  assert.equal(r.sentTo, '/u/abc123')
  assert.equal(r.keptSignIn, true)
})

test('browser: the /u/ exception does not reach the user pages, and ordinary pages still go to login', { skip: BROWSER_TESTS_SKIP }, async () => {
  const user = await sendRequest('/user/library', (api) => api.getUsers())
  assert.equal(user.sentTo, '/login?mode=user')
  assert.equal(user.keptSignIn, false)

  const invite = await sendRequest('/invite/abc123', (api) => api.getUsers())
  assert.equal(invite.sentTo, '/login?mode=user')

  const admin = await sendRequest('/', (api) => api.getUsers())
  assert.equal(admin.sentTo, '/login?mode=admin')
  assert.equal(admin.keptSignIn, false)
})

test('browser: the login and superadmin pages are still left where they are', { skip: BROWSER_TESTS_SKIP }, async () => {
  for (const pathname of ['/login', '/superadmin']) {
    const r = await sendRequest(pathname, (api) => api.getUsers())
    assert.equal(r.sentTo, pathname, pathname)
  }
})
