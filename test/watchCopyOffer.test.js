// "Just added a sign-in - bring their history over?" (server/utils/watchCopy/offer.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const offer = require('../server/utils/watchCopy/offer')

const NOW = Date.parse('2026-10-21T12:00:00Z')
const DAY = 86400000

function world({ credAgeDays = 2, stremioTitles = 50, nuvioTitles = 0 } = {}) {
  let setting = null
  const prisma = {
    user: { findFirst: async () => ({ id: 'u1', accountId: 'acc', username: 'Chris', email: 'c@example.com', providerType: 'stremio', stremioAuthKey: 'k', createdAt: new Date(NOW - 90 * DAY), nuvioProfileId: 1 }) },
    userProviderCredential: { findMany: async () => [{ id: 'c1', providerType: 'nuvio', nuvioRefreshToken: 'r', nuvioUserId: 'n', createdAt: new Date(NOW - credAgeDays * DAY) }] },
    watchSyncSetting: {
      findUnique: async () => setting,
      upsert: async ({ create, update }) => { setting = setting ? { ...setting, ...update } : { ...create } },
    },
  }
  const films = (n) => Array.from({ length: n }, (_, i) => ({ _id: `tt${100 + i}`, type: 'movie', name: `Film ${i}`, removed: false, state: { timesWatched: 1, lastWatched: '2026-01-01T00:00:00Z' } }))
  const stremio = { getLibrary: async () => films(stremioTitles) }
  const nuvio = {
    getProfiles: async () => [{ profile_index: 1, name: 'Chris' }],
    getProfileAvatars: async () => new Map(),
    getWatchState: async () => ({ watched: Array.from({ length: nuvioTitles }, (_, i) => ({ content_id: `tt${900 + i}`, content_type: 'movie', title: 'x', watched_at: 1 })), progress: [], library: [] }),
  }
  const deps = { createProvider: (row) => (row.providerType === 'nuvio' ? nuvio : stremio), decrypt: (t) => t }
  return { prisma, deps }
}

test('a sign-in added this week with nothing on it: offer the other one\'s titles', async () => {
  offer.forget()
  const w = world()
  const o = await offer.offerFor(w.prisma, w.deps, 'acc', 'u1', NOW)
  assert.equal(o.name, 'Chris')
  assert.deepEqual(o.to, { provider: 'nuvio', kind: 'nuvio', side: 'nuvio:1', label: 'Nuvio' })
  assert.deepEqual(o.from, { provider: 'stremio', side: 'stremio', label: 'Stremio', count: 50 })
})

test('no offer when the new sign-in already has its own history', async () => {
  offer.forget()
  const w = world({ nuvioTitles: 20 })
  assert.equal(await offer.offerFor(w.prisma, w.deps, 'acc', 'u1', NOW), null)
})

test('no offer once the sign-in is more than two weeks old', async () => {
  offer.forget()
  const w = world({ credAgeDays: 20 })
  assert.equal(await offer.offerFor(w.prisma, w.deps, 'acc', 'u1', NOW), null)
})

test('"Not now" hides it for that sign-in', async () => {
  offer.forget()
  const w = world()
  assert.ok(await offer.offerFor(w.prisma, w.deps, 'acc', 'u1', NOW))
  await offer.dismiss(w.prisma, 'acc', 'u1', 'nuvio')
  assert.equal(await offer.offerFor(w.prisma, w.deps, 'acc', 'u1', NOW), null)
})
