// Keep in step (server/utils/watchCopy/keepInStep.js): what moves, what
// doesn't, and who sends.
const test = require('node:test')
const assert = require('node:assert/strict')
const kis = require('../server/utils/watchCopy/keepInStep')
const { forgetForTests } = require('../server/utils/watchCopy/adapters')

const ON = Date.parse('2026-10-20T12:00:00Z')
const LATER = Date.parse('2026-10-20T13:00:00Z')
const OLD = Date.parse('2026-09-01T12:00:00Z')

function world({ members = [], enabled = true } = {}) {
  const setting = { userId: 'u1', accountId: 'acc', enabled, members: JSON.stringify(members), enabledAt: new Date(ON), lastPassAt: null }
  const moves = []
  const prisma = {
    user: { findFirst: async () => ({ id: 'u1', accountId: 'acc', username: 'Chris', email: 'c@example.com', providerType: 'stremio', stremioAuthKey: 'k' }) },
    userProviderCredential: { findMany: async () => [{ id: 'c1', providerType: 'nuvio', nuvioRefreshToken: 'r', nuvioUserId: 'n' }] },
    watchSyncSetting: {
      findUnique: async () => setting,
      findMany: async () => [setting],
      update: async ({ data }) => Object.assign(setting, data),
      upsert: async ({ update }) => Object.assign(setting, update),
    },
    watchSyncMove: {
      findMany: async () => moves.slice().reverse(),
      createMany: async ({ data }) => { moves.push(...data) },
      deleteMany: async () => ({ count: 0 }),
    },
  }
  // Stremio: empty library. Nuvio profile 1 (Chris) and 2 (Kids).
  const library = []
  const pushed = { 1: [], 2: [] }
  const nuvioData = {
    1: { watched: [
      { content_id: 'tt1', content_type: 'movie', title: 'New Film', watched_at: LATER },
      { content_id: 'tt2', content_type: 'movie', title: 'Old Film', watched_at: OLD },
    ], progress: [], library: [] },
    2: { watched: [{ content_id: 'tt3', content_type: 'movie', title: 'Cartoon', watched_at: LATER }], progress: [], library: [] },
  }
  const stremio = { getLibrary: async () => library, addLibraryItem: async (c) => { for (const i of c) { const k = library.findIndex((x) => x._id === i._id); if (k >= 0) library[k] = i; else library.push(i) } } }
  const nuvio = {
    getProfiles: async () => [{ profile_index: 1, name: 'Chris' }, { profile_index: 2, name: 'Kids' }],
    getProfileAvatars: async () => new Map(),
    getWatchState: async (p) => nuvioData[p],
    pushWatchedItems: async (p, items) => { pushed[p].push(...items); nuvioData[p].watched.push(...items) },
    pushWatchProgress: async () => {}, pushLibraryItems: async () => {},
  }
  const deps = { createProvider: (row) => (row.providerType === 'nuvio' ? nuvio : stremio), decrypt: (t) => t }
  return { prisma, deps, setting, library, pushed, moves }
}

test('out of the box: each sign-in\'s own profile sends and receives, a second profile is left out', async () => {
  const w = world()
  const d = await kis.describe(w.prisma, w.deps, 'acc', 'u1')
  assert.deepEqual(d.places.map((p) => [p.side, p.mode]), [['stremio', 'both'], ['nuvio:1', 'both'], ['nuvio:2', 'off']])
})

test('what is finished after switching on moves; what came before stays put', async () => {
  forgetForTests()
  const w = world({ members: [{ side: 'nuvio:2', mode: 'off' }] })
  const moved = await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 60000)
  assert.deepEqual(moved.map((m) => [m.title, [...m.to]]), [['New Film', ['Stremio']]])
  assert.equal(w.library.find((i) => i._id === 'tt1')?.state.flaggedWatched, 1)
  assert.equal(w.library.find((i) => i._id === 'tt2'), undefined, 'older than switching on: not moved')
  assert.equal(w.pushed[2].length, 0, 'a left-out profile is untouched')
  assert.equal(w.moves[0].title, 'New Film')
  assert.deepEqual(JSON.parse(w.moves[0].toLabels), ['Stremio'])
})

test('a receive-only profile gets everything but never sends', async () => {
  forgetForTests()
  const w = world({ members: [{ side: 'nuvio:2', mode: 'receive' }] })
  await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 60000)
  assert.deepEqual(w.pushed[2].map((i) => i.content_id), ['tt1'], 'Kids receives the new film')
  assert.equal(w.library.find((i) => i._id === 'tt3'), undefined, 'the cartoon never leaves Kids')
})

test('a second pass moves nothing new (no echo back and forth)', async () => {
  forgetForTests()
  const w = world({ members: [{ side: 'nuvio:2', mode: 'receive' }] })
  await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 60000)
  w.setting.lastPassAt = new Date(LATER + 60000)
  const again = await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 5 * 60000)
  assert.deepEqual(again, [])
})

test('merge keeps each title at its furthest', () => {
  const a = new Map([['tt9', { id: 'tt9', type: 'series', episodes: new Map([['1:1', 1]]), resume: { season: 1, episode: 2, position: 5, at: 10 }, lastActivity: 10, watchedAt: null }]])
  const b = new Map([['tt9', { id: 'tt9', type: 'series', episodes: new Map([['1:2', 2]]), resume: { season: 1, episode: 3, position: 9, at: 20 }, lastActivity: 20, watchedAt: null }]])
  const m = kis.merge([{ label: 'A', state: a }, { label: 'B', state: b }]).get('tt9')
  assert.deepEqual([...m.episodes.keys()].sort(), ['1:1', '1:2'])
  assert.equal(m.resume.episode, 3)
  assert.equal(m.from, 'B')
})

test('switching on starts the clock; modes are saved', async () => {
  const w = world({ enabled: false })
  w.setting.enabledAt = null
  const d = await kis.save(w.prisma, w.deps, 'acc', 'u1', { enabled: true, members: [{ side: 'nuvio:2', mode: 'receive' }, { side: 'x', mode: 'bogus' }], now: LATER })
  assert.equal(w.setting.enabled, true)
  assert.equal(new Date(w.setting.enabledAt).getTime(), LATER)
  assert.deepEqual(JSON.parse(w.setting.members), [{ side: 'nuvio:2', mode: 'receive' }])
  assert.equal(d.places.find((p) => p.side === 'nuvio:2').mode, 'receive')
})

test('a pass that could not read a place does not move the clock, so the next pass catches up', async () => {
  forgetForTests()
  const w = world()
  w.deps.createProvider = (row) => { if (row.providerType === 'stremio') return { getLibrary: async () => { throw new Error('offline') } }; return w.deps.__nuvio }
  const nuvio = w.deps.__nuvio = { getProfiles: async () => [{ profile_index: 1, name: 'Chris' }], getProfileAvatars: async () => new Map(), getWatchState: async () => ({ watched: [], progress: [], library: [] }) }
  await kis.runAll(w.prisma, () => w.deps, LATER + 60000)
  assert.equal(w.setting.lastPassAt, null, 'not counted as done')
  assert.match(w.setting.lastError, /Stremio/)
  assert.ok(nuvio)
})

test('a person who was deleted has their Keep in step removed', async () => {
  const w = world()
  w.prisma.user.findFirst = async () => null
  let deleted = null
  w.prisma.watchSyncSetting.deleteMany = async ({ where }) => { deleted = where.userId; return { count: 1 } }
  await kis.runAll(w.prisma, () => w.deps, LATER + 60000)
  assert.equal(deleted, 'u1')
})
