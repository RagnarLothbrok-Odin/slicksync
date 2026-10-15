const test = require('node:test')
const assert = require('node:assert')
const { publicMessage } = require('../server/utils/publicError')

test('messages written for people pass through', () => {
  for (const m of ['That list is private', 'Enter the server address', 'Wrong user name or password', 'This invitation has expired',
    'The model did not return valid JSON - try rephrasing', 'SIMKL request failed (401)', 'MDBList request failed fetching list items', 'USER_NOT_FOUND']) {
    assert.strictEqual(publicMessage(new Error(m), 'fallback'), m)
  }
})

test('server internals get the fallback', () => {
  const internal = [
    'Invalid `prisma.user.update()` invocation: Unique constraint failed on the fields: (`email`)',
    'connect ECONNREFUSED 127.0.0.1:5432',
    'getaddrinfo ENOTFOUND db',
    'fetch failed',
    "Cannot read properties of undefined (reading 'id')",
    'x.map is not a function',
    'Unexpected token < in JSON at position 0',
    'Request failed with status code 500',
    'request to https://addon.example.com/abcdefabcdefabcdefabcdefabcdefabcdef/manifest.json failed',
    'timeout of 10000ms exceeded',
    'SQLITE_BUSY: database is locked',
    '<!DOCTYPE html><html>',
    'x'.repeat(400),
  ]
  for (const m of internal) assert.strictEqual(publicMessage(new Error(m), 'Failed to save'), 'Failed to save', m)
})

test('missing or odd errors get the fallback', () => {
  assert.strictEqual(publicMessage(undefined, 'Failed'), 'Failed')
  assert.strictEqual(publicMessage(new Error(''), 'Failed'), 'Failed')
  assert.strictEqual(publicMessage({}, 'Failed'), 'Failed')
  assert.strictEqual(publicMessage(null), 'Something went wrong')
})
