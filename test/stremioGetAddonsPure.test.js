// Reading a person's addon list must never write to their Stremio account. It
// used to: a list that came back as null was "repaired" by saving an empty one
// from inside the read that every status badge and background check makes.
const test = require('node:test')
const assert = require('node:assert/strict')

// The Stremio client talks to the real service, so it is swapped for one that
// answers from a script and remembers what it was asked. This has to happen
// before the provider is loaded: it takes the class when it is required.
const lib = require('stremio-api-client')
const requests = []
let answers = {}
lib.StremioAPIClient = function FakeStremioClient(options) {
  this.request = async (method, params) => {
    requests.push({ method, params, authKey: options.authKey })
    if (!(method in answers)) throw new Error(`unexpected ${method}`)
    const answer = answers[method]
    return typeof answer === 'function' ? answer(params) : answer
  }
}
const { createStremioProvider } = require('../server/providers/stremio')
const { getUserAddons } = require('../server/utils/sync')

const methods = () => requests.map((r) => r.method)
test.beforeEach(() => { requests.length = 0; answers = {} })

test('a null addon list reads as empty, and the read writes nothing', async () => {
  answers = { addonCollectionGet: { addons: null }, addonCollectionSet: {} }
  const result = await createStremioProvider({ authKey: 'key' }).getAddons()
  assert.deepEqual(result, { addons: [] })
  assert.deepEqual(methods(), ['addonCollectionGet'], 'one read, no set, no second read')
})

test('an empty list and a list of addons are read as they are', async () => {
  answers = { addonCollectionGet: { addons: [] } }
  assert.deepEqual(await createStremioProvider({ authKey: 'key' }).getAddons(), { addons: [] })

  answers = {
    addonCollectionGet: {
      addons: {
        a: { transportUrl: 'https://a.example/manifest.json', transportName: 'x', manifest: { id: 'a', name: 'A', manifestUrl: 'https://a.example/manifest.json' } },
        b: { transportUrl: 'https://b.example/manifest.json' },
      },
    },
  }
  const { addons } = await createStremioProvider({ authKey: 'key' }).getAddons()
  assert.deepEqual(addons, [
    { transportUrl: 'https://a.example/manifest.json', transportName: '', manifest: { id: 'a', name: 'A' } },
    { transportUrl: 'https://b.example/manifest.json', transportName: '' },
  ], 'the object form is turned into a list and manifestUrl is dropped')
  assert.deepEqual(methods().filter((m) => m !== 'addonCollectionGet'), [])
})

test('writing still sends the list it is given', async () => {
  answers = { addonCollectionSet: {} }
  const provider = createStremioProvider({ authKey: 'key' })
  const list = [{ transportUrl: 'https://a.example/manifest.json', manifest: { id: 'a', name: 'A' } }]
  await provider.setAddons(list)
  assert.deepEqual(requests.at(-1), { method: 'addonCollectionSet', params: { addons: list }, authKey: 'key' })
  await provider.clearAddons()
  assert.deepEqual(requests.at(-1).params, { addons: [] }, 'clearing is an explicit write, and still works')
})

test('the Stremio-only fallback in getUserAddons does not write on a null list either', async () => {
  answers = { addonCollectionGet: { addons: null }, addonCollectionSet: {} }
  const result = await getUserAddons(
    { stremioAuthKey: 'enc-key' },
    {},
    { decrypt: (v) => v, StremioAPIClient: lib.StremioAPIClient, createProvider: undefined }
  )
  assert.equal(result.success, true)
  assert.deepEqual(result.addons.addons, [])
  assert.deepEqual(methods(), ['addonCollectionGet'])
})

test('through a provider, getUserAddons returns what the provider read', async () => {
  const result = await getUserAddons({ id: 'u' }, {}, {
    decrypt: (v) => v,
    StremioAPIClient: lib.StremioAPIClient,
    createProvider: () => ({ getAddons: async () => ({ addons: [] }) }),
  })
  assert.deepEqual(result, { success: true, addons: { addons: [] }, error: null })
})
