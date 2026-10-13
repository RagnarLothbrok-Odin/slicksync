// Compares two secrets without the time taken saying how much of one was
// right. Both sides are hashed first, so the lengths need not match and the
// length of the real secret is not given away either.

const crypto = require('crypto')

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

module.exports = { safeEqual }
