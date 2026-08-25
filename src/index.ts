// Converts rate limit metadata between two header conventions:
//
//   legacy ("X-RateLimit-*", used by GitHub, Twitter's old API, many others)
//     X-RateLimit-Limit: 60
//     X-RateLimit-Remaining: 42
//     X-RateLimit-Reset: 1750000000        <- unix timestamp (seconds)
//
//   draft ("RateLimit-*", draft-ietf-httpapi-ratelimit-headers)
//     RateLimit-Limit: 60
//     RateLimit-Remaining: 42
//     RateLimit-Reset: 37                  <- seconds from now, not a timestamp
//     RateLimit-Policy: 60;w=60            <- optional, quota;window
//
// The two formats disagree on what "Reset" means (absolute vs. relative),
// which is the part that actually needs a clock to convert correctly.

export type HeaderMap = Record<string, string>

export interface RateLimitPolicy {
  quota: number
  windowSeconds: number
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  /** seconds remaining until the window resets, always relative */
  resetSeconds: number
  policy?: RateLimitPolicy
}

function getHeader(headers: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}

function requireNumber(raw: string, field: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`invalid ${field}: ${JSON.stringify(raw)}`)
  return n
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** Parses a "quota;w=seconds" RateLimit-Policy value. Unknown parameters are ignored. */
function parsePolicy(raw: string): RateLimitPolicy {
  const parts = raw.split(';').map((p) => p.trim())
  const quotaPart = parts[0]
  if (quotaPart === undefined) throw new Error(`invalid policy: ${JSON.stringify(raw)}`)
  const quota = requireNumber(quotaPart, 'policy quota')
  let windowSeconds = 60
  for (const part of parts.slice(1)) {
    const [key, value] = part.split('=').map((s) => s.trim())
    if (key === 'w' && value !== undefined) {
      const w = Number(value)
      if (Number.isFinite(w)) windowSeconds = w
    }
  }
  return { quota, windowSeconds }
}

function formatPolicy(policy: RateLimitPolicy): string {
  return `${policy.quota};w=${policy.windowSeconds}`
}

/**
 * Reads legacy X-RateLimit-* headers into the normalized shape.
 * `now` is the unix timestamp (seconds) to measure the reset against; defaults
 * to the current time, but pass the response's own `Date` header when you
 * have it, since clocks between client and server can drift.
 */
export function parseLegacyHeaders(headers: HeaderMap, now: number = nowSeconds()): RateLimitInfo {
  const limit = getHeader(headers, 'x-ratelimit-limit') ?? getHeader(headers, 'x-rate-limit-limit')
  const remaining = getHeader(headers, 'x-ratelimit-remaining') ?? getHeader(headers, 'x-rate-limit-remaining')
  const reset = getHeader(headers, 'x-ratelimit-reset') ?? getHeader(headers, 'x-rate-limit-reset')
  if (limit === undefined || remaining === undefined || reset === undefined) {
    throw new Error('missing one or more X-RateLimit-* headers')
  }
  const resetUnix = requireNumber(reset, 'reset')
  return {
    limit: requireNumber(limit, 'limit'),
    remaining: requireNumber(remaining, 'remaining'),
    resetSeconds: Math.max(0, Math.round(resetUnix - now)),
  }
}

/** Renders normalized info back into legacy X-RateLimit-* headers. */
export function toLegacyHeaders(info: RateLimitInfo, now: number = nowSeconds()): HeaderMap {
  return {
    'X-RateLimit-Limit': String(info.limit),
    'X-RateLimit-Remaining': String(info.remaining),
    'X-RateLimit-Reset': String(now + info.resetSeconds),
  }
}

/** Reads draft RateLimit-* headers into the normalized shape. */
export function parseDraftHeaders(headers: HeaderMap): RateLimitInfo {
  const limit = getHeader(headers, 'ratelimit-limit')
  const remaining = getHeader(headers, 'ratelimit-remaining')
  const reset = getHeader(headers, 'ratelimit-reset')
  if (limit === undefined || remaining === undefined || reset === undefined) {
    throw new Error('missing one or more RateLimit-* headers')
  }
  const info: RateLimitInfo = {
    limit: requireNumber(limit, 'limit'),
    remaining: requireNumber(remaining, 'remaining'),
    resetSeconds: Math.max(0, requireNumber(reset, 'reset')),
  }
  const policy = getHeader(headers, 'ratelimit-policy')
  if (policy !== undefined) info.policy = parsePolicy(policy)
  return info
}

/** Renders normalized info into draft RateLimit-* headers. */
export function toDraftHeaders(info: RateLimitInfo): HeaderMap {
  const out: HeaderMap = {
    'RateLimit-Limit': String(info.limit),
    'RateLimit-Remaining': String(info.remaining),
    'RateLimit-Reset': String(info.resetSeconds),
  }
  if (info.policy !== undefined) out['RateLimit-Policy'] = formatPolicy(info.policy)
  return out
}

/** Converts a legacy header set straight into draft headers. */
export function legacyToDraft(headers: HeaderMap, now: number = nowSeconds()): HeaderMap {
  return toDraftHeaders(parseLegacyHeaders(headers, now))
}

/** Converts a draft header set straight into legacy headers. */
export function draftToLegacy(headers: HeaderMap, now: number = nowSeconds()): HeaderMap {
  return toLegacyHeaders(parseDraftHeaders(headers), now)
}

/**
 * Parses a Retry-After value (RFC 9110 §10.2.3), which is either a
 * delay in whole seconds ("120") or an HTTP-date ("Fri, 31 Dec 1999 23:59:59 GMT").
 * Unlike the legacy and draft headers, Retry-After carries no limit or
 * remaining count, so it only ever produces a reset delay.
 */
export function parseRetryAfter(raw: string, now: number = nowSeconds()): number {
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, requireNumber(trimmed, 'retry-after'))
  }
  const parsedMs = Date.parse(trimmed)
  if (Number.isNaN(parsedMs)) throw new Error(`invalid retry-after: ${JSON.stringify(raw)}`)
  return Math.max(0, Math.round(parsedMs / 1000 - now))
}

/** Formats a reset delay as a Retry-After value, using the delay-seconds form. */
export function formatRetryAfter(resetSeconds: number): string {
  return String(Math.max(0, Math.round(resetSeconds)))
}

/** Reads a Retry-After header, if present, into a reset delay in seconds. */
export function parseRetryAfterHeader(headers: HeaderMap, now: number = nowSeconds()): number | undefined {
  const raw = getHeader(headers, 'retry-after')
  return raw === undefined ? undefined : parseRetryAfter(raw, now)
}

/** Renders a reset delay as a Retry-After header. */
export function toRetryAfterHeader(resetSeconds: number): HeaderMap {
  return { 'Retry-After': formatRetryAfter(resetSeconds) }
}
