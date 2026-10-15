// A group's members are a JSON list on the group row. Every change reads it,
// changes it and writes it back, so two changes at once used to erase each
// other: the person added by the first was gone after the second wrote its
// copy. These run them one at a time, each as one transaction, and the group
// edit works its final list out once.
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { assignUserToGroup, removeUserFromGroup, setGroupMembers } = require('../server/utils/helpers/database')
const makeGroupsRouter = require('../server/routes/groups')

const ACCOUNT = 'default'
const req = { appAccountId: ACCOUNT }
const tick = () => new Promise((resolve) => setImmediate(resolve))

// A database where every call yields to the event loop first and a
// transaction gives no isolation at all - so a change that is not kept apart
// from another one really does interleave with it.
function fakeDb({ groups, users }) {
  const state = {
    groups: groups.map((g) => ({ accountId: ACCOUNT, ...g, userIds: JSON.stringify(g.userIds) })),
    users: users.map((id) => ({ id, accountId: ACCOUNT })),
    calls: 0,
    updates: [],        // { id, data } for every group write
    transactions: [],   // the options each transaction was opened with
  }
  const db = {
    group: {
      findMany: async ({ where }) => {
        state.calls++; await tick()
        return state.groups.filter((g) => g.accountId === where.accountId).map((g) => ({ id: g.id, userIds: g.userIds }))
      },
      findFirst: async ({ where }) => {
        state.calls++; await tick()
        const g = state.groups.find((x) => x.id === where.id && (!where.accountId || x.accountId === where.accountId))
        return g ? { ...g, addons: [] } : null
      },
      update: async ({ where, data }) => {
        state.calls++; await tick()
        const g = state.groups.find((x) => x.id === where.id)
        state.updates.push({ id: where.id, data })
        Object.assign(g, data)
        return g
      },
    },
    user: {
      findMany: async ({ where }) => {
        state.calls++; await tick()
        return state.users.filter((u) => where.id.in.includes(u.id) && u.accountId === where.accountId).map((u) => ({ id: u.id }))
      },
    },
  }
  const prisma = { ...db, $transaction: async (fn, options) => { state.transactions.push(options); return fn(db) } }
  state.members = (groupId) => JSON.parse(state.groups.find((g) => g.id === groupId).userIds)
  return { prisma, state }
}

test('two people added to the same group at the same moment are both in it afterwards', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: [] }], users: ['A', 'B'] })
  await Promise.all([assignUserToGroup(prisma, 'A', 'g1', req), assignUserToGroup(prisma, 'B', 'g1', req)])
  assert.deepEqual(state.members('g1').sort(), ['A', 'B'])
})

test('many at once all land', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `U${i}`)
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: [] }, { id: 'g2', userIds: [] }], users: ids })
  await Promise.all(ids.map((id, i) => assignUserToGroup(prisma, id, i % 2 ? 'g1' : 'g2', req)))
  assert.deepEqual(state.members('g1').sort(), ids.filter((_, i) => i % 2).sort())
  assert.deepEqual(state.members('g2').sort(), ids.filter((_, i) => !(i % 2)).sort())
})

test('an add and a removal at the same moment both take effect', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['A', 'B'] }], users: ['A', 'B', 'C'] })
  await Promise.all([assignUserToGroup(prisma, 'C', 'g1', req), removeUserFromGroup(prisma, 'A', 'g1', req)])
  assert.deepEqual(state.members('g1').sort(), ['B', 'C'])
})

test('adding someone to a group takes them out of the others', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['B'] }, { id: 'g2', userIds: ['A', 'B'] }], users: ['A', 'B'] })
  await assignUserToGroup(prisma, 'A', 'g1', req)
  assert.deepEqual(state.members('g1'), ['B', 'A'])
  assert.deepEqual(state.members('g2'), ['B'])
  // Already a member: nothing to write.
  const writes = state.updates.length
  await assignUserToGroup(prisma, 'A', 'g1', req)
  assert.equal(state.updates.length, writes)
})

test('a change is one transaction, with room to wait for a busy database', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: [] }], users: ['A'] })
  await assignUserToGroup(prisma, 'A', 'g1', req)
  assert.equal(state.transactions.length, 1)
  assert.ok(state.transactions[0].timeout >= 60 * 1000, 'not cut off after five seconds')
  assert.ok(state.transactions[0].maxWait >= 10 * 1000)
})

test('given a transaction client already, it runs in place', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: [] }], users: ['A'] })
  const { $transaction, ...client } = prisma
  await assignUserToGroup(client, 'A', 'g1', req)
  assert.deepEqual(state.members('g1'), ['A'])
})

test('a group that is not there changes nothing, and nobody is taken out of their group first', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g2', userIds: ['A'] }], users: ['A'] })
  await assert.rejects(assignUserToGroup(prisma, 'A', 'gone', req), /Target group not found/)
  assert.equal(state.updates.length, 0)
  assert.deepEqual(state.members('g2'), ['A'])
})

test('a group id that is not an id is refused before the database is touched', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: [] }], users: ['A'] })
  for (const bad of ['', '  ', null, undefined, 7]) {
    await assert.rejects(assignUserToGroup(prisma, 'A', bad, req), /Invalid groupId/)
  }
  assert.equal(state.calls, 0)
})

