/**
 * Low-level Supabase PostgREST HTTP client.
 * All Nuvio API calls go through these functions.
 */

const { assertSafeUrl, safeFetch, instancePolicy } = require('../utils/safeUrl')

// Nuvio's backend, fronted by their own custom domain (api.nuvio.tv) rather than
// the raw Supabase project URL. Confirmed current as of the AIOManager reference
// implementation (github.com/Sonicx161/AIOManager, beta branch) — the previous
// default here pointed at a raw *.supabase.co URL that no longer authenticates.
const SUPABASE_URL = process.env.NUVIO_SUPABASE_URL || 'https://api.nuvio.tv'
const SUPABASE_ANON_KEY = process.env.NUVIO_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'

// Every request below takes an optional serverConfig so an account can point
// Nuvio at its own self-hosted backend instead of api.nuvio.tv. Falls back to
// the env vars, then to the public defaults - so an instance that sets
// nothing behaves exactly as before, and the parameter being optional means
// existing call sites didn't have to change.
//
// This is what brings Nuvio in line with every other integration here
// (TMDb/OMDb/MDBList/RPDB/SIMKL): the account's own setting wins, the env var
// is only a fallback. Nuvio's backend was the one that never got that.
function resolveConfig(serverConfig) {
  const url = (serverConfig?.url || '').trim() || SUPABASE_URL
  const anonKey = (serverConfig?.anonKey || '').trim() || SUPABASE_ANON_KEY
  // Trailing slashes would produce `//rest/v1/...` on a custom URL.
  return { url: url.replace(/\/+$/, ''), anonKey }
}

// Whether this account talks to a backend of its own, rather than the one this
// install is set up for (the env var, or api.nuvio.tv). The standard one is
// the operator's and is called exactly as it always was; an address a person
// typed in is the one that has to be watched on every request.
function usesOwnBackend(serverConfig) {
  if (!(serverConfig?.url || '').trim()) return false
  return resolveConfig(serverConfig).url.toLowerCase() !== resolveConfig().url.toLowerCase()
}

// Why this server will not talk to an address someone gave as their Nuvio
// backend, or null when it will. An instance serving strangers must not be
// pointed at its own network through this (every request would carry the
// person's sign-in with it, and the discovery call reports what it finds); a
// household's own install may use a server on its LAN or a docker service
// name, so only what instancePolicy() refuses is refused there (see
// utils/safeUrl.js).
//
// A name that does not resolve right now is not refused: the backend may just
// be starting, and the request fails on its own. It is checked again on every
// use (resolveServerConfigForAccount), so a name that later resolves
// somewhere internal is still caught.
const BACKEND_REFUSED = 'That address points at a network this server is not allowed to reach'
async function backendAddressProblem(raw) {
  try {
    await assertSafeUrl(String(raw || '').trim(), instancePolicy())
    return null
  } catch (e) {
    if (e?.message === 'unresolvable host') return null
    if (e?.message === 'blocked host') return BACKEND_REFUSED
    return 'Enter the backend address starting with http:// or https://'
  }
}

// How every request to an account's own backend is sent. The check made when
// the address was saved, and again in resolveServerConfigForAccount, only
// vouches for the host as typed, and a host that passes it can answer any
// request with a redirect to somewhere internal. safeFetch checks the address
// and every hop it is sent on to, under the same policy as the rest of this
// file (instancePolicy()). The standard backend gets a plain fetch.
//
// A refusal says nothing about whether the backend is healthy: it carries a
// code the breaker leaves out of its count (see withResilience), and is not
// something to retry.
const REFUSED_BY_POLICY = new Set(['blocked host', 'unsupported protocol', 'invalid url'])
async function backendFetch(url, init, serverConfig) {
  if (!usesOwnBackend(serverConfig)) return fetch(url, init)
  try {
    return await safeFetch(url, init, instancePolicy())
  } catch (e) {
    if (!REFUSED_BY_POLICY.has(e?.message)) throw e
    const err = new Error(BACKEND_REFUSED)
    err.code = 'BACKEND_REFUSED'
    err.cause = e
    throw err
  }
}

