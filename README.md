# ratelimit-header-bridge

APIs disagree on how they tell you about rate limits. The old convention,
still used by GitHub and a lot of other services, is `X-RateLimit-*` headers
where the reset value is a unix timestamp. The newer one, from
[draft-ietf-httpapi-ratelimit-headers](https://www.ietf.org/archive/id/draft-ietf-httpapi-ratelimit-headers-07.html),
is `RateLimit-*` headers where the reset value is seconds from now.

If you're writing a client that talks to several APIs, or a proxy that needs
to normalize what it forwards downstream, you end up needing to convert
between the two. The awkward part isn't the field names, it's that one
format is an absolute timestamp and the other is a relative delta, so the
conversion needs a clock.

This is a small library for that conversion. No dependencies, standard
library only.

## Usage

```ts
import { legacyToDraft, draftToLegacy, parseLegacyHeaders } from './src/index.js'

// Converting a response you received in the legacy format:
const upstream = {
  'X-RateLimit-Limit': '60',
  'X-RateLimit-Remaining': '42',
  'X-RateLimit-Reset': '1750000060',
}

const draft = legacyToDraft(upstream, 1750000000 /* now, unix seconds */)
// {
//   'RateLimit-Limit': '60',
//   'RateLimit-Remaining': '42',
//   'RateLimit-Reset': '60',
// }
```

```ts
// Converting the other direction, and inspecting the normalized value
// before re-rendering it:
const draftHeaders = {
  'RateLimit-Limit': '100',
  'RateLimit-Remaining': '5',
  'RateLimit-Reset': '30',
  'RateLimit-Policy': '100;w=60',
}

const info = parseLegacyHeaders // (not used here, just showing the shape)
const legacy = draftToLegacy(draftHeaders, 1750000000)
// {
//   'X-RateLimit-Limit': '100',
//   'X-RateLimit-Remaining': '5',
//   'X-RateLimit-Reset': '1750000030',
// }
```

Both directions go through a normalized `RateLimitInfo` shape if you want to
inspect or modify the values in between:

```ts
import { parseDraftHeaders, toLegacyHeaders } from './src/index.js'

const info = parseDraftHeaders(draftHeaders)
// { limit: 100, remaining: 5, resetSeconds: 30,
//   policy: { quota: 100, windowSeconds: 60 }, policies: [{ quota: 100, windowSeconds: 60 }] }

const legacy = toLegacyHeaders(info, 1750000000)
```

`RateLimit-Policy` can list more than one policy, comma-separated, when a
server enforces several windows at once (a burst limit and a daily quota,
say). `policies` holds all of them in order; `policy` is a convenience alias
for `policies[0]`:

```ts
const info = parseDraftHeaders({
  'RateLimit-Limit': '1000',
  'RateLimit-Remaining': '999',
  'RateLimit-Reset': '30',
  'RateLimit-Policy': '10;w=1, 1000;w=3600',
})
// info.policies === [{ quota: 10, windowSeconds: 1 }, { quota: 1000, windowSeconds: 3600 }]
```

`now` defaults to the current time if you don't pass it, but if you have the
response's own `Date` header available, pass that instead — client and
server clocks can drift enough to make the reset value wrong by a
noticeable margin.

### Retry-After

`Retry-After` ([RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3))
shows up on `429` responses either alongside the headers above or on its
own. It carries no limit or remaining count, just a reset delay, and its
value can be either a number of seconds or an HTTP-date:

```ts
import { parseRetryAfterHeader, toRetryAfterHeader } from './src/index.js'

parseRetryAfterHeader({ 'Retry-After': '120' }, 1750000000) // 120
parseRetryAfterHeader({ 'Retry-After': 'Fri, 15 Jun 2025 07:28:00 GMT' }, 1750000000)

toRetryAfterHeader(120) // { 'Retry-After': '120' }
```

## CLI

`ratelimit-bridge` reads raw response headers from stdin (whatever `curl -I`
prints, status line included) and writes the converted rate-limit headers to
stdout. Direction is auto-detected from whichever convention is present in
the input; pass `--to=legacy` or `--to=draft` if the input somehow has both.

```
curl -sI https://api.github.com/users/octocat | npx ratelimit-bridge
```

```
RateLimit-Limit: 60
RateLimit-Remaining: 56
RateLimit-Reset: 1732
```

If the response has its own `Date` header, the CLI uses that as `now`
instead of the local clock, for the same drift reason described above. A
`Retry-After` header, if present, is converted and included alongside the
rate-limit headers.

## Building

```
npx tsc
```

Compiles `src/` to `dist/` per `tsconfig.json`. There's nothing to install.

## Testing

```
npm test
```

Builds first, then runs `test/index.test.js` against the compiled output
with node's built-in test runner (`node:test`). No test framework to
install.

## Status

Early. Covers the legacy and draft header conventions, multiple policies in
RateLimit-Policy, Retry-After, and a CLI for piping `curl -I` output through
the converter. `package.json` is now set up for publishing (`files`,
`exports`, repository metadata); the release itself (`npm publish`) still
hasn't happened.
