#!/usr/bin/env node
// Pipes raw response headers (e.g. `curl -I https://api.example.com/`) through
// the legacy/draft converter. Reads stdin, writes the converted headers to
// stdout as plain "Name: value" lines.
//
//   curl -sI https://api.github.com/users/octocat | ratelimit-bridge
//   curl -sI https://example.com/ | ratelimit-bridge --to=legacy

import {
  type HeaderMap,
  parseLegacyHeaders,
  parseDraftHeaders,
  toLegacyHeaders,
  toDraftHeaders,
  parseRetryAfterHeader,
  toRetryAfterHeader,
} from './index.js'

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

/**
 * Turns raw header text (as curl -I prints it, status line and all) into a
 * HeaderMap. Later occurrences of a repeated header win, since that matches
 * how most HTTP clients expose a duplicated header as a single value anyway.
 */
function parseRawHeaders(raw: string): HeaderMap {
  const headers: HeaderMap = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed === '' || trimmed.startsWith('HTTP/')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const name = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (name !== '') headers[name] = value
  }
  return headers
}

function hasLegacyHeaders(headers: HeaderMap): boolean {
  return Object.keys(headers).some((key) => /^x-rate-?limit-limit$/i.test(key))
}

function hasDraftHeaders(headers: HeaderMap): boolean {
  return Object.keys(headers).some((key) => /^ratelimit-limit$/i.test(key))
}

function nowFromDateHeader(headers: HeaderMap): number {
  const dateHeader = Object.keys(headers).find((key) => key.toLowerCase() === 'date')
  if (dateHeader !== undefined) {
    const parsed = Date.parse(headers[dateHeader]!)
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)
  }
  return Math.floor(Date.now() / 1000)
}

function printHeaders(headers: HeaderMap): void {
  for (const [name, value] of Object.entries(headers)) {
    process.stdout.write(`${name}: ${value}\n`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let target: 'legacy' | 'draft' | undefined
  for (const arg of args) {
    if (arg === '--to=legacy') target = 'legacy'
    else if (arg === '--to=draft') target = 'draft'
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: ratelimit-bridge [--to=legacy|--to=draft] < response-headers.txt\n' +
          '  reads raw HTTP response headers from stdin and prints the converted\n' +
          '  rate-limit headers to stdout. direction is auto-detected when omitted.\n',
      )
      return
    } else {
      throw new Error(`unrecognized argument: ${arg}`)
    }
  }

  const raw = await readStdin()
  const headers = parseRawHeaders(raw)
  const isLegacy = hasLegacyHeaders(headers)
  const isDraft = hasDraftHeaders(headers)

  if (target === undefined) {
    if (isLegacy && !isDraft) target = 'draft'
    else if (isDraft && !isLegacy) target = 'legacy'
    else if (isLegacy && isDraft) throw new Error('input has both legacy and draft headers; pass --to to pick a direction')
    else throw new Error('no X-RateLimit-* or RateLimit-* headers found in input')
  }

  const now = nowFromDateHeader(headers)
  const output: HeaderMap =
    target === 'draft' ? toDraftHeaders(parseLegacyHeaders(headers, now)) : toLegacyHeaders(parseDraftHeaders(headers), now)

  const retryAfter = parseRetryAfterHeader(headers, now)
  if (retryAfter !== undefined) Object.assign(output, toRetryAfterHeader(retryAfter))

  printHeaders(output)
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
