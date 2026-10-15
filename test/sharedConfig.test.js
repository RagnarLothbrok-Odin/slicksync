// client/lib/sharedConfig.ts: addons whose install links open the same saved
// AIOStreams/AIOMetadata configuration. Two links can differ (each install
// gets its own encrypted part) and still change each other's settings.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function load() {
  const clientDir = path.join(__dirname, '..', 'client')
  let ts
  try { ts = require(require.resolve('typescript', { paths: [clientDir] })) } catch { return null }
  const source = fs.readFileSync(path.join(clientDir, 'lib', 'sharedConfig.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const mod = { exports: {} }
  new Function('module', 'exports', 'URL', outputText)(mod, mod.exports, URL)
  return mod.exports
}

const lib = load()
const ID = 'd79877be-7ce9-4c19-ac56-6a309af899fa'
const OTHER = '58c71126-4ef2-4b5d-aecc-3f3a22c2c0aa'

test('two different install links of one configuration share it', { skip: !lib }, () => {
  const peers = lib.sharedConfigPeers([
    { id: 'nuvio', name: 'TEST (NuvioSLICK)', manifestUrl: `https://aio.example.com/stremio/${ID}/eyJhbGxvdyI6MX0/manifest.json` },
    { id: 'stremio', name: 'SlicksStreaming TEST', manifestUrl: `https://aio.example.com/stremio/${ID.toUpperCase()}/eyJvdGhlciI6Mn0/manifest.json` },
    { id: 'alone', name: 'Another', manifestUrl: `https://aio.example.com/stremio/${OTHER}/eyJ4IjoxfQ/manifest.json` },
  ])
  assert.deepEqual(peers.get('nuvio'), [{ id: 'stremio', name: 'SlicksStreaming TEST' }])
  assert.deepEqual(peers.get('stremio'), [{ id: 'nuvio', name: 'TEST (NuvioSLICK)' }])
  assert.equal(peers.has('alone'), false)
})

test('the same id on another server, or no configuration id, is not shared', { skip: !lib }, () => {
  const peers = lib.sharedConfigPeers([
    { id: 'a', name: 'A', manifestUrl: `https://one.example.com/stremio/${ID}/x/manifest.json` },
    { id: 'b', name: 'B', manifestUrl: `https://two.example.com/stremio/${ID}/x/manifest.json` },
    { id: 'c', name: 'Cinemeta', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
    { id: 'd', name: 'Cinemeta copy', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
    { id: 'e', name: 'Odd', manifestUrl: 'not a url' },
  ])
  assert.equal(peers.size, 0)
})

test('it names the app when it can', { skip: !lib }, () => {
  assert.equal(lib.configKindOf(`https://aiometadata.example.com/stremio/${ID}/manifest.json`, 'x'), 'AIOMetadata')
  assert.equal(lib.configKindOf(`https://aio.example.com/stremio/${ID}/manifest.json`, 'AIOStreams'), 'AIOStreams')
  assert.equal(lib.configKindOf('https://x.example.com/manifest.json', 'Thing'), '')
  assert.equal(lib.joinNames(['A', 'B', 'C']), 'A, B and C')
})
