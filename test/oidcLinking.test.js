const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const jwt = require('jsonwebtoken')

// A provider of our own and a household allowlist; config.js reads these once
// when it loads, so they are set before anything is required.
process.env.JWT_SECRET = 'unit-test-signing-secret-not-for-use'
process.env.ENCRYPTION_KEY = 'unit-test-encryption-key-not-for-use-0123456789'
process.env.OIDC_ISSUER = 'https://idp.example.com'
process.env.OIDC_CLIENT_ID = 'slick-client'
process.env.OIDC_CLIENT_SECRET = 'not-a-real-secret'
process.env.OIDC_REDIRECT_URI = 'https://slick.example.com/api/public-auth/oidc/callback'
process.env.OIDC_ALLOWED_EMAILS = 'owner@example.com'
delete process.env.NODE_ENV

const publicAuth = require('../server/routes/publicAuth')
const oidc = require('../server/utils/oidc')
const { issueAccessToken, issueRefreshToken, cookieName, parseCookies } = require('../server/utils/auth')

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// The provider: discovery, token exchange and userinfo. Each test sets the
// profile the person "signs in" with.
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const ID_TOKEN = `x.${b64url({ iss: 'https://idp.example.com', aud: 'slick-client', exp: Math.floor(Date.now() / 1000) + 3600 })}.y`
const idp = { profile: {}, tokenCalls: 0 }

const realFetch = global.fetch
global.fetch = async (url, init) => {
  const u = String(url)
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, init)
  if (u === 'https://idp.example.com/.well-known/openid-configuration') {
    return json({
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      userinfo_endpoint: 'https://idp.example.com/userinfo',
    })
  }
  if (u === 'https://idp.example.com/token') {
    idp.tokenCalls += 1
    return json({ access_token: 'access-1', id_token: ID_TOKEN })
  }
  if (u === 'https://idp.example.com/userinfo') return json(idp.profile)
  throw new Error(`unexpected request to ${u}`)
}
test.after(() => { global.fetch = realFetch })

// Stands in for the AppAccount table, including the unique email.
function fakeDb(initial = []) {
  const rows = initial.map((r, i) => ({
    id: `acc-${i + 1}`, uuid: null, email: null, oidcSubject: null, linkedProvider: null,
    disabled: false, twoFactorEnabled: false, ...r,
  }))
  const find = (where) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) || null
  const appAccount = {
    findUnique: async ({ where }) => find(where),
    update: async ({ where, data }) => Object.assign(find(where), data),
    create: async ({ data }) => {
      if (data.email && rows.some((r) => r.email === data.email)) {
        throw new Error("Invalid `prisma.appAccount.create()` invocation: Unique constraint failed on the fields: (`email`) at postgres:5432")
      }
      const row = { id: `acc-${rows.length + 1}`, disabled: false, twoFactorEnabled: false, ...data }
      rows.push(row)
      return row
    },
  }
  return { rows, prisma: { appAccount } }
}

