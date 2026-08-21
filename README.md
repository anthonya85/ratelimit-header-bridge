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
// { limit: 100, remaining: 5, resetSeconds: 30, policy: { quota: 100, windowSeconds: 60 } }

const legacy = toLegacyHeaders(info, 1750000000)
```

`now` defaults to the current time if you don't pass it, but if you have the
response's own `Date` header available, pass that instead — client and
server clocks can drift enough to make the reset value wrong by a
noticeable margin.

## Building

```
npx tsc
```

Compiles `src/` to `dist/` per `tsconfig.json`. There's nothing to install.

## Status

Early. Covers the two header conventions above. See the roadmap for what's
missing.
