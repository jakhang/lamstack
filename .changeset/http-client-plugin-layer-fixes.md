---
"@lamstack/http-client": minor
---

Four fixes to the plugin layer, closing gaps between what `SPEC.md`/`README.md` already
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
  request that retries directly after a *different* request's cycle already rotated the
  credential ("stale generation") previously spent the same attempt budget as a genuine
  recovery cycle, so a request stale-retried once could exhaust `maxAttempts: 1` before
  ever getting a real cycle of its own. Stale retries are now tracked by their own counter
  and capped separately; exceeding `maxStaleRetries` throws the original error with no new
  cycle.
