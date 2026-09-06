// Run with: npm test (builds first, then runs against dist/).
// Exercises the CLI as a subprocess, the same way a real invocation works.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js')

function runCli(input, args = []) {
  return spawnSync(process.execPath, [cliPath, ...args], { input, encoding: 'utf8' })
}

test('converts curl -I style legacy headers to draft headers', () => {
  const input = [
    'HTTP/1.1 200 OK',
    'Date: Thu, 01 Jan 1970 00:00:00 GMT',
    'X-RateLimit-Limit: 60',
    'X-RateLimit-Remaining: 42',
    'X-RateLimit-Reset: 60',
    '',
  ].join('\r\n')
  const result = runCli(input)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'RateLimit-Limit: 60\nRateLimit-Remaining: 42\nRateLimit-Reset: 60\n')
})

test('converts draft headers to legacy headers with --to=legacy', () => {
  const input = ['RateLimit-Limit: 100', 'RateLimit-Remaining: 5', 'RateLimit-Reset: 30', ''].join('\n')
  const result = runCli(input, ['--to=legacy'])
  assert.equal(result.status, 0)
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines[0], 'X-RateLimit-Limit: 100')
  assert.equal(lines[1], 'X-RateLimit-Remaining: 5')
  assert.match(lines[2], /^X-RateLimit-Reset: \d+$/)
})

test('includes a converted Retry-After header alongside the rate-limit headers', () => {
  const input = [
    'Date: Thu, 01 Jan 1970 00:00:00 GMT',
    'RateLimit-Limit: 60',
    'RateLimit-Remaining: 0',
    'RateLimit-Reset: 30',
    'Retry-After: 30',
    '',
  ].join('\n')
  const result = runCli(input, ['--to=legacy'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Retry-After: 30/)
})

test('fails with a clear error when no rate-limit headers are present', () => {
  const result = runCli('Content-Type: text/plain\n')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no X-RateLimit-\* or RateLimit-\* headers found/)
})

test('fails when both legacy and draft headers are present without --to', () => {
  const input = [
    'X-RateLimit-Limit: 60',
    'X-RateLimit-Remaining: 1',
    'X-RateLimit-Reset: 100',
    'RateLimit-Limit: 60',
    'RateLimit-Remaining: 1',
    'RateLimit-Reset: 30',
    '',
  ].join('\n')
  const result = runCli(input)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /both legacy and draft headers/)
})