// Reads the per-account override out of AppAccount.sync, the same JSON blob
// the other per-account keys live in - so no schema change is needed. Both
// fields must be set to take effect: a URL without its matching anon key
// would authenticate against the wrong backend and fail confusingly, so a
// half-filled override is ignored rather than half-applied.
//
// An address this install will not reach is ignored the same way, so one
// saved before that was checked cannot keep being used. Sign-in then fails
// against the standard backend, which shows up as a reconnect rather than as
// requests quietly going somewhere they should not.
async function resolveServerConfigForAccount(prisma, accountId) {
  try {
    const acc = await prisma?.appAccount?.findUnique({
      where: { id: accountId || 'default' },
      select: { sync: true }
    })
    let cfg = acc?.sync
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = null } }
    if (!cfg || typeof cfg !== 'object') return null
    const url = typeof cfg.nuvioServerUrl === 'string' ? cfg.nuvioServerUrl.trim() : ''
    const anonKey = typeof cfg.nuvioAnonKey === 'string' ? cfg.nuvioAnonKey.trim() : ''
    if (!url || !anonKey) return null
    if (await backendAddressProblem(url)) {
      console.warn(`[Nuvio] Ignoring the backend address saved for account ${accountId || 'default'}: this server may not reach it`)
      return null
    }
    return { url, anonKey }
  } catch {
    return null
  }
}

// Nuvio's self-host stack publishes a discovery document so a client can be
// pointed at one Backend URL and configure itself, rather than the operator
// hand-copying a key out of `./nuvio credentials`.
//
// The contract is documented in the self-host repo (docs/client-configuration.md
// in github.com/NuvioMedia/self-host):
//
//   {
//     "version": 1,
//     "service": "nuvio",
//     "self_hosted": true,
//     "backend_url": "https://backend.example.com",
//     "publishable_key": "<PUBLIC_CLIENT_KEY>",
//     "capabilities": { "email_password_auth": true, "tv_login": true }
//   }
//
// backend_url/publishable_key are read first as the documented names; the
// other spellings are kept as a cheap hedge against the shape shifting, and
// a failed parse falls back to manual entry rather than failing silently.
// The publishable key is public client configuration by design - the document
// deliberately excludes service-role keys, DB passwords and dashboard creds.
async function discoverNuvioBackend(baseUrl) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!root) return { ok: false, error: 'No backend URL given' }
  if (!/^https?:\/\//i.test(root)) return { ok: false, error: 'URL must start with http:// or https://' }

  // safeFetch checks the address, and every redirect it is sent on to, before
  // anything is requested. `refused` is how the caller tells "this server may
  // not go there" (a request problem) from "nothing answered" (an ordinary
  // result).
  let res
  try {
    res = await safeFetch(`${root}/.well-known/nuvio`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    }, instancePolicy())
  } catch (e) {
    if (e?.message === 'blocked host' || e?.message === 'unsupported protocol') {
      return { ok: false, refused: true, error: BACKEND_REFUSED }
    }
    return { ok: false, error: e?.name === 'TimeoutError' ? 'Timed out reaching that URL' : 'Could not reach that URL' }
  }
  if (!res.ok) return { ok: false, error: `Discovery endpoint returned ${res.status}` }

  let doc
  try { doc = await res.json() } catch { return { ok: false, error: 'Discovery endpoint did not return JSON' } }

  // Flatten one level so a nested { supabase: { anon_key } } shape works too.
  const flat = { ...doc }
  for (const v of Object.values(doc || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(flat, v)
  }
  const pick = (...names) => {
    for (const n of names) {
      const val = flat[n]
      if (typeof val === 'string' && val.trim()) return val.trim()
    }
    return ''
  }

  // Documented names first, then the hedges.
  const anonKey = pick('publishable_key', 'publishableKey', 'anon_key', 'anonKey', 'ANON_KEY', 'supabase_anon_key')
  const apiUrl = pick('backend_url', 'backendUrl', 'api_url', 'apiUrl', 'supabase_url', 'supabaseUrl', 'url') || root

  // Guards against pointing at some unrelated host that happens to answer
  // that path with JSON - better a clear "that isn't a Nuvio backend" than
  // saving a key that will fail on every sync afterwards.
  const service = pick('service')
  if (service && service.toLowerCase() !== 'nuvio') {
    return { ok: false, error: `That URL answered, but identifies itself as "${service}", not a Nuvio backend` }
  }

  if (!anonKey) {
    return { ok: false, error: 'That backend answered, but its discovery document had no publishable key - enter it manually', url: apiUrl }
  }
  return {
    ok: true,
    url: apiUrl.replace(/\/+$/, ''),
    anonKey,
    selfHosted: flat.self_hosted === true || flat.selfHosted === true,
  }
}