async function startApp(t, { instanceType, prisma }) {
  const router = publicAuth({
    prisma,
    INSTANCE_TYPE: instanceType,
    PRIVATE_AUTH_ENABLED: false,
    DEFAULT_ACCOUNT_ID: 'default',
    issueAccessToken,
    issueRefreshToken,
    cookieName,
    isProdEnv: () => false,
    parseCookies,
  })
  const app = express()
  app.use('/api/public-auth', router)
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}/api/public-auth`
}

const cookieHeaders = (res) => res.headers.getSetCookie()
const cookieValue = (res, name) => {
  for (const c of cookieHeaders(res)) if (c.startsWith(`${name}=`)) return c.split(';')[0].slice(name.length + 1)
  return undefined
}

// The first half of a sign-in: the browser is sent to the provider.
async function begin(base) {
  const res = await realFetch(`${base}/oidc/start`, { redirect: 'manual' })
  const location = new URL(res.headers.get('location'))
  return { res, state: location.searchParams.get('state'), cookie: cookieValue(res, 'sfm_oidc'), location }
}

// The second half: the provider sends the browser back.
async function finish(base, { state, cookie, code = 'code-1' }) {
  const res = await realFetch(`${base}/oidc/callback?code=${code}&state=${state}`, {
    redirect: 'manual',
    headers: cookie === undefined ? {} : { cookie: `sfm_oidc=${cookie}` },
  })
  return { res, location: res.headers.get('location') || '', accId: jwt.decode(cookieValue(res, 'sfm_at') || '')?.accId }
}

async function signIn(base, profile, extra = {}) {
  idp.profile = profile
  const started = await begin(base)
  return finish(base, { state: started.state, cookie: started.cookie, ...extra })
}

const errorOf = (location) => new URL(location, 'http://x').searchParams.get('oidcError')

// ---------------------------------------------------- tied to the browser

test('starting a sign-in sets an httpOnly, SameSite=Lax cookie holding the state sent to the provider', async (t) => {
  const base = await startApp(t, { instanceType: 'public', prisma: fakeDb().prisma })
  const { res, state, cookie } = await begin(base)
  assert.equal(res.status, 302)
  assert.ok(state && state.length >= 32)
  assert.equal(cookie, state)
  const header = cookieHeaders(res).find((c) => c.startsWith('sfm_oidc='))
  assert.match(header, /HttpOnly/i)
  assert.match(header, /SameSite=Lax/i)
  assert.match(header, /Path=\//)
  assert.match(header, /Max-Age=600/)
})

test('a return without the cookie is refused, signs nobody in and leaves the real sign-in usable', async (t) => {
  const db = fakeDb()
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  idp.profile = { sub: 'sub-1', email: 'a@example.com', email_verified: true }
  const started = await begin(base)
  const tokenCallsBefore = idp.tokenCalls

  const stranger = await finish(base, { state: started.state, cookie: undefined })
  assert.match(stranger.location, /^\/login\?oidcError=/)
  assert.equal(cookieValue(stranger.res, 'sfm_at'), undefined)
  assert.equal(idp.tokenCalls, tokenCallsBefore, 'the code was never exchanged')
  assert.equal(db.rows.length, 0)

  // The browser that did start it can still finish.
  const owner = await finish(base, { state: started.state, cookie: started.cookie })
  assert.equal(owner.location, '/')
  assert.ok(owner.accId)
})

test('a return with a different cookie is refused', async (t) => {
  const db = fakeDb()
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  idp.profile = { sub: 'sub-1', email: 'a@example.com', email_verified: true }
  const started = await begin(base)
  const other = await begin(base)
  const result = await finish(base, { state: started.state, cookie: other.cookie })
  assert.match(result.location, /^\/login\?oidcError=/)
  assert.equal(cookieValue(result.res, 'sfm_at'), undefined)
  assert.equal(db.rows.length, 0)
})

test('a normal sign-in succeeds and clears the cookie', async (t) => {
  const base = await startApp(t, { instanceType: 'public', prisma: fakeDb().prisma })
  const result = await signIn(base, { sub: 'sub-1', email: 'a@example.com', email_verified: true })
  assert.equal(result.location, '/')
  assert.ok(result.accId)
  const cleared = cookieHeaders(result.res).find((c) => c.startsWith('sfm_oidc='))
  assert.ok(cleared, 'the state cookie is cleared')
  assert.match(cleared, /^sfm_oidc=;/)
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/)
})

test('a callback that is replayed says the attempt expired, in words meant for the person', async (t) => {
  const base = await startApp(t, { instanceType: 'public', prisma: fakeDb().prisma })
  idp.profile = { sub: 'sub-1', email: 'a@example.com', email_verified: true }
  const started = await begin(base)
  await finish(base, { state: started.state, cookie: started.cookie })
  const again = await finish(base, { state: started.state, cookie: started.cookie })
  assert.equal(errorOf(again.location), 'This sign-in attempt has expired - try again')
})

// ----------------------------------------------------- the verified claim

test('emailVerified is true only when the provider sends the claim as true (or the text "true")', async () => {
  const cases = [
    [undefined, false],
    [false, false],
    ['false', false],
    ['yes', false],
    [1, false],
    [true, true],
    ['true', true],
    ['TRUE', true],
  ]
  for (const [claim, expected] of cases) {
    idp.profile = { sub: 'sub-1', email: 'a@example.com', ...(claim === undefined ? {} : { email_verified: claim }) }
    const { state } = await oidc.startAuthorization()
    const result = await oidc.handleCallback('code-1', state)
    assert.equal(result.emailVerified, expected, `email_verified ${JSON.stringify(claim)}`)
  }
})

test('public: an unverified email does not link onto the account that holds it and is not stored', async (t) => {
  for (const claim of [undefined, false, 'false']) {
    const db = fakeDb([{ email: 'victim@example.com' }])
    const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
    const result = await signIn(base, { sub: 'sub-evil', email: 'victim@example.com', ...(claim === undefined ? {} : { email_verified: claim }) })
    assert.equal(result.location, '/', `claim ${JSON.stringify(claim)} signs in to a new account, not an error`)
    assert.notEqual(result.accId, 'acc-1', 'not signed in as the account that holds the email')
    assert.equal(db.rows[0].oidcSubject, null, 'the existing account is untouched')
    assert.equal(db.rows.length, 2)
    assert.equal(db.rows[1].email, null)
    assert.equal(db.rows[1].oidcSubject, 'sub-evil')
  }
})

test('public: a verified email links onto the one existing account and signs in as it', async (t) => {
  const db = fakeDb([{ email: 'person@example.com', linkedProvider: 'stremio' }])
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  const result = await signIn(base, { sub: 'sub-1', email: 'person@example.com', email_verified: true })
  assert.equal(result.location, '/')
  assert.equal(result.accId, 'acc-1')
  assert.equal(db.rows.length, 1)
  assert.equal(db.rows[0].oidcSubject, 'sub-1')
  assert.equal(db.rows[0].linkedProvider, 'stremio')
})

test('public: a verified email never takes over an account already tied to another identity', async (t) => {
  const db = fakeDb([{ email: 'person@example.com', oidcSubject: 'sub-first' }])
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  const result = await signIn(base, { sub: 'sub-second', email: 'person@example.com', email_verified: true })
  assert.equal(result.location, '/')
  assert.notEqual(result.accId, 'acc-1')
  assert.equal(db.rows[0].oidcSubject, 'sub-first', 'the first identity stays')
  assert.equal(db.rows[1].email, null, 'the address stays with the account that has it')
})

test('public: a subject that is already linked just signs in', async (t) => {
  const db = fakeDb([{ email: 'person@example.com', oidcSubject: 'sub-1' }, { email: 'other@example.com' }])
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  // The address in the claim now names a different account; the subject decides.
  const result = await signIn(base, { sub: 'sub-1', email: 'other@example.com', email_verified: false })
  assert.equal(result.accId, 'acc-1')
  assert.equal(db.rows.length, 2)
  assert.equal(db.rows[1].oidcSubject, null)
})

test('public: a new account keeps a verified email nobody else holds, and drops an unverified one', async (t) => {
  const db = fakeDb()
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  await signIn(base, { sub: 'sub-1', email: 'new@example.com', email_verified: true, name: 'New Person' })
  await signIn(base, { sub: 'sub-2', email: 'free@example.com' })
  assert.equal(db.rows[0].email, 'new@example.com')
  assert.equal(db.rows[0].displayName, 'New Person')
  assert.equal(db.rows[1].email, null)
})

// ------------------------------------------------------- household installs

test('private: the allowlist still matches the email as the provider reports it, verified or not', async (t) => {
  const db = fakeDb([{ id: 'default' }])
  const base = await startApp(t, { instanceType: 'private', prisma: db.prisma })
  const allowed = await signIn(base, { sub: 'sub-1', email: 'owner@example.com' })
  assert.equal(allowed.location, '/')
  assert.equal(allowed.accId, 'default')
  assert.equal(db.rows[0].oidcSubject, 'sub-1')

  const sentAway = await signIn(base, { sub: 'sub-2', email: 'stranger@example.com', email_verified: true })
  assert.equal(errorOf(sentAway.location), 'This identity is not allowed to sign in')
  assert.equal(cookieValue(sentAway.res, 'sfm_at'), undefined)
})

test('private: a return that arrives without the cookie still signs in, because the install may be opened by more than one name', async (t) => {
  // The cookie only reaches the name the sign-in was started on; the provider
  // sends the browser back to the address in OIDC_REDIRECT_URI, which can be another.
  const db = fakeDb([{ id: 'default' }])
  const base = await startApp(t, { instanceType: 'private', prisma: db.prisma })
  idp.profile = { sub: 'sub-1', email: 'owner@example.com' }
  const started = await begin(base)
  const result = await finish(base, { state: started.state, cookie: undefined })
  assert.equal(result.location, '/')
  assert.equal(result.accId, 'default')
  assert.equal(db.rows[0].oidcSubject, 'sub-1')
})

test('private: the pending state held here is still required without the cookie', async (t) => {
  const db = fakeDb([{ id: 'default' }])
  const base = await startApp(t, { instanceType: 'private', prisma: db.prisma })
  idp.profile = { sub: 'sub-1', email: 'owner@example.com' }
  const tokenCallsBefore = idp.tokenCalls

  const unknown = await finish(base, { state: 'f'.repeat(43), cookie: undefined })
  assert.equal(errorOf(unknown.location), 'This sign-in attempt has expired - try again')
  assert.equal(cookieValue(unknown.res, 'sfm_at'), undefined)

  // And a state is single use: the same return again finds nothing pending.
  const started = await begin(base)
  assert.equal((await finish(base, { state: started.state, cookie: undefined })).location, '/')
  const replay = await finish(base, { state: started.state, cookie: undefined })
  assert.equal(errorOf(replay.location), 'This sign-in attempt has expired - try again')
  assert.equal(idp.tokenCalls, tokenCallsBefore + 1, 'only the real attempt reached the provider')
})

test('private: a return carrying a different cookie is still refused', async (t) => {
  const db = fakeDb([{ id: 'default' }])
  const base = await startApp(t, { instanceType: 'private', prisma: db.prisma })
  idp.profile = { sub: 'sub-1', email: 'owner@example.com' }
  const started = await begin(base)
  const other = await begin(base)
  const tokenCallsBefore = idp.tokenCalls
  const result = await finish(base, { state: started.state, cookie: other.cookie })
  assert.equal(errorOf(result.location), 'This sign-in was not started in this browser - try again')
  assert.equal(cookieValue(result.res, 'sfm_at'), undefined)
  assert.equal(idp.tokenCalls, tokenCallsBefore, 'the code was never exchanged')
  assert.equal(db.rows[0].oidcSubject, null)
})

// -------------------------------------------------- what an error redirect says

test('a database failure in the callback sends a fixed message, never the database text', async (t) => {
  const db = fakeDb()
  db.prisma.appAccount.findUnique = async () => {
    throw new Error("Invalid `prisma.appAccount.findUnique()` invocation: Can't reach database server at postgres:5432")
  }
  const logged = []
  t.mock.method(console, 'error', (...args) => { logged.push(args) })
  const base = await startApp(t, { instanceType: 'public', prisma: db.prisma })
  const result = await signIn(base, { sub: 'sub-1', email: 'a@example.com', email_verified: true })
  assert.equal(errorOf(result.location), 'Sign-in failed')
  assert.ok(!result.location.includes('postgres'))
  assert.ok(logged.some((args) => String(args[1]?.message || '').includes('postgres:5432')), 'the real error is logged')
})

test('a failure to reach the provider while starting also shows a fixed message', async (t) => {
  const base = await startApp(t, { instanceType: 'public', prisma: fakeDb().prisma })
  const saved = global.fetch
  t.after(() => { global.fetch = saved })
  global.fetch = async (url, init) => {
    if (String(url).includes('idp.example.com')) throw new TypeError('fetch failed: connect ECONNREFUSED 203.0.113.9:443')
    return saved(url, init)
  }
  t.mock.method(console, 'error', () => {})
  // The provider's discovery document is cached after the earlier tests; a
  // fresh copy of the module has none, so the lookup really goes out.
  delete require.cache[require.resolve('../server/utils/oidc')]
  const res = await realFetch(`${base}/oidc/start`, { redirect: 'manual' })
  assert.equal(res.status, 302)
  assert.equal(errorOf(res.headers.get('location')), 'Failed to start SSO login')
  assert.ok(!String(res.headers.get('location')).includes('203.0.113.9'))
  assert.equal(cookieValue(res, 'sfm_oidc'), undefined, 'no cookie when nothing was started')
})
