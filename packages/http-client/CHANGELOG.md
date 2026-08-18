# @lamstack/http-client

## 0.1.0

### Minor Changes

- 6a0c828: Initial release of `@lamstack/http-client` — a framework-agnostic HTTP client core with a
  pluggable middleware pipeline, fetch/axios adapters, and auth/refresh/error-mapper plugins.
- 48fceb8: Four fixes to the plugin layer, closing gaps between what `README.md` already
  described and what the code actually did:

  - **`withHeaders`/`withMeta`** — new pure helpers in `core/` for producing a copy of a
    resolved `HttpRequest` with headers or `meta` merged on top, using the same
    normalization rules as `resolve()` (header keys lowercased, `null`/`undefined` deletes a
    key). `bearer()`, `apiKey()`, `basic()`, and `recover()`'s internal meta bookkeeping now
    use them instead of hand-rolled spreads, so a plugin option with a differently-cased
    header name (e.g. `{ header: 'X-Api-Key' }`) correctly overwrites rather than duplicating
    an existing header.

  - **`metaOptOut()` and a symmetric `skip?`/`order?` on `auth`/`recover`/`errorMapper`** —
    all three plugins previously read `meta` opt-out flags inconsistently (`errorMapper` read
    `meta.mapError` automatically; `auth`/`recover` didn't read anything, requiring the
    caller to hand-compose the check into `shouldRecover`). All three now default to
    `metaOptOut('auth' | 'recover' | 'mapError')` — a strict `meta[key] === false` check — via
    a shared `options.skip`. **Migration:** if you were composing `meta.recover` into
    `shouldRecover` yourself (e.g.
    `shouldRecover: (ctx) => ctx.request.meta.recover !== false && onStatus(401)(ctx)`), drop
    the composition — `recover()` now handles it by default, checked independently of and
    before `shouldRecover` runs.

  - **`cooldownMs` on `recover()`** (default `1000`ms, `0` disables) — stops a "refresh
    storm": previously, every request that failed while the refresh endpoint itself was down
    would start its own brand-new recovery cycle against that same down endpoint, with no
    ceiling. Now, after a cycle fails, any request that would start a fresh one within
    `cooldownMs` instead throws its own original error immediately (with the cached recovery
    failure attached via `.cause`) and emits `recovery:unavailable`, with no new attempt
    against the refresh endpoint. A successful cycle resets the cooldown immediately.

  - **`maxStaleRetries` on `recover()`** (default `1`), independent of `maxAttempts` — a
    request that retries directly after a _different_ request's cycle already rotated the
    credential ("stale generation") previously spent the same attempt budget as a genuine
    recovery cycle, so a request stale-retried once could exhaust `maxAttempts: 1` before
    ever getting a real cycle of its own. Stale retries are now tracked by their own counter
    and capped separately; exceeding `maxStaleRetries` throws the original error with no new
    cycle.
- 8bd6407: Eight verified defects fixed, each reproduced against the actual built/runtime behavior
  before being fixed (not just against source):

  - **`HttpError.is()`/`instanceof HttpError` could return `false` for a real `HttpError`**,
    silently, when the check and the error came from different CJS entry points (e.g. the
    package root and `adapters/fetch`) — tsup only code-split the ESM output, so the CJS
    build inlined a separate `HttpError` class into each entry point. Fixed at the bundler
    level (`splitting: true`, one shared CJS chunk, same as ESM already had) and defensively
    in `HttpError.is()` itself, which now checks a `Symbol.for(...)` brand instead of
    `instanceof` — the brand also survives a genuinely separate module graph (duplicate
    installs npm failed to dedupe) that no bundler setting could unify.
  - **A synchronously-throwing `recover()` callback permanently disabled recovery** — a
    non-`async` callback whose body always throws (this typechecks: a `never`-returning
    function is assignable to `() => Promise<void>`) left `recover()`'s internal in-flight
    promise wedged on a dead, already-rejected value forever, so every later eligible
    failure reused it instead of starting a fresh cycle.
  - **`upload()` sent `FormData` mislabelled as JSON** when the client had a `Content-Type`
    default configured for its other requests — the server couldn't parse the multipart
    body (no boundary) and failed with an unrelated-looking error. `upload()` now clears any
    inherited `Content-Type` (an explicit per-request override still wins).
  - **A relative `baseURL` (e.g. `'/api'`, the default shape for a same-origin SPA — and the
    README's own `extend()` example) crashed with `TypeError: Invalid URL`** — `new
    URL(path, base)` requires an absolute base. Relative and protocol-relative baseURLs now
    join by string instead.
  - **`basic()` threw on non-ASCII credentials** — `btoa` is Latin-1-only, but RFC 7617
    permits UTF-8. Credentials are now UTF-8-encoded before base64-encoding.
  - **`fetchAdapter`/`axiosAdapter` disagreed on cancel-vs-timeout precedence** — when a user
    abort and the internal timeout raced, the two adapters reported different `HttpError`
    `code`s for the same situation. Both now check the user's own abort first.
    **Also documented** (not fixed — a genuine axios/XHR limitation): `credentials: 'omit'`
    cannot be expressed through axios, only `fetchAdapter`; see the README's Adapters
    section for the workaround.
  - **`responseType: 'stream'` threw a bare `Error`**, violating the adapter contract that
    every outcome is an `HttpError` — now throws `HttpError` with a new `code: 'UNSUPPORTED'`
    (distinct from `'UNKNOWN'`, which means an actual bug rather than an unsupported,
    pre-flight configuration).
  - Smaller items, batched: a `PARSE_ERROR` on malformed JSON now attaches the raw response
    text as `data` (previously only reachable via a non-exported class); `recover()`'s
    internal attempt/generation counters now use a fresh `Symbol()` per plugin instance
    instead of a shared `Symbol.for(...)`, so two `recover()` plugins stacked on one client
    (e.g. one for 401s, an inner one for 419/CSRF) no longer interfere with each other's
    budget; a stray `&` no longer appears when appending params to a url already ending in
    `?`; `NativeFileSerializer.accepts()` now checks the `uri` against the URI schemes React
    Native's own pickers produce, instead of accepting any object with a string `uri` field
    (previously misdetected e.g. `{ uri: 'spotify:track:...' }` as a file); `engines.node`
    corrected to `>=20.3.0` (the real floor `AbortSignal.any()` requires, previously
    understated as `>=20`); `package.json`'s `homepage` corrected to the docs site's actual
    route.

  No migration steps for existing code — every change either fixes behavior that was always
  documented/intended, or adds a new, additive `HttpErrorCode` member (`'UNSUPPORTED'`).
