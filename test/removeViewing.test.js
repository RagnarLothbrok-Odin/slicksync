// "Remove from Activity" (server/utils/removeViewing.js): only that person,
// title (episode) and day go, into the Trash, and the Trash puts them back.
const test = require('node:test')
const assert = require('node:assert/strict')
const { removeViewing, restoreViewing } = require('../server/utils/removeViewing')

function world() {
  const t = {
    movieWatchHistory: [],
    episodeWatchHistory: [
      { id: 'e1', accountId: 'a', userId: 'u1', videoId: 'tt9:1:2', showName: 'Show', season: 1, episode: 2, watchedAt: new Date('2026-10-21T15:18:00Z') },
      { id: 'e2', accountId: 'a', userId: 'u1', videoId: 'tt9:1:3', showName: 'Show', season: 1, episode: 3, watchedAt: new Date('2026-10-21T16:00:00Z') },
      { id: 'e3', accountId: 'a', userId: 'u2', videoId: 'tt9:1:2', showName: 'Show', season: 1, episode: 2, watchedAt: new Date('2026-10-21T15:20:00Z') },
    ],
    watchActivity: [
      { id: 'w1', accountId: 'a', userId: 'u1', itemId: 'tt9', videoId: 'tt9:1:2', date: new Date('2026-10-21T00:00:00Z'), watchTimeSeconds: 2820 },
      { id: 'w2', accountId: 'a', userId: 'u1', itemId: 'tt9', videoId: 'tt9:1:2', date: new Date('2026-10-20T00:00:00Z'), watchTimeSeconds: 600 },
    ],
    watchSession: [{ id: 's1', accountId: 'a', userId: 'u1', itemId: 'tt9', videoId: 'tt9:1:2', itemName: 'Show', season: 1, episode: 2, startTime: new Date('2026-10-21T14:31:00Z'), isActive: false }],
    trash: [],
  }
  const match = (row, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k])
      const x = new Date(row[k]).getTime()
      return (!v.gte || x >= new Date(v.gte).getTime()) && (!v.lt || x < new Date(v.lt).getTime())
    }
    return row[k] === v
  })
  const model = (name) => ({
    findMany: async ({ where }) => t[name].filter((r) => match(r, where)),
    deleteMany: async ({ where }) => { const before = t[name].length; t[name] = t[name].filter((r) => !match(r, where)); return { count: before - t[name].length } },
    create: async ({ data }) => { if (t[name].some((r) => r.id === data.id)) throw new Error('exists'); t[name].push(data); return data },
  })
  const prisma = {
    user: { findFirst: async ({ where }) => (where.id === 'u1' && where.accountId === 'a' ? { id: 'u1', username: 'Gary' } : null) },
    movieWatchHistory: model('movieWatchHistory'), episodeWatchHistory: model('episodeWatchHistory'),
    watchActivity: model('watchActivity'), watchSession: model('watchSession'),
    trashItem: { create: async ({ data }) => { const r = { id: 'tr1', ...data }; t.trash.push(r); return r } },
    $transaction: async (ops) => Promise.all(ops),
  }
  return { t, prisma }
}

const DAY = { day: '2026-10-21', from: '2026-10-21T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' }

test('removes just that episode, person and day - and the Trash brings it back', async () => {
  const { t, prisma } = world()
  const r = await removeViewing(prisma, 'a', 'u1', { itemId: 'tt9', videoId: 'tt9:1:2', ...DAY })
  assert.equal(r.label, 'Show S1 E2')
  assert.deepEqual(r.removed, { history: 1, watchTimeSeconds: 2820, sessions: 1 })
  assert.deepEqual(t.episodeWatchHistory.map((e) => e.id), ['e2', 'e3'], 'their next episode and the other person stay')
  assert.deepEqual(t.watchActivity.map((w) => w.id), ['w2'], 'the day before stays')
  assert.equal(t.watchSession.length, 0)
  const payload = JSON.parse(t.trash[0].payload)
  const restored = await restoreViewing(prisma, payload)
  assert.equal(restored, 3)
  assert.equal(t.episodeWatchHistory.length, 3)
})

test('someone in another account, or nothing recorded, is refused', async () => {
  const { prisma } = world()
  await assert.rejects(removeViewing(prisma, 'other', 'u1', { itemId: 'tt9', videoId: 'tt9:1:2', ...DAY }), /Person not found/)
  await assert.rejects(removeViewing(prisma, 'a', 'u1', { itemId: 'tt7', ...DAY }), /Nothing recorded/)
})