test('a member list that cannot be read is left alone, not overwritten', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: [] }, { id: 'g2', userIds: [] }], users: ['A'] })
  state.groups[1].userIds = 'not a list'
  await assignUserToGroup(prisma, 'A', 'g1', req)
  assert.deepEqual(state.members('g1'), ['A'])
  assert.equal(state.groups[1].userIds, 'not a list')
  await assert.rejects(assignUserToGroup(prisma, 'A', 'g2', req), /cannot be read/)
  assert.equal(state.groups[1].userIds, 'not a list')
})

test('setGroupMembers keeps only people of the account, writes the list once and clears them from the other groups', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['old'] }, { id: 'g2', userIds: ['A', 'Z'] }], users: ['A', 'B', 'Z'] })
  const kept = await setGroupMembers(prisma, 'g1', ['A', 'ghost', 'B', 'A', 7, ''], req)
  assert.deepEqual(kept, ['A', 'B'])
  assert.deepEqual(state.members('g1'), ['A', 'B'])
  assert.deepEqual(state.members('g2'), ['Z'])
  assert.deepEqual(state.updates.filter((u) => u.id === 'g1').map((u) => u.data.userIds), ['["A","B"]'], 'one write to the group, never an empty list in between')
})

test('setGroupMembers with nobody empties the group', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['A'] }], users: ['A'] })
  assert.deepEqual(await setGroupMembers(prisma, 'g1', [], req), [])
  assert.deepEqual(state.members('g1'), [])
  assert.deepEqual(await setGroupMembers(prisma, 'g1', 'not a list', req), [])
})

test('a group edit and an add at the same moment keep the person who was added', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['A'] }, { id: 'g2', userIds: [] }], users: ['A', 'B', 'C'] })
  await Promise.all([setGroupMembers(prisma, 'g1', ['A', 'B'], req), assignUserToGroup(prisma, 'C', 'g1', req)])
  assert.deepEqual(state.members('g1'), ['A', 'B', 'C'])
})

// The edit route itself: PUT /groups/:id with a member list.
async function putGroup(prisma, id, body) {
  const app = express()
  app.use(express.json())
  app.use('/groups', makeGroupsRouter({
    prisma,
    getAccountId: () => ACCOUNT,
    scopedWhere: (r, extra) => ({ accountId: ACCOUNT, ...extra }),
    INSTANCE_TYPE: 'private',
    assignUserToGroup: async () => { throw new Error('the edit must not add people one by one') },
    decrypt: (v) => v,
  }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/groups/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  } finally {
    server.close()
  }
}

test('the group edit writes the final list once and leaves out ids that are not people of the account', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', name: 'Family', description: 'd', userIds: ['A'] }, { id: 'g2', userIds: ['B'] }], users: ['A', 'B'] })
  const { status, body } = await putGroup(prisma, 'g1', { userIds: ['B', 'ghost'] })
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual(state.members('g1'), ['B'])
  assert.deepEqual(state.members('g2'), [], 'moved out of the other group')
  const memberWrites = state.updates.filter((u) => u.id === 'g1' && 'userIds' in u.data)
  assert.deepEqual(memberWrites.map((u) => u.data.userIds), ['["B"]'], 'never emptied first')
})

test('a group edit without a member list leaves the members alone', async () => {
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', name: 'Family', description: 'd', userIds: ['A'] }], users: ['A'] })
  const { status } = await putGroup(prisma, 'g1', { description: 'new' })
  assert.equal(status, 200)
  assert.deepEqual(state.members('g1'), ['A'])
})

test('taking someone out of every group while another person is added keeps both changes', async () => {
  const { removeUserFromAllGroups } = require('../server/utils/helpers/database')
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['A', 'B'] }, { id: 'g2', userIds: [] }], users: ['A', 'B', 'C'] })
  await Promise.all([removeUserFromAllGroups(prisma, 'A', ACCOUNT), assignUserToGroup(prisma, 'C', 'g1', req)])
  assert.deepEqual(state.members('g1').sort(), ['B', 'C'])
})

test('a long change holding the lock (a merge, a restore) and an add both land', async () => {
  const { withMembershipLock, moveIntoGroup, dropFromAllGroups } = require('../server/utils/helpers/database')
  const { prisma, state } = fakeDb({ groups: [{ id: 'g1', userIds: ['A', 'D'] }, { id: 'g2', userIds: [] }], users: ['A', 'B', 'C', 'D'] })
  const merge = withMembershipLock(ACCOUNT, async () => {
    await dropFromAllGroups(prisma, ACCOUNT, 'D')
    for (let i = 0; i < 5; i++) await tick() // a slow transaction
    await moveIntoGroup(prisma, ACCOUNT, 'B', 'g2')
  })
  await Promise.all([merge, assignUserToGroup(prisma, 'C', 'g1', req)])
  assert.deepEqual(state.members('g1').sort(), ['A', 'C'])
  assert.deepEqual(state.members('g2'), ['B'])
})

test('a household spelled as nothing and as default shares one queue', async () => {
  const { withMembershipLock } = require('../server/utils/helpers/database')
  const order = []
  await Promise.all([
    withMembershipLock(null, async () => { order.push('a1'); await tick(); await tick(); order.push('a2') }),
    withMembershipLock('default', async () => { order.push('b1') }),
  ])
  assert.deepEqual(order, ['a1', 'a2', 'b1'])
})
