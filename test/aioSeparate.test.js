// Keeping an AIOStreams household user separate (AIOStreams 2.36): hidden,
// with a personal sign-in address. server/utils/aioHousehold.js, and the
// address rules in server/providers/jellyfinAuth.js.
const test = require('node:test')
const assert = require('node:assert/strict')

// The addresses here are made up; the lookup is answered rather than made.
const dns = require('node:dns').promises
const realLookup = dns.lookup
dns.lookup = async () => [{ address: '203.0.113.10', family: 4 }]
test.after(() => { dns.lookup = realLookup })
const hh = require('../server/utils/aioHousehold')
const { personalAddressCode, addressToKeep } = require('../server/providers/jellyfinAuth')

const UUID = '0f2b9c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const HASH = '$2b$10$' + 'a'.repeat(53)
const owner = (extra = {}) => ({
  id: 'o1', username: 'Sam', accountId: 'acc', providerType: 'jellyfin', jellyfinServerKind: 'aiostreams',
  jellyfinServerUrl: 'https://aio.example.com/jellyfin', aioConfigId: UUID, aioConfigPassword: 'enc', ...extra,
})
const decrypt = () => 'secret'
const encrypt = (v) => `enc:${v}`

function fakeAio(config) {
  const saved = []
  const original = global.fetch
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
    if (u.pathname === '/api/v1/status') return json(200, { success: true, data: { settings: { jellyfin: { maxPersonas: 40 } } } })
    if (u.pathname === '/api/v1/user' && opts.method === 'PUT') {
      config = JSON.parse(opts.body).config
      saved.push(JSON.parse(JSON.stringify(config)))
      return json(200, { success: true })
    }
    if (u.pathname === '/api/v1/user') return json(200, { success: true, data: { userData: JSON.parse(JSON.stringify(config)) } })
    if (u.pathname.endsWith('/Users/AuthenticateByName')) {
      const body = JSON.parse(opts.body)
      const p = (config.jellyfin.personas || []).find((x) => body.Username.endsWith(x.name))
      return json(200, { AccessToken: 'tok', User: { Id: hh.personaUserId(UUID, p?.id), Name: body.Username } })
    }
    return json(404, {})
  }
  return { saved, restore: () => { global.fetch = original } }
}

function db() {
  const profiles = []
  return {
    profiles,
    user: { update: async () => ({}), findUnique: async () => ({ aioConfigStateJson: '{}' }), findMany: async () => [], findFirst: async () => null, updateMany: async () => ({}) },
    jellyfinProfile: {
      findUnique: async ({ where }) => profiles.find((p) => p.jellyfinUserId === where.ownerUserId_jellyfinUserId.jellyfinUserId) || null,
      create: async ({ data }) => { profiles.push({ id: `p${profiles.length + 1}`, ...data }); return data },
      update: async ({ where, data }) => Object.assign(profiles.find((p) => p.id === where.id), data),
    },
  }
}

const base = () => ({
  uuid: UUID,
  jellyfin: {
    primary: { name: 'Sam', hidden: true, pin: HASH },
    personas: [
      { id: 'leo', name: 'Leo', history: 'own', lock: HASH, trackers: ['st1'] },
      { id: 'mia', name: 'Mia', history: 'shared' },
      { id: 'ada', name: 'Ada', history: 'own', hidden: true, address: 'aaaaaaaaaa' },
    ],
  },
})

test('address recognition: only /jellyfin/p/<code> is personal', () => {
  assert.equal(personalAddressCode('https://aio.example.com/jellyfin/p/k3j9x0q7ab'), 'k3j9x0q7ab')
  assert.equal(personalAddressCode('https://example.com/aio/jellyfin/p/k3j9x0q7ab/'), 'k3j9x0q7ab')
  assert.equal(personalAddressCode('https://aio.example.com/jellyfin'), null)
  assert.equal(personalAddressCode('https://aio.example.com/jellyfin/u/family'), null)
  assert.equal(personalAddressCode(`https://aio.example.com/jellyfin/${UUID}/c29tZQ`), null)
  assert.equal(personalAddressCode('https://aio.example.com/jellyfin/p/short'), null)
  assert.equal(personalAddressCode('not a url'), null)
})

test('portal sign-in: a household address and a personal one never replace each other', () => {
  // This is the rule getPublicUserJellyfin (routes/publicLibrary.js) applies
  // to the stored address; the route itself needs a database to run.
  const house = 'https://aio.example.com/jellyfin'
  const own = 'https://aio.example.com/jellyfin/p/k3j9x0q7ab'
  assert.equal(addressToKeep(house, own), house)
  assert.equal(addressToKeep(own, house), own)
  assert.equal(addressToKeep(own, 'https://aio.example.com/jellyfin/p/zz11yy22xx'), 'https://aio.example.com/jellyfin/p/zz11yy22xx')
  assert.equal(addressToKeep(house, 'http://aio.example.com/jellyfin'), 'http://aio.example.com/jellyfin')
  assert.equal(addressToKeep(`${house}/u/family`, house), house)
  assert.equal(addressToKeep(null, own), own)
})

