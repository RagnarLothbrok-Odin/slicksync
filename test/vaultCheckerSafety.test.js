// Vault entries can be checked on demand and every few hours, and some of the
// checks reach out to an address the account typed in: an HTTP test URL, an
// indexer, a host and port, an AI Services endpoint. Those go through the same
// rule as every other such address (utils/safeUrl.js): an instance serving
// strangers never reaches its own network, a household's install may, nobody
// reaches link-local, and a refusal is a plain "failed" result for that entry.
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const dns = require('node:dns').promises
const express = require('express')
const config = require('../server/utils/config')
const { runCheck, fetchAiModels } = require('../server/utils/vaultCheckers')
const makeSettingsRouter = require('../server/routes/settings')

const realFetch = global.fetch
const configuredType = config.INSTANCE_TYPE
function instanceType(t, type) {
  config.INSTANCE_TYPE = type
  t.after(() => { config.INSTANCE_TYPE = configuredType })
}

// Names resolve to whatever the test says, never the network.
function resolveTo(t, table) {
  const original = dns.lookup
  dns.lookup = async (host) => {
    if (!(host in table)) { const e = new Error(`getaddrinfo ENOTFOUND ${host}`); e.code = 'ENOTFOUND'; throw e }
    return table[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
  t.after(() => { dns.lookup = original })
}

// A local HTTP server that records what it is asked.
function listen(t, handler) {
  const seen = []
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: req.headers })
      if (handler) return handler(req, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"status":"fine"}')
    })
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done) }))
      resolve({ url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, seen })
    })
  })
}

// A local TCP listener that counts connections.
function listenTcp(t) {
  const stats = { connections: 0 }
  return new Promise((resolve) => {
    const server = net.createServer((socket) => { stats.connections++; socket.destroy() })
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => server.close(done)))
      resolve({ port: server.address().port, stats })
    })
  })
}

// Replaces the server's outgoing fetch; calls to the test's own servers still go through.
function stubFetch(t, handler) {
  const calls = []
  global.fetch = (url, init) => {
    calls.push(String(url))
    return Promise.resolve(handler(String(url), init))
  }
  t.after(() => { global.fetch = realFetch })
  return calls
}

const redirect = (location, status = 302) => new Response(null, { status, headers: { location } })

// ---- generic HTTP -----------------------------------------------------------

