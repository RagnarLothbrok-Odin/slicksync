// An exported file can say any server address and server user id on a person.
// On an instance serving strangers, a person row that holds another
// household's address and user id is handed that household's next sign-in
// (jellyfinConnect.rememberSignIn). So an import there keeps a Jellyfin
// identity only once the server vouches that the token in the file is that
// user's, and a household's own install imports as it always did.
const test = require('node:test')
const assert = require('node:assert/strict')
const dns = require('node:dns').promises
const express = require('express')

const config = require('../server/utils/config')
const connect = require('../server/utils/jellyfinConnect')
const makePublicAuthRouter = require('../server/routes/publicAuth')

const realFetch = global.fetch
const configuredType = config.INSTANCE_TYPE
const instanceType = (t, type) => {
  config.INSTANCE_TYPE = type
  t.after(() => { config.INSTANCE_TYPE = configuredType })
}

const VICTIM_ID = 'abcdef0123456789abcdef0123456789'
const MINE_ID = '11112222333344445555666677778888'

// Names resolve to a public address, never the network.
function publicNames(t, names) {
  const original = dns.lookup
  dns.lookup = async (host) => {
    if (!names.includes(host)) { const e = new Error(`getaddrinfo ENOTFOUND ${host}`); e.code = 'ENOTFOUND'; throw e }
    return [{ address: '93.184.216.34', family: 4 }]
  }
  t.after(() => { dns.lookup = original })
}

