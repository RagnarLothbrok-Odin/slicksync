const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const vm = require('node:vm')
const express = require('express')
const rateLimit = require('express-rate-limit')

// The limiters and the /health probe live in server/index.js, which starts the
// server as soon as it is loaded - so the pieces under test are read out of its
// source and run as written, not copied here.
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8')

function limiterOptions(name) {
  const found = indexSource.match(new RegExp(`const ${name} = rateLimit\\((\\{[\\s\\S]*?\\r?\\n\\})\\)`))
  assert.ok(found, `${name} is declared in server/index.js`)
  return vm.runInNewContext(`(${found[1]})`, { parseInt, process: { env: {} } })
}

function listen(t, app) {
  return new Promise((resolve) => {
    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done) }))
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

// The two helpers the admin login page reads an answer with.
function loginPageHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'client', 'app', '(public)', 'login', 'page.tsx'), 'utf8')
  // The page file may be checked out with Windows line endings.
  const read = source.match(/async function readAuthAnswer[\s\S]*?\r?\n\}\r?\n/)
  const line = source.match(/function failureLine[\s\S]*?\r?\n\}\r?\n/)
  assert.ok(read && line, 'the login page declares readAuthAnswer and failureLine')
  let ts
  try { ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '..', 'client')] })) } catch { return null }
  const { outputText } = ts.transpileModule(`${read[0]}\n${line[0]}\nexports.readAuthAnswer = readAuthAnswer\nexports.failureLine = failureLine`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const sandbox = { exports: {} }
  vm.runInNewContext(outputText, sandbox)
  return sandbox.exports
}

const helpers = loginPageHelpers()
const NO_CLIENT = helpers ? false : 'client packages are not installed'

// ------------------------------------------------------------- the limiters

test('a sign-in limiter that is used up answers 429 with a JSON message the login page can show', async (t) => {
  const app = express()
  app.use('/login', rateLimit({ ...limiterOptions('authLimiter'), max: 2 }))
  app.post('/login', (req, res) => res.status(401).json({ message: 'Invalid credentials' }))
  const base = await listen(t, app)

  for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/login`, { method: 'POST' })).status, 401)
  const refused = await fetch(`${base}/login`, { method: 'POST' })
  assert.equal(refused.status, 429)
  assert.match(refused.headers.get('content-type'), /application\/json/)
  const body = await refused.json()
  assert.equal(typeof body.message, 'string')
  assert.ok(body.message.length > 0)
})

test('the private-login limiter counts only failures and answers JSON once they are used up', async (t) => {
  const app = express()
  app.use(express.json())
  app.use('/private-login', rateLimit({ ...limiterOptions('privateLoginLimiter'), max: 2 }))
  app.post('/private-login', (req, res) => (req.body?.password === 'right' ? res.json({ token: 't' }) : res.status(401).json({ message: 'Invalid credentials' })))
  const base = await listen(t, app)
  const attempt = (password) => fetch(`${base}/private-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })

  // A household signing in over and over from one address never fills it.
  for (let i = 0; i < 5; i++) assert.equal((await attempt('right')).status, 200)
  for (let i = 0; i < 2; i++) assert.equal((await attempt('wrong')).status, 401)

  const refused = await attempt('right')
  assert.equal(refused.status, 429)
  assert.match(refused.headers.get('content-type'), /application\/json/)
  const body = await refused.json()
  assert.equal(typeof body.message, 'string')
  assert.ok(body.message.length > 0)
})

// ----------------------------------------------------------- the login page

test('login page: a rate-limited sign-in shows the server\'s line, not "Failed to connect to server"', { skip: NO_CLIENT }, async (t) => {
  const app = express()
  app.use('/login', rateLimit({ ...limiterOptions('authLimiter'), max: 1 }))
  app.post('/login', (req, res) => res.status(401).json({ message: 'Invalid credentials' }))
  const base = await listen(t, app)

  await fetch(`${base}/login`, { method: 'POST' })
  const refused = await fetch(`${base}/login`, { method: 'POST' })
  const data = await helpers.readAuthAnswer(refused)
  const shown = helpers.failureLine(refused, data, 'Invalid credentials')
  assert.match(shown, /too many/i)
  assert.notEqual(shown, 'Failed to connect to server')
})

test('login page: an error answer that is not JSON is read by its status', { skip: NO_CLIENT }, async () => {
  const answer = async (body, status) => {
    const response = new Response(body, { status })
    const data = await helpers.readAuthAnswer(response)
    return helpers.failureLine(response, data, 'Invalid credentials')
  }
  // Plain text from an older limiter or a proxy, and an HTML error page.
  assert.match(await answer('Too many authentication attempts', 429), /too many/i)
  assert.match(await answer('<html><body>Bad gateway</body></html>', 502), /server/i)
  assert.equal(await answer('', 401), 'Invalid credentials')
  // The server's own words win when it gave some.
  assert.equal(await answer(JSON.stringify({ message: 'Incorrect code' }), 401), 'Incorrect code')
  assert.equal(await answer(JSON.stringify({ message: 'Slow down' }), 429), 'Slow down')
})

test('login page: a success that is not JSON still counts as an unreachable server', { skip: NO_CLIENT }, async () => {
  await assert.rejects(helpers.readAuthAnswer(new Response('<html>sign in to the proxy</html>', { status: 200 })), /Failed to connect to server/)
})

// ------------------------------------------------------------------- /health

function healthHandler(prisma, logged) {
  const found = indexSource.match(/app\.get\('\/health', (async \(req, res\) => \{[\s\S]*?\r?\n\})\)\r?\n/)
  assert.ok(found, '/health is declared in server/index.js')
  return vm.runInNewContext(`(${found[1]})`, { prisma, console: { error: (...args) => logged.push(args) } })
}

async function probe(prisma) {
  const logged = []
  const res = {
    code: null,
    body: null,
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
  await healthHandler(prisma, logged)({}, res)
  return { res, logged }
}

test('/health: a reachable database answers 200', async () => {
  const { res } = await probe({ $queryRaw: async () => [{ 1: 1 }] })
  assert.equal(res.code, 200)
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), { status: 'ok', database: 'up' })
})

test('/health: an unreachable database answers 503 without the driver\'s message, which goes to the log', async () => {
  const driverMessage = 'Can\'t reach database server at `db.internal.example.com`:`5432`'
  const { res, logged } = await probe({ $queryRaw: async () => { throw new Error(driverMessage) } })
  assert.equal(res.code, 503)
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), { status: 'degraded', database: 'down' })
  assert.doesNotMatch(JSON.stringify(res.body), /example\.com|5432/)
  assert.ok(logged.some((args) => args.some((a) => typeof a === 'string' && a.includes(driverMessage))))
})
