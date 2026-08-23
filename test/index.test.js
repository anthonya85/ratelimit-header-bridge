// Run with: npm test (builds first, then runs against dist/).
// Uses only node:test and node:assert, no third-party test runner.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLegacyHeaders,
  parseDraftHeaders,
  toLegacyHeaders,
  toDraftHeaders,
  legacyToDraft,
  draftToLegacy,
} from '../dist/index.js'

test('parseLegacyHeaders throws when limit is missing', () => {
  assert.throws(
    () => parseLegacyHeaders({ 'X-RateLimit-Remaining': '1', 'X-RateLimit-Reset': '100' }, 0),
    /missing one or more X-RateLimit-\* headers/,
  )
})

test('parseLegacyHeaders throws when remaining is missing', () => {
  assert.throws(
    () => parseLegacyHeaders({ 'X-RateLimit-Limit': '60', 'X-RateLimit-Reset': '100' }, 0),
    /missing one or more X-RateLimit-\* headers/,
  )
})

test('parseLegacyHeaders throws when reset is missing', () => {
  assert.throws(
    () => parseLegacyHeaders({ 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '1' }, 0),
    /missing one or more X-RateLimit-\* headers/,
  )
})

test('parseLegacyHeaders falls back to X-Rate-Limit-* spelling', () => {
  const info = parseLegacyHeaders(
    { 'X-Rate-Limit-Limit': '60', 'X-Rate-Limit-Remaining': '1', 'X-Rate-Limit-Reset': '100' },
    40,
  )
  assert.equal(info.limit, 60)
  assert.equal(info.remaining, 1)
  assert.equal(info.resetSeconds, 60)
})

test('parseLegacyHeaders rejects a non-numeric limit', () => {
  assert.throws(
    () =>
      parseLegacyHeaders(
        { 'X-RateLimit-Limit': 'sixty', 'X-RateLimit-Remaining': '1', 'X-RateLimit-Reset': '100' },
        0,
      ),
    /invalid limit/,
  )
})

test('parseLegacyHeaders rejects a non-numeric reset', () => {
  assert.throws(
    () =>
      parseLegacyHeaders(
        { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '1', 'X-RateLimit-Reset': 'soon' },
        0,
      ),
    /invalid reset/,
  )
})

test('parseLegacyHeaders clamps a reset timestamp already in the past to zero', () => {
  const info = parseLegacyHeaders(
    { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '1', 'X-RateLimit-Reset': '100' },
    500,
  )
  assert.equal(info.resetSeconds, 0)
})

test('parseDraftHeaders throws when any required header is missing', () => {
  assert.throws(
    () => parseDraftHeaders({ 'RateLimit-Limit': '60', 'RateLimit-Remaining': '1' }),
    /missing one or more RateLimit-\* headers/,
  )
})

test('parseDraftHeaders rejects a non-numeric remaining', () => {
  assert.throws(
    () => parseDraftHeaders({ 'RateLimit-Limit': '60', 'RateLimit-Remaining': 'lots', 'RateLimit-Reset': '30' }),
    /invalid remaining/,
  )
})

test('parseDraftHeaders clamps a negative reset to zero', () => {
  const info = parseDraftHeaders({ 'RateLimit-Limit': '60', 'RateLimit-Remaining': '1', 'RateLimit-Reset': '-5' })
  assert.equal(info.resetSeconds, 0)
})

test('parseDraftHeaders rejects a policy with a non-numeric quota', () => {
  assert.throws(
    () =>
      parseDraftHeaders({
        'RateLimit-Limit': '60',
        'RateLimit-Remaining': '1',
        'RateLimit-Reset': '30',
        'RateLimit-Policy': 'unlimited;w=60',
      }),
    /invalid policy quota/,
  )
})

test('parseDraftHeaders ignores an unparseable window and keeps the default', () => {
  const info = parseDraftHeaders({
    'RateLimit-Limit': '60',
    'RateLimit-Remaining': '1',
    'RateLimit-Reset': '30',
    'RateLimit-Policy': '60;w=soon',
  })
  assert.deepEqual(info.policy, { quota: 60, windowSeconds: 60 })
})

test('parseDraftHeaders ignores unknown policy parameters', () => {
  const info = parseDraftHeaders({
    'RateLimit-Limit': '60',
    'RateLimit-Remaining': '1',
    'RateLimit-Reset': '30',
    'RateLimit-Policy': '60;w=30;comment="burst"',
  })
  assert.deepEqual(info.policy, { quota: 60, windowSeconds: 30 })
})

test('toLegacyHeaders and toDraftHeaders round-trip a RateLimitInfo', () => {
  const info = { limit: 60, remaining: 1, resetSeconds: 30, policy: { quota: 60, windowSeconds: 60 } }
  assert.deepEqual(toLegacyHeaders(info, 1000), {
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': '1',
    'X-RateLimit-Reset': '1030',
  })
  assert.deepEqual(toDraftHeaders(info), {
    'RateLimit-Limit': '60',
    'RateLimit-Remaining': '1',
    'RateLimit-Reset': '30',
    'RateLimit-Policy': '60;w=60',
  })
})

test('legacyToDraft and draftToLegacy convert straight through', () => {
  const legacy = { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '42', 'X-RateLimit-Reset': '1000' }
  assert.deepEqual(legacyToDraft(legacy, 940), {
    'RateLimit-Limit': '60',
    'RateLimit-Remaining': '42',
    'RateLimit-Reset': '60',
  })

  const draft = { 'RateLimit-Limit': '100', 'RateLimit-Remaining': '5', 'RateLimit-Reset': '30' }
  assert.deepEqual(draftToLegacy(draft, 1000), {
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': '5',
    'X-RateLimit-Reset': '1030',
  })
})
