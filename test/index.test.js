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
  parseRetryAfter,
  formatRetryAfter,
  parseRetryAfterHeader,
  toRetryAfterHeader,
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

test('parseDraftHeaders parses multiple comma-separated policies', () => {
  const info = parseDraftHeaders({
    'RateLimit-Limit': '60',
    'RateLimit-Remaining': '1',
    'RateLimit-Reset': '30',
    'RateLimit-Policy': '10;w=1, 50;w=60, 1000;w=3600',
  })
  assert.deepEqual(info.policies, [
    { quota: 10, windowSeconds: 1 },
    { quota: 50, windowSeconds: 60 },
    { quota: 1000, windowSeconds: 3600 },
  ])
  assert.deepEqual(info.policy, { quota: 10, windowSeconds: 1 })
})

test('parseDraftHeaders keeps a comma inside a quoted policy parameter intact', () => {
  const info = parseDraftHeaders({
    'RateLimit-Limit': '60',
    'RateLimit-Remaining': '1',
    'RateLimit-Reset': '30',
    'RateLimit-Policy': '60;w=30;comment="burst, allowed", 1000;w=3600',
  })
  assert.deepEqual(info.policies, [
    { quota: 60, windowSeconds: 30 },
    { quota: 1000, windowSeconds: 3600 },
  ])
})

test('parseDraftHeaders rejects a malformed policy in a multi-policy list', () => {
  assert.throws(
    () =>
      parseDraftHeaders({
        'RateLimit-Limit': '60',
        'RateLimit-Remaining': '1',
        'RateLimit-Reset': '30',
        'RateLimit-Policy': '10;w=1, unlimited;w=60',
      }),
    /invalid policy quota/,
  )
})

test('toDraftHeaders renders multiple policies joined by comma-space', () => {
  const info = {
    limit: 60,
    remaining: 1,
    resetSeconds: 30,
    policies: [
      { quota: 10, windowSeconds: 1 },
      { quota: 1000, windowSeconds: 3600 },
    ],
  }
  assert.equal(toDraftHeaders(info)['RateLimit-Policy'], '10;w=1, 1000;w=3600')
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

test('parseRetryAfter reads the delay-seconds form', () => {
  assert.equal(parseRetryAfter('120', 0), 120)
})

test('parseRetryAfter reads the HTTP-date form relative to now', () => {
  const seconds = parseRetryAfter('Thu, 01 Jan 1970 00:02:00 GMT', 60)
  assert.equal(seconds, 60)
})

test('parseRetryAfter clamps a date already in the past to zero', () => {
  const seconds = parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', 60)
  assert.equal(seconds, 0)
})

test('parseRetryAfter rejects a value that is neither seconds nor a date', () => {
  assert.throws(() => parseRetryAfter('soon', 0), /invalid retry-after/)
})

test('formatRetryAfter rounds and clamps to a non-negative integer string', () => {
  assert.equal(formatRetryAfter(30.4), '30')
  assert.equal(formatRetryAfter(-5), '0')
})

test('parseRetryAfterHeader returns undefined when the header is absent', () => {
  assert.equal(parseRetryAfterHeader({}, 0), undefined)
})

test('parseRetryAfterHeader reads the header case-insensitively', () => {
  assert.equal(parseRetryAfterHeader({ 'retry-after': '45' }, 0), 45)
})

test('toRetryAfterHeader renders a Retry-After header', () => {
  assert.deepEqual(toRetryAfterHeader(45), { 'Retry-After': '45' })
})
