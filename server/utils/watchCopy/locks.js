// One writer per destination at a time. A copy and a Keep in step pass that
// write the same sign-in together can each read it, then each write over the
// other; and a quick double-tap used to start two copies. The key is the
// account, the person and the provider - profiles inside one sign-in share it.

const busy = new Map() // key -> who ('copy' | 'keepInStep')

const keyOf = (accountId, personId, provider) => `${accountId}|${personId}|${provider}`

/** Takes the destination for `who`; false when someone else has it. */
function take(key, who) {
  if (busy.has(key)) return false
  busy.set(key, who)
  return true
}

function release(key) {
  busy.delete(key)
}

const holder = (key) => busy.get(key) || null

module.exports = { keyOf, take, release, holder, forgetForTests: () => busy.clear() }