test('HTTP check on an instance serving strangers: an internal address fails the entry, is asked once at most, and tells nothing about the answer', async (t) => {
  instanceType(t, 'public')
  const internal = await listen(t)
  const started = Date.now()
  for (const url of [`${internal.url}/api/health`, 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.20:8123/api/', 'http://[::1]:4000/', 'http://db.internal/status']) {
    const result = await runCheck('generic_http', 'example-secret', { url, bodyContains: 'fine' })
    assert.equal(result.ok, false, url)
    assert.match(result.message, /private or internal network/, url)
  }
  assert.equal(internal.seen.length, 0, 'nothing was sent to the internal server')
  assert.ok(Date.now() - started < 700, 'a refusal is not retried with a pause between attempts')
})

test('HTTP check on a household install: its own network works, link-local does not', async (t) => {
  instanceType(t, 'private')
  const lan = await listen(t)
  const ok = await runCheck('generic_http', 'example-secret', { url: `${lan.url}/api/health`, bodyContains: 'fine' })
  assert.deepEqual(ok, { ok: true, message: 'OK (200)' })
  assert.equal(lan.seen[0].headers.authorization, 'Bearer example-secret')
  const noMatch = await runCheck('generic_http', 'example-secret', { url: `${lan.url}/api/health`, bodyContains: 'other' })
  assert.deepEqual(noMatch, { ok: false, message: 'Response did not match expected content' })

  const metadata = await runCheck('generic_http', 'example-secret', { url: 'http://169.254.169.254/latest/meta-data/' })
  assert.equal(metadata.ok, false)
  assert.match(metadata.message, /link-local/)
  assert.equal(lan.seen.length, 2)
})

test('HTTP check: a redirect to an address that is not allowed is not followed, the key does not travel to another host', async (t) => {
  instanceType(t, 'public')
  resolveTo(t, { 'service.example': ['93.184.216.34'], 'other.example': ['93.184.216.35'] })
  let landed = null
  const calls = stubFetch(t, (url, init) => {
    if (url === 'https://service.example/to-metadata') return redirect('http://169.254.169.254/latest/meta-data/')
    if (url === 'https://service.example/to-other') return redirect('https://other.example/landing', 307)
    landed = init
    return new Response('{"status":"fine"}', { status: 200 })
  })
  const refused = await runCheck('generic_http', 'example-secret', { url: 'https://service.example/to-metadata' })
  assert.equal(refused.ok, false)
  assert.match(refused.message, /private or internal network/)
  assert.deepEqual(calls, ['https://service.example/to-metadata'])

  const followed = await runCheck('generic_http', 'example-secret', { url: 'https://service.example/to-other' })
  assert.deepEqual(followed, { ok: true, message: 'OK (200)' })
  assert.equal(new Headers(landed.headers).get('authorization'), null, 'the key stays with the host it was meant for')
})

test('HTTP check: only http and https, and a name that cannot be found says so', async (t) => {
  instanceType(t, 'private')
  resolveTo(t, {})
  for (const url of ['file:///etc/passwd', 'ftp://service.example/x']) {
    const result = await runCheck('generic_http', 'example-secret', { url })
    assert.equal(result.ok, false, url)
    assert.match(result.message, /http:\/\/ or https:\/\//, url)
  }
  const notFound = await runCheck('generic_http', 'example-secret', { url: 'https://gone.example/' })
  assert.deepEqual(notFound, { ok: false, message: 'That address could not be found' })
})

test('HTTP check: a network failure is still retried, a bad status is not', async (t) => {
  instanceType(t, 'private')
  resolveTo(t, { 'service.example': ['93.184.216.34'] })
  let attempts = 0
  stubFetch(t, () => {
    attempts++
    if (attempts === 1) throw new TypeError('fetch failed')
    return new Response('{}', { status: 200 })
  })
  assert.deepEqual(await runCheck('generic_http', 'example-secret', { url: 'https://service.example/' }), { ok: true, message: 'OK (200)' })
  assert.equal(attempts, 2)

  attempts = 0
  global.fetch = () => { attempts++; return Promise.resolve(new Response('no', { status: 401 })) }
  assert.deepEqual(await runCheck('generic_http', 'example-secret', { url: 'https://service.example/' }), { ok: false, message: 'Unexpected status 401' })
  assert.equal(attempts, 1)
})

// ---- indexer ----------------------------------------------------------------

test('indexer check: same rule - an internal address fails the entry, a household install reaches its own network', async (t) => {
  instanceType(t, 'public')
  const internal = await listen(t, (req, res) => { res.writeHead(200); res.end('<caps/>') })
  const refused = await runCheck('newznab_caps', 'example-key', { url: internal.url })
  assert.equal(refused.ok, false)
  assert.match(refused.message, /private or internal network/)
  assert.equal(internal.seen.length, 0)

  instanceType(t, 'private')
  const ok = await runCheck('newznab_caps', 'example-key', { url: internal.url })
  assert.deepEqual(ok, { ok: true, message: 'Indexer reachable, key accepted' })
  assert.match(internal.seen[0].url, /^\/api\?t=caps&apikey=example-key$/)
})

// ---- TCP --------------------------------------------------------------------

test('TCP check on an instance serving strangers: an internal host and port is not a port scanner', async (t) => {
  instanceType(t, 'public')
  resolveTo(t, { 'intranet.example': ['10.0.0.5'], 'nntp.example': ['127.0.0.1'] })
  const target = await listenTcp(t)
  for (const host of ['127.0.0.1', 'localhost', '10.0.0.5', '169.254.169.254', '::1', 'intranet.example', 'nntp.example', '2130706433', 'db.internal']) {
    const result = await runCheck('tcp_reachability', null, { host, port: target.port })
    assert.equal(result.ok, false, host)
    assert.match(result.message, /private or internal network/, host)
  }
  assert.equal(target.stats.connections, 0, 'no connection was made to anything internal')
})

test('TCP check: the connection goes to the address that was vetted, not to the name looked up again', async (t) => {
  instanceType(t, 'public')
  const target = await listenTcp(t)
  // Public the first time it is asked, internal the second.
  let asked = 0
  const original = dns.lookup
  dns.lookup = async () => [{ address: ++asked === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]
  t.after(() => { dns.lookup = original })
  const result = await runCheck('tcp_reachability', null, { host: 'rebinding.example', port: target.port })
  assert.equal(result.ok, false)
  assert.match(result.message, /private or internal network/)
  assert.equal(target.stats.connections, 0)
})

test('TCP check: IPv4 is tried before IPv6, and the next address is tried when one refuses', async (t) => {
  instanceType(t, 'private')
  const target = await listenTcp(t)
  const original = dns.lookup
  dns.lookup = async () => [{ address: '::1', family: 6 }, { address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }]
  t.after(() => { dns.lookup = original })
  const result = await runCheck('tcp_reachability', null, { host: 'nntp.example', port: target.port })
  assert.deepEqual(result, { ok: true, message: `nntp.example:${target.port} reachable (connectivity only, not a login check)` })
  assert.equal(target.stats.connections, 1)
})

test('TCP check on a household install: a host on its own network is reachable, link-local is not, a bad host or port still fails as before', async (t) => {
  instanceType(t, 'private')
  resolveTo(t, { 'nntp.example': ['127.0.0.1'] })
  const target = await listenTcp(t)
  const byAddress = await runCheck('tcp_reachability', null, { host: '127.0.0.1', port: target.port })
  assert.deepEqual(byAddress, { ok: true, message: `127.0.0.1:${target.port} reachable (connectivity only, not a login check)` })
  const byName = await runCheck('tcp_reachability', null, { host: 'nntp.example', port: String(target.port) })
  assert.deepEqual(byName, { ok: true, message: `nntp.example:${target.port} reachable (connectivity only, not a login check)` })
  assert.equal(target.stats.connections, 2)

  const metadata = await runCheck('tcp_reachability', null, { host: '169.254.169.254', port: 80 })
  assert.equal(metadata.ok, false)
  assert.match(metadata.message, /link-local/)
  assert.deepEqual(await runCheck('tcp_reachability', null, { host: '', port: 119 }), { ok: false, message: 'No host/port configured' })
  const glued = await runCheck('tcp_reachability', null, { host: `127.0.0.1:${target.port}/x`, port: target.port })
  assert.equal(glued.ok, false, 'a port or path glued onto the host is not read as a different address than the socket would dial')
  assert.equal(target.stats.connections, 2)
})

// ---- AI Services ------------------------------------------------------------

const AI_REFUSED = 'The AI Services address cannot be used from this server - check it under Settings -> External API Keys'

test('AI key check on an instance serving strangers: the endpoint is not asked and the key is not sent', async (t) => {
  instanceType(t, 'public')
  const internal = await listen(t)
  for (const baseUrl of [`${internal.url}/v1`, 'http://169.254.169.254/v1', 'http://192.168.1.5:11434/v1', 'http://ollama:11434/v1', 'file:///etc/passwd']) {
    resolveTo(t, { ollama: ['172.18.0.5'] })
    const result = await runCheck('openai_compatible', 'example-key', { baseUrl })
    assert.deepEqual(result, { ok: false, message: AI_REFUSED }, baseUrl)
  }
  assert.equal(internal.seen.length, 0)
})

test('AI key check on a household install: a model server on its own network answers, link-local does not', async (t) => {
  instanceType(t, 'private')
  const ollama = await listen(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"llama"}]}') })
  const ok = await runCheck('openai_compatible', 'example-key', { baseUrl: `${ollama.url}/v1/` })
  assert.deepEqual(ok, { ok: true, message: 'Provider accepted the key' })
  assert.equal(ollama.seen[0].url, '/v1/models')
  assert.equal(ollama.seen[0].headers.authorization, 'Bearer example-key')
  assert.deepEqual(await runCheck('openai_compatible', 'example-key', { baseUrl: 'http://169.254.169.254/v1' }), { ok: false, message: AI_REFUSED })
  assert.deepEqual(await runCheck('openai_compatible', '', { baseUrl: ollama.url }), { ok: false, message: 'No API key on file for this entry' })
})

test('AI key check: the provider\'s own answers read as they did', async (t) => {
  instanceType(t, 'private')
  const status = { code: 401 }
  const provider = await listen(t, (req, res) => { res.writeHead(status.code); res.end() })
  for (const [code, message] of [[401, 'Provider rejected the key (401)'], [403, 'Provider rejected the key (403)'], [429, 'Provider is rate-limiting this key (429)'], [500, 'Provider returned 500']]) {
    status.code = code
    assert.deepEqual(await runCheck('openai_compatible', 'example-key', { baseUrl: provider.url }), { ok: false, message })
  }
})

test('the model list on Settings: the same rule, and a plain message when the address is turned away', async (t) => {
  instanceType(t, 'public')
  const internal = await listen(t)
  const app = express()
  app.use(express.json())
  app.use('/api/settings', makeSettingsRouter({ prisma: {}, getAccountId: () => 'acc' }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done) }))
  const url = `http://127.0.0.1:${server.address().port}/api/settings/account-ai-services/list-models`
  const post = (body) => realFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  for (const baseUrl of [`${internal.url}/v1`, 'http://169.254.169.254/v1']) {
    const res = await post({ apiKey: 'example-key', baseUrl })
    assert.equal(res.status, 400, baseUrl)
    assert.deepEqual(await res.json(), { message: AI_REFUSED }, baseUrl)
  }
  assert.equal(internal.seen.length, 0)

  instanceType(t, 'private')
  const ollama = await listen(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"zeta"},{"id":"alpha"}]}') })
  const res = await post({ apiKey: 'example-key', baseUrl: `${ollama.url}/v1` })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { models: ['alpha', 'zeta'] })
  assert.equal(ollama.seen[0].headers.authorization, 'Bearer example-key')
  const metadata = await post({ apiKey: 'example-key', baseUrl: 'http://169.254.169.254/v1' })
  assert.equal(metadata.status, 400)
})

test('fetchAiModels: a refusal is the plain message, any other failure is left as it was', async (t) => {
  instanceType(t, 'private')
  await assert.rejects(fetchAiModels('http://169.254.169.254/v1', 'example-key'), { message: AI_REFUSED })
  await assert.rejects(fetchAiModels('not a url', 'example-key'), { message: AI_REFUSED })
  const controller = new AbortController()
  controller.abort()
  const lan = await listen(t)
  await assert.rejects(fetchAiModels(`${lan.url}/v1`, 'example-key', controller.signal), (e) => e.name === 'AbortError')
})
