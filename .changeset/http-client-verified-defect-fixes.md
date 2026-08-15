---
"@lamstack/http-client": minor
---

Eight verified defects fixed, each reproduced against the actual built/runtime behavior
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