test('add: off by default writes neither field; on writes both, 10 chars a-z0-9, unique', async () => {
  const s = fakeAio(base())
  try {
    const plain = await hh.addPersona(db(), decrypt, encrypt, owner(), { name: 'Bo', history: 'own' })
    const bo = s.saved[0].jellyfin.personas.find((p) => p.id === 'bo')
    assert.equal('hidden' in bo, false)
    assert.equal('address' in bo, false)
    assert.equal(plain.personal, undefined)

    const codes = new Set()
    for (let i = 0; i < 25; i++) {
      const r = await hh.addPersona(db(), decrypt, encrypt, owner(), { name: `Kid${i}`, history: 'own', separate: true })
      const added = s.saved[s.saved.length - 1].jellyfin.personas.find((p) => p.name === `Kid${i}`)
      assert.equal(added.hidden, true)
      assert.match(added.address, /^[a-z0-9]{10}$/)
      assert.equal(r.personal.url, `https://aio.example.com/jellyfin/p/${added.address}`)
      codes.add(added.address)
    }
    assert.equal(codes.size, 25)
    assert.equal(codes.has('aaaaaaaaaa'), false)
    // Everyone else went back untouched.
    const last = s.saved[s.saved.length - 1].jellyfin
    assert.deepEqual(last.personas[0], base().jellyfin.personas[0])
    assert.deepEqual(last.primary, base().jellyfin.primary)
  } finally { s.restore() }
})

test('switch on, renew, off: only that user changes, the rest byte for byte', async () => {
  const s = fakeAio(base())
  const prisma = db()
  const profile = { id: 'pm', name: 'Mia', jellyfinUserId: hh.personaUserId(UUID, 'mia') }
  const strip = (cfg) => JSON.stringify({ ...cfg, jellyfin: { ...cfg.jellyfin, personas: cfg.jellyfin.personas.filter((p) => p.id !== 'mia') } })
  try {
    const on = await hh.setPersonaSeparation(prisma, decrypt, owner(), profile, 'on')
    assert.equal(on.separate, true)
    assert.match(on.address, /^[a-z0-9]{10}$/)
    assert.equal(strip(s.saved[0]), strip(base()), 'the others and the primary untouched')
    assert.deepEqual(s.saved[0].jellyfin.personas.find((p) => p.id === 'mia'), { id: 'mia', name: 'Mia', history: 'shared', hidden: true, address: on.address })

    const renewed = await hh.setPersonaSeparation(prisma, decrypt, owner(), profile, 'renew')
    assert.notEqual(renewed.address, on.address)
    assert.equal(strip(s.saved[1]), strip(base()))

    // Switching on again when already on writes nothing.
    await hh.setPersonaSeparation(prisma, decrypt, owner(), profile, 'on')
    assert.equal(s.saved.length, 2)

    const off = await hh.setPersonaSeparation(prisma, decrypt, owner(), profile, 'off')
    assert.deepEqual(off, { separate: false, address: null, url: null })
    assert.equal(JSON.stringify(s.saved[2]), JSON.stringify(base()), 'back to exactly how it started')

    await assert.rejects(hh.setPersonaSeparation(prisma, decrypt, owner(), profile, 'renew'), /isn't kept separate/)
    await assert.rejects(hh.setPersonaSeparation(prisma, decrypt, owner(), { ...profile, jellyfinUserId: 'nobody' }, 'on'), /any more/)
    await assert.rejects(hh.setPersonaSeparation(prisma, decrypt, owner({ aioConfigPassword: null }), profile, 'on'), /configuration password/)
    await assert.rejects(hh.setPersonaSeparation(prisma, decrypt, owner(), profile, 'sideways'), /on, off or renew/)
  } finally { s.restore() }
})

test('reading: each known household user, with the personal address', async () => {
  const s = fakeAio(base())
  try {
    const profiles = [
      { id: 'pl', name: 'Leo', jellyfinUserId: hh.personaUserId(UUID, 'leo') },
      { id: 'pa', name: 'Ada', jellyfinUserId: hh.personaUserId(UUID, 'ada') },
      { id: 'px', name: 'Gone', jellyfinUserId: 'nobody' },
    ]
    const got = await hh.personalSettings(decrypt, owner(), profiles)
    assert.deepEqual(got.pl, { separate: false, address: null, url: null })
    assert.deepEqual(got.pa, { separate: true, address: 'aaaaaaaaaa', url: 'https://aio.example.com/jellyfin/p/aaaaaaaaaa' })
    assert.equal('px' in got, false)
    assert.equal(await hh.personalSettings(decrypt, owner({ aioConfigPassword: null }), profiles), null)
  } finally { s.restore() }
})