function headers(accessToken, serverConfig) {
  return {
    'apikey': resolveConfig(serverConfig).anonKey,
    'authorization': `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'prefer': 'return=representation'
  }
}

// --- Resilience: concurrency cap + circuit breaker for Nuvio's backend ---
// Confirmed real incident: Nuvio's own Supabase backend degraded (429s
// escalating to 504/524 gateway timeouts), and with no timeout and no
// concurrency limit, requests from the once-a-minute sync poller (one per
// connected Nuvio user) piled up faster than they could ever clear,
// eventually starving the whole Node process - including its own internal
// proxy for completely unrelated requests like /api/users. A single
// external dependency going down should never be able to take unrelated
// features (Stremio, the admin panel's own basic endpoints) down with it.
// Two layers, shared across every call below:
//   1. Concurrency cap - bounds how many Nuvio requests can be in flight at
//      once, no matter how many users/poll cycles want one right now. Caps
//      worst-case resource usage regardless of how bad or long the outage is.
//   2. Circuit breaker - once several calls in a row have failed, stop even
//      attempting new ones for a cooldown window instead of continuing to
//      queue against a backend that's clearly down. Fails instantly during
//      the cooldown (no network attempt, no timeout wait), and gives
//      Nuvio's own backend room to recover instead of adding to its load.
//      There is one per backend address: the standard backend's is shared by
//      every account that uses it, and an account that points Nuvio at its
//      own server only ever trips its own.
//
// A third behaviour on top of those two, added after a confirmed live
// incident where the first two alone weren't enough: Nuvio's backend
// started answering 429 (rate limited) rather than failing outright, and a
// FIXED cooldown turned into an endless sawtooth - open 30s, resume at full
// rate, get 429'd within seconds, open again - for hours, hammering an
// already-complaining backend the whole time. So:
//   3. Rate-limit-aware backoff - 429 is an explicit "you are going too
//      fast", not a generic error, so it trips the breaker after far fewer
//      hits, honours a Retry-After header when one is sent, and each
//      consecutive trip doubles the cooldown (30s, 60s, 2m, ... capped)
//      until calls actually start succeeding again.
const SUPABASE_TIMEOUT_MS = 15000
const MAX_CONCURRENT = 8
const FAILURE_THRESHOLD = 5
// 429 says the backend is already unhappy - two in a row is plenty.
const RATE_LIMIT_THRESHOLD = 2
const CIRCUIT_COOLDOWN_MS = 30000
const MAX_CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000
// How long calls must have been healthy before the escalating cooldown is
// forgotten. Without this, a single success between two rate-limited
// windows would reset the backoff to 30s and restore the sawtooth.
const STABLE_PERIOD_MS = 5 * 60 * 1000

let activeCount = 0
const waitQueue = []

const newBreaker = () => ({ consecutiveFailures: 0, consecutiveRateLimits: 0, circuitOpenUntil: 0, circuitTrips: 0, lastTripAt: 0 })
const standardBreaker = newBreaker()
// Own backends, keyed by address. Bounded, since the address is typed in by
// whoever runs the account: past the cap the oldest is forgotten (its circuit
// simply starts closed again).
const ownBreakers = new Map()
const MAX_OWN_BREAKERS = 200

function breakerFor(serverConfig) {
  if (!usesOwnBackend(serverConfig)) return standardBreaker
  const key = resolveConfig(serverConfig).url.toLowerCase()
  let breaker = ownBreakers.get(key)
  if (!breaker) {
    if (ownBreakers.size >= MAX_OWN_BREAKERS) ownBreakers.delete(ownBreakers.keys().next().value)
    breaker = newBreaker()
    ownBreakers.set(key, breaker)
  }
  return breaker
}

// Whether calls to this backend are being held back right now. A write that
// takes several calls (replace a list: delete, then insert) asks first, so it
// is refused whole instead of starting and then failing halfway.
function isCircuitOpen(serverConfig) {
  return Date.now() < breakerFor(serverConfig).circuitOpenUntil
}

// Retry-After is seconds or an HTTP-date (RFC 9110). Both are honoured;
// anything unparseable just falls through to our own backoff.
function retryAfterMsFrom(res) {
  const raw = res.headers?.get?.('retry-after')
  if (!raw) return 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_CIRCUIT_COOLDOWN_MS)
  const at = Date.parse(raw)
  if (!Number.isNaN(at)) return Math.max(0, Math.min(at - Date.now(), MAX_CIRCUIT_COOLDOWN_MS))
  return 0
}

// Every call site builds its failure the same way - status drives the
// breaker's rate-limit path, retryAfterMs sets a floor for the cooldown.
function providerError(res) {
  const err = new Error('Provider request failed')
  err.status = res.status
  err.retryAfterMs = retryAfterMsFrom(res)
  return err
}

function acquireSlot() {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    return Promise.resolve()
  }
  return new Promise((resolve) => waitQueue.push(resolve))
}

// Hands the freed slot directly to the next waiter rather than
// decrementing-then-incrementing, so activeCount never dips below what's
// actually in flight the moment a waiter is ready to run.
function releaseSlot() {
  const next = waitQueue.shift()
  if (next) next()
  else activeCount--
}

// bypassBreaker is for the one kind of call that must not be held back: the
// write that puts a list back after the old one was already deleted (see
// setAddons in nuvio.js), where refusing it is what leaves a person with
// nothing. It still takes a concurrency slot and never waits for an open circuit.
// A success it has does not close one, and a failure it meets while one is
// already open does not lengthen it. But its failures count like any others
// while the circuit is closed: a backend that answers every write with 429 has
// to stop the next person's replace at its first read, before it deletes.
async function withResilience(label, fn, serverConfig, { bypassBreaker = false } = {}) {
  const breaker = breakerFor(serverConfig)
  if (!bypassBreaker && Date.now() < breaker.circuitOpenUntil) {
    console.error(`Supabase call skipped, circuit open (${label})`)
    const err = new Error('Nuvio backend unavailable - too many recent failures')
    err.status = 503
    err.code = 'CIRCUIT_OPEN'
    throw err
  }
  await acquireSlot()
  try {
    const result = await fn()
    if (!bypassBreaker) {
      breaker.consecutiveFailures = 0
      breaker.consecutiveRateLimits = 0
      // Only forget the escalating backoff once calls have been healthy for a
      // while - see STABLE_PERIOD_MS.
      if (breaker.circuitTrips > 0 && Date.now() - breaker.lastTripAt > STABLE_PERIOD_MS) breaker.circuitTrips = 0
    }
    return result
  } catch (e) {
    // A refused address says nothing about how the backend is doing, and a bypassed
    // call that fails during a cooldown must not extend it.
    if (e?.code === 'BACKEND_REFUSED') throw e
    if (bypassBreaker && Date.now() < breaker.circuitOpenUntil) throw e
    breaker.consecutiveFailures++
    const rateLimited = e?.status === 429
    if (rateLimited) breaker.consecutiveRateLimits++

    if (breaker.consecutiveFailures >= FAILURE_THRESHOLD || breaker.consecutiveRateLimits >= RATE_LIMIT_THRESHOLD) {
      // Each consecutive trip doubles the wait, so a backend that keeps
      // saying "too fast" gets progressively more room instead of being
      // re-hammered every 30 seconds.
      const escalated = Math.min(CIRCUIT_COOLDOWN_MS * (2 ** breaker.circuitTrips), MAX_CIRCUIT_COOLDOWN_MS)
      const cooldown = Math.max(escalated, e?.retryAfterMs || 0)
      breaker.circuitOpenUntil = Date.now() + cooldown
      breaker.lastTripAt = Date.now()
      breaker.circuitTrips++
      breaker.consecutiveFailures = 0
      breaker.consecutiveRateLimits = 0
      const why = rateLimited ? 'rate limiting (429)' : `${FAILURE_THRESHOLD} consecutive failures`
      console.error(`Supabase circuit opened for ${Math.round(cooldown / 1000)}s after ${why}`)
    }
    throw e
  } finally {
    releaseSlot()
  }
}

// Whether a failed call is worth sending again: the backend is busy or down
// (429, 5xx) or the request never got an answer (timeout, dropped
// connection). Anything else - a conflict, a bad request, a refused sign-in, an
// address this server will not use - would only fail the same way.
function isTransientFailure(err) {
  if (err?.code === 'BACKEND_REFUSED') return false
  const status = err?.status
  if (status === undefined || status === null) return true
  return status === 429 || status >= 500
}

async function supabaseGet(table, params, accessToken, serverConfig, { bypassBreaker = false } = {}) {
  return withResilience(`GET ${table}`, async () => {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    const url = `${resolveConfig(serverConfig).url}/rest/v1/${table}?${query}`
    const res = await backendFetch(url, { headers: headers(accessToken, serverConfig), signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) }, serverConfig)
    if (!res.ok) {
      console.error(`Supabase GET ${table} failed (${res.status})`)
      throw providerError(res)
    }
    return await res.json()
  }, serverConfig, { bypassBreaker })
}

async function supabasePost(table, rows, accessToken, serverConfig, { bypassBreaker = false } = {}) {
  return withResilience(`POST ${table}`, async () => {
    const url = `${resolveConfig(serverConfig).url}/rest/v1/${table}`
    const res = await backendFetch(url, {
      method: 'POST',
      headers: headers(accessToken, serverConfig),
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    }, serverConfig)
    if (!res.ok) {
      // The body can quote the refused row, address and key included, so only the
      // status and the backend's error code are logged.
      const bodyText = await res.text().catch(() => '')
      let errorCode = ''
      try { errorCode = String(JSON.parse(bodyText)?.code || '').slice(0, 20) } catch {}
      console.error(`Supabase POST ${table} failed (${res.status})${errorCode ? ` code ${errorCode}` : ''}`)
      throw providerError(res)
    }
    return await res.json()
  }, serverConfig, { bypassBreaker })
}

async function supabaseDelete(table, params, accessToken, serverConfig) {
  return withResilience(`DELETE ${table}`, async () => {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    const url = `${resolveConfig(serverConfig).url}/rest/v1/${table}?${query}`
    const res = await backendFetch(url, {
      method: 'DELETE',
      headers: headers(accessToken, serverConfig),
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    }, serverConfig)
    if (!res.ok) {
      console.error(`Supabase DELETE ${table} failed (${res.status})`)
      throw providerError(res)
    }
  }, serverConfig)
}

async function supabaseRpc(fn, body, accessToken, serverConfig) {
  return withResilience(`RPC ${fn}`, async () => {
    const url = `${resolveConfig(serverConfig).url}/rest/v1/rpc/${fn}`
    const res = await backendFetch(url, {
      method: 'POST',
      headers: headers(accessToken, serverConfig),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    }, serverConfig)
    if (!res.ok) {
      console.error(`Supabase RPC ${fn} failed (${res.status})`)
      throw providerError(res)
    }
    // A write-only RPC (e.g. sync_push_collections) can legitimately return
    // a 2xx with an empty body - blindly calling .json() on that throws
    // "Unexpected end of JSON input" and makes a successful write look like
    // a failure. Only parse when there's actually a body to parse.
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }, serverConfig)
}

module.exports = {
  supabaseGet,
  supabasePost,
  supabaseDelete,
  supabaseRpc,
  resolveConfig,
  resolveServerConfigForAccount,
  discoverNuvioBackend,
  backendAddressProblem,
  backendFetch,
  isCircuitOpen,
  isTransientFailure,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  // The backend's own address for an account's config - public files (avatars) live under it.
  backendUrl: (serverConfig) => resolveConfig(serverConfig).url,
  _test: {
    // Puts every breaker back to closed, so one test's failures do not hold
    // back the next one's calls.
    resetCircuit() {
      Object.assign(standardBreaker, newBreaker())
      ownBreakers.clear()
    },
    // What a backend's breaker is holding right now.
    breakerState(serverConfig) {
      return { ...breakerFor(serverConfig) }
    }
  }
}