// Servers that know which token is whose, and how many times they were asked.
function fakeServers(t, servers, ownBases = []) {
  const asked = []
  global.fetch = async (input, init = {}) => {
    if (ownBases.some((b) => String(input).startsWith(b))) return realFetch(input, init)
    const url = new URL(String(input))
    asked.push(url.origin)
    const server = servers[url.origin]
    if (!server) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    if (url.pathname.endsWith('/Users/Me')) {
      const token = /Token="([^"]+)"/.exec(init.headers?.Authorization || '')?.[1]
      const id = server.tokens[token]
      if (!id) return new Response('{}', { status: 401 })
      return new Response(JSON.stringify({ Id: id.toUpperCase(), Name: 'Someone' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  t.after(() => { global.fetch = realFetch })
  return asked
}

const SERVERS = {
  'https://jf.victim.example': { tokens: { 'victim-token': VICTIM_ID } },
  'https://aio.example.net': { tokens: { 'owner-token': MINE_ID, 'kid-token': 'kid00000000000000000000000000001' } },
}

test('a sign-in in the file is kept when the server says the token is that user\'s', async (t) => {
  instanceType(t, 'public')
  publicNames(t, ['jf.victim.example'])
  fakeServers(t, SERVERS)
  const own = { username: 'Vic', jellyfinServerUrl: 'https://jf.victim.example/', jellyfinUserId: 'ABCDEF01-2345-6789-ABCD-EF0123456789', jellyfinToken: 'victim-token' }
  const { personUrl } = await connect.proveImportedSignIns([own])
  assert.equal(personUrl.get(own), 'https://jf.victim.example', 'kept, as the normalised address a sign-in stores')
})

test('a file that claims another household\'s server user without their token keeps none of it', async (t) => {
  instanceType(t, 'public')
  publicNames(t, ['jf.victim.example'])
  const asked = fakeServers(t, SERVERS)
  const forged = [
    { username: 'a', jellyfinServerUrl: 'https://jf.victim.example', jellyfinUserId: VICTIM_ID, jellyfinToken: null },
    { username: 'b', jellyfinServerUrl: 'https://jf.victim.example', jellyfinUserId: VICTIM_ID, jellyfinToken: 'guess' },
    // A real token of someone else on that server.
    { username: 'c', jellyfinServerUrl: 'https://jf.victim.example', jellyfinUserId: 'someoneelse', jellyfinToken: 'victim-token' },
    { username: 'd', jellyfinServerUrl: '', jellyfinUserId: VICTIM_ID, jellyfinToken: 'victim-token' },
  ]
  const { personUrl } = await connect.proveImportedSignIns(forged)
  for (const row of forged) assert.equal(personUrl.get(row), null, row.username)
  assert.ok(asked.length <= 2, 'only a request that could prove something is sent')
})

test('an address this instance may not reach proves nothing and is never asked', async (t) => {
  instanceType(t, 'public')
  publicNames(t, []) // nothing resolves to a public address
  const asked = fakeServers(t, { 'http://127.0.0.1:8096': { tokens: { t: VICTIM_ID } }, 'http://10.0.0.5:8096': { tokens: { t: VICTIM_ID } } })
  const rows = [
    { jellyfinServerUrl: 'http://127.0.0.1:8096', jellyfinUserId: VICTIM_ID, jellyfinToken: 't' },
    { jellyfinServerUrl: 'http://10.0.0.5:8096', jellyfinUserId: VICTIM_ID, jellyfinToken: 't' },
  ]
  const { personUrl } = await connect.proveImportedSignIns(rows)
  for (const row of rows) assert.equal(personUrl.get(row), null)
  assert.deepEqual(asked, [])
})

test('a household profile\'s token is proven against its owner\'s address, and only for a proven owner', async (t) => {
  instanceType(t, 'public')
  publicNames(t, ['aio.example.net', 'jf.victim.example'])
  fakeServers(t, SERVERS)
  const kid = { name: 'Kid', jellyfinUserId: 'kid00000000000000000000000000001', token: 'kid-token' }
  const forgedKid = { name: 'Forged', jellyfinUserId: VICTIM_ID, token: 'kid-token' }
  const noToken = { name: 'Pin', jellyfinUserId: 'kid00000000000000000000000000002', token: null }
  const owner = {
    username: 'Owner', jellyfinServerUrl: 'https://aio.example.net/jellyfin/u/abc', jellyfinUserId: MINE_ID, jellyfinToken: 'owner-token',
    jellyfinHousehold: { ref: 'r1', profiles: [kid, forgedKid, noToken] },
  }
  const stranger = {
    username: 'Stranger', jellyfinServerUrl: 'https://aio.example.net/jellyfin/u/abc', jellyfinUserId: MINE_ID, jellyfinToken: 'not-owners',
    jellyfinHousehold: { ref: 'r2', profiles: [{ ...kid }] },
  }
  const { personUrl, profileProven } = await connect.proveImportedSignIns([owner, stranger])
  assert.equal(personUrl.get(owner), 'https://aio.example.net/jellyfin/u/abc')
  assert.equal(profileProven.get(kid), true)
  assert.equal(profileProven.get(forgedKid), false, 'a token that is not that profile\'s user')
  assert.equal(profileProven.get(noToken), false)
  assert.equal(personUrl.get(stranger), null)
  assert.equal(profileProven.get(stranger.jellyfinHousehold.profiles[0]), false, 'the owner was not proven, so neither is what hangs off it')
})

test('only so many servers are asked, a few at a time', async (t) => {
  instanceType(t, 'public')
  publicNames(t, ['jf.victim.example'])
  let live = 0
  let peak = 0
  let calls = 0
  global.fetch = async () => {
    calls++
    live++
    peak = Math.max(peak, live)
    await new Promise((r) => setTimeout(r, 5))
    live--
    return new Response(JSON.stringify({ Id: VICTIM_ID }), { status: 200 })
  }
  t.after(() => { global.fetch = realFetch })
  const rows = Array.from({ length: 30 }, (_, i) => ({ jellyfinServerUrl: 'https://jf.victim.example', jellyfinUserId: VICTIM_ID, jellyfinToken: `t${i}` }))
  const { personUrl } = await connect.proveImportedSignIns(rows, { limit: 3, max: 10 })
  assert.equal(calls, 10)
  assert.ok(peak <= 3, `peak ${peak}`)
  assert.equal(rows.filter((r) => personUrl.get(r)).length, 10, 'the ones past the limit count as unproven')
})

// ---------------------------------------------------------------- the route

// A database that keeps what an import creates and answers everything else empty.
function importDb() {
  const created = { user: [], jellyfinProfile: [] }
  const model = (name) => new Proxy({}, {
    get: (_o, method) => async (args = {}) => {
      if (method === 'create' && created[name]) {
        const row = { id: `${name}${created[name].length + 1}`, ...args.data }
        created[name].push(row)
        return row
      }
      if (method === 'findMany') return []
      if (method === 'count') return 0
      if (method === 'deleteMany' || method === 'updateMany') return { count: 0 }
      return null
    },
  })
  const prisma = new Proxy({}, { get: (_o, name) => (name === '$transaction' ? async (f) => (typeof f === 'function' ? f(prisma) : Promise.all(f)) : model(name)) })
  return { prisma, created }
}

async function runImport(t, type, users) {
  instanceType(t, type)
  const { prisma, created } = importDb()
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use((req, _res, next) => { req.appAccountId = 'acc1'; next() })
  app.use('/api/public-auth', makePublicAuthRouter({
    prisma, getAccountId: () => 'acc1', INSTANCE_TYPE: type, DEFAULT_ACCOUNT_ID: 'default',
    encrypt: (v) => `sealed:${v}`, decrypt: (v) => v, scopedWhere: () => ({}),
  }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  t.after(() => server.close())
  const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/public-auth/config-import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonData: JSON.stringify({ users, groups: [], addons: [] }) }),
  })
  return { status: res.status, created }
}

const fileUsers = () => [
  { username: 'Honest', providerType: 'jellyfin', jellyfinServerUrl: 'https://aio.example.net/jellyfin/u/abc', jellyfinServerId: 's1', jellyfinUserId: MINE_ID, jellyfinUserName: 'Honest', jellyfinToken: 'owner-token',
    jellyfinHousehold: { ref: 'h1', profiles: [{ ref: 'p1', jellyfinUserId: 'kid00000000000000000000000000001', name: 'Kid', token: 'kid-token' }, { ref: 'p2', jellyfinUserId: VICTIM_ID, name: 'Forged', token: 'victim-token' }] } },
  { username: 'Forger', providerType: 'jellyfin', jellyfinServerUrl: 'https://jf.victim.example', jellyfinServerId: 's2', jellyfinUserId: VICTIM_ID, jellyfinUserName: 'Victim', jellyfinToken: null },
]

test('import on an instance serving strangers: proven sign-ins are kept, a forged one is emptied', async (t) => {
  publicNames(t, ['aio.example.net', 'jf.victim.example'])
  fakeServers(t, SERVERS, [])
  // The test's own requests go to the loopback server.
  const originalFetch = global.fetch
  global.fetch = (input, init) => (String(input).startsWith('http://127.0.0.1') ? realFetch(input, init) : originalFetch(input, init))
  const { status, created } = await runImport(t, 'public', fileUsers())
  assert.equal(status, 200)
  const [honest, forger] = created.user
  assert.equal(honest.jellyfinServerUrl, 'https://aio.example.net/jellyfin/u/abc')
  assert.equal(honest.jellyfinUserId, MINE_ID)
  assert.equal(honest.jellyfinToken, 'sealed:owner-token')
  assert.equal(forger.jellyfinServerUrl, null)
  assert.equal(forger.jellyfinServerId, null)
  assert.equal(forger.jellyfinUserId, null)
  assert.equal(forger.jellyfinToken, null)
  const [kid, forgedKid] = created.jellyfinProfile
  assert.equal(kid.token, 'sealed:kid-token')
  assert.equal(forgedKid.token, null, 'a profile token that is not that user\'s is dropped')
})

test('import on a household install is unchanged: nothing is asked of any server', async (t) => {
  let outbound = 0
  const originalFetch = global.fetch
  global.fetch = (input, init) => {
    if (String(input).startsWith('http://127.0.0.1')) return realFetch(input, init)
    outbound++
    throw new Error('no outbound requests expected')
  }
  t.after(() => { global.fetch = originalFetch })
  const { status, created } = await runImport(t, 'private', fileUsers())
  assert.equal(status, 200)
  const [honest, forger] = created.user
  assert.equal(honest.jellyfinToken, 'sealed:owner-token')
  assert.equal(forger.jellyfinServerUrl, 'https://jf.victim.example')
  assert.equal(forger.jellyfinUserId, VICTIM_ID)
  assert.equal(created.jellyfinProfile.length, 2)
  assert.equal(created.jellyfinProfile[1].token, 'sealed:victim-token')
  assert.equal(outbound, 0)
})
