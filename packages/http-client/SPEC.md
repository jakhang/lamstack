# SPEC — @lamstack/http-client

**Status:** v3 — supersedes v2. v2 fixed a real v1-draft bug (`dispatch()` re-entering
the pipeline from the top would have run outer middleware twice on every retry) and
formalized plugin ordering, the request/response contract, and the adapter contract. v3
is a deliberate breaking change to the auth/refresh layer while the package is still at
`0.x` and unpublished (Part B below): `TokenProvider`'s six methods, shared by two
unrelated concerns, are split into an `Authenticator` contract (`auth()`) and a generic
recovery contract (`recover()`), with `HttpEventBus` replaced by a generic `EventBus<TMap>`.
**v1 _scope_ stays deliberately lean** — `retryPlugin` and progress capabilities
(`onUploadProgress`/`onDownloadProgress`) are architected for (reserved `PluginOrder.retry`
slot, `AdapterCapabilities` shape) but **not implemented** until v1.1.

## 1. Objective

`@lamstack/http-client` is a framework-agnostic HTTP client core with zero hard
dependency on `axios` or `fetch`. All transport goes through a pluggable `HttpAdapter`;
all "smart" behavior (credential attachment, failure recovery, error mapping) is
implemented as **plugins** on a Koa/onion-style middleware pipeline — not hardcoded into
the client class. Built-in plugins (`auth`, `recover`, `errorMapper`) use the exact same
public `client.use()` API a consumer's own plugin would use; they hold no special
privilege beyond the public `PluginOrder` constants.

This generalizes a real, working axios-only `HttpClient` already running in production at
`omni.com/dashboard` (`src/lib/http-client/`) into a reusable, publishable package that
works identically on an axios instance or on native `fetch`.

**Target users:** public npm consumers under the `@lamstack` scope, first exercised by
migrating `omni.com/dashboard` off its local `http-client` onto this package.

**Non-goals (v1):**

- No SSE plugin implementation — only the extensibility (plugin system + arbitrary
  header/meta control) to add one later.
- **No `retryPlugin`** (v1.1) — `PluginOrder.retry` is reserved in the constant table so
  v1.1 can slot it in without renumbering, but no retry logic ships in v1.
- **No progress capabilities** (v1.1) — `onUploadProgress`/`onDownloadProgress`,
  `AdapterCapabilities` negotiation, and `unsupportedCapability` policy are deferred.
  Adapters still declare a `capabilities` object in v1 (honestly reporting
  `{ uploadProgress: false, downloadProgress: false, stream: false }`) so the v1.1
  interface doesn't change shape, only behavior.
- No new npm scope or sibling package for adapters — `axios`/`fetch` adapters ship as
  subpath exports of this one package (`@lamstack/http-client/adapters/fetch`,
  `@lamstack/http-client/adapters/axios`), matching how `@lamstack/initializer` has no
  framework-target prefix and avoiding an empty placeholder package.
- No React-specific bindings (no `@lamstack/react-http`) — out of scope until a concrete
  React-only need exists.

## 2. Core Contracts

### 2.1 Request: `HttpRequestInit` (caller-facing) → `HttpRequest` (resolved, immutable)

Resolution happens **exactly once**, before the first middleware executes. Middleware
must not mutate a resolved request — use the `withHeaders`/`withMeta` helpers to produce
a new one.

```ts
export interface HttpRequestInit<TBody = unknown> {
  url?: string;
  method?: HttpMethod;
  headers?: HeadersInput;
  params?: QueryParams;
  body?: TBody;
  signal?: AbortSignal;
  timeout?: number;
  credentials?: 'omit' | 'same-origin' | 'include';
  responseType?: ResponseType;
  paramsSerializer?: (params: QueryParams) => string;
  meta?: HttpMeta;
}

export interface HttpRequest<TBody = unknown> {
  readonly url: string; // absolute, params already serialized
  readonly method: HttpMethod; // uppercase
  readonly headers: HttpHeaders; // lowercase keys, fully merged
  readonly body?: TBody;
  readonly signal?: AbortSignal;
  readonly timeout: number; // 0 = unlimited
  readonly credentials: 'omit' | 'same-origin' | 'include';
  readonly responseType: ResponseType;
  readonly meta: HttpMeta;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
export type HttpHeaders = Readonly<Record<string, string>>;
export type HeadersInput = Record<string, string | number | null | undefined>;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;
type QueryValue = string | number | boolean | Date | null | undefined;
```

**Resolution rules — each is a public contract and gets a dedicated test:**

| Rule              | Behavior                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseURL`         | Axios-style join: strips `url`'s leading `/` before combining, so the `baseURL` path prefix is preserved — not literal `new URL(url, baseURL)` semantics, which would drop it for an absolute-path `url` |
| Absolute URL      | An absolute `http(s)` URL ignores `baseURL` entirely                                                                                                                                                     |
| Slash handling    | `https://a.com/api` + `users` → `https://a.com/api/users`                                                                                                                                                |
| Header precedence | adapter defaults ← client headers ← request headers                                                                                                                                                      |
| Header deletion   | `null`/`undefined` at a later layer removes the previous value                                                                                                                                           |
| Header case       | All keys normalized to lowercase                                                                                                                                                                         |
| Header collision  | Keys equal after lowercasing overwrite earlier values                                                                                                                                                    |
| Params            | `null`/`undefined` values omitted                                                                                                                                                                        |
| Array params      | Repeat the key: `id=1&id=2`                                                                                                                                                                              |
| Date params       | Serialized as ISO strings                                                                                                                                                                                |
| Existing query    | `/x?a=1` + `{ b: 2 }` → `/x?a=1&b=2`                                                                                                                                                                     |

### 2.2 Response and Error

```ts
export interface HttpResponse<T = unknown> {
  readonly data: T;
  readonly status: number;
  readonly statusText: string;
  readonly headers: HttpHeaders;
  readonly request: HttpRequest;
  /** Adapter-specific object (Response, AxiosResponse). Escape hatch only — core must not depend on it. */
  readonly raw?: unknown;
}

// 'UNKNOWN' is HttpError.from()'s fallback for a caught value that isn't recognizably a
// transport failure — e.g. a bug in a plugin between recover()/errorMapper() and the
// adapter. Never claims NETWORK_ERROR for something that might not be.
export type HttpErrorCode =
  'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELED' | 'PARSE_ERROR' | 'UNKNOWN';

export class HttpError<T = unknown> extends Error {
  readonly name = 'HttpError';
  readonly code: HttpErrorCode;
  readonly status: number; // 0 when there is no HTTP response
  readonly data?: T;
  readonly request: HttpRequest;
  readonly response?: HttpResponse<T>;
  readonly cause?: unknown;
  get isNetworkError(): boolean;
  get isCanceled(): boolean;
  static is(e: unknown): e is HttpError;
  static from(e: unknown, req: HttpRequest): HttpError;
}
```

`HttpError` lives in **core**, not an adapter or plugin — it is part of the adapter
contract. `send()` resolves only for 2xx; everything else rejects with `HttpError` using
the correct code. The axios adapter overrides `validateStatus: () => true` on a _copy_ of
the caller's axios config so the adapter (not the user's axios instance defaults)
controls status interpretation.

### 2.3 Middleware and Pipeline (`dispatch()` removed)

```ts
export type Next = (req: HttpRequest) => Promise<HttpResponse>;
export type Middleware = (req: HttpRequest, next: Next) => Promise<HttpResponse>;
```

`next()` is **re-entrant** — a middleware may call it more than once, and each call
re-runs only the **inner** portion of the onion (not the whole pipeline from the top).
This is what makes recover-and-retry work without the v1-draft bug where re-entering
from the top ran outer middleware (e.g. an observability plugin) twice per retry:

```
observe → recover → auth → transport
```

If `recover` calls `next(req)` a second time, only `auth → transport` re-run; `observe`
and `recover` itself each ran exactly once. **This must be an explicit test**, not just
an architectural claim.

Any middleware placed _inside_ a retrying middleware must be safe to run more than once
per logical request — documented prominently in the README.

### 2.4 Plugin Ordering (public API)

```ts
export interface HttpPlugin {
  readonly name: string;
  /** Smaller values execute further outside the pipeline. */
  readonly order: number;
  readonly handler: Middleware;
}

export const PluginOrder = {
  observe: -200,
  normalize: -100,
  recover: 0,
  retry: 50, // reserved for v1.1's retryPlugin — no plugin uses this slot in v1
  auth: 100,
  transport: 200,
} as const;
```

`PluginOrder` is public and part of the semver contract from `1.0.0`: smaller numbers
run further outside; equal `order` preserves `use()` insertion order; existing values
never change in a minor/patch release; gaps are intentional so third-party plugins can
insert between built-in layers. The slot names are stable independent of which plugin
occupies them — `PluginOrder.recover` is unchanged from v2's `PluginOrder.refresh`
(the plugin at that slot was renamed, the slot itself was not).

A plain `Middleware` function registered via `client.use(fn)` (not wrapped in an
`HttpPlugin`) defaults to `PluginOrder.normalize`, **not** `PluginOrder.recover`'s slot
(`0`) — an unadorned `client.use(fn)` must not silently interleave with recovery retries
purely by registration order.

### 2.5 `meta`

```ts
export interface HttpMeta {
  auth?: boolean; // conventional name for a caller's own auth() `skip` predicate to check — not read automatically
  mapError?: boolean; // false → errorMapper leaves the error untouched (read automatically)
  recover?: boolean; // conventional name for a caller's own shouldRecover to check — not read automatically
  [key: string]: unknown;
  [key: symbol]: unknown;
}
```

`mapError` is the only flag `errorMapper` reads itself. `auth`/`recover` are _not_ read
automatically by `auth()`/`recover()` as of v3 — both plugins are fully generic
(`options.skip`/`shouldRecover`), so a per-request opt-out is expressed by composing it
into that callback yourself, e.g. `shouldRecover: (ctx) => ctx.request.meta.recover !== false && onStatus(401)(ctx)`.
The field names remain a documented convention for doing so.

Plugin-internal state (e.g. `recover()`'s attempt/generation counters) must use
`Symbol.for('lamstack.http.*')` keys, never plain strings, so it can never collide with
a consumer's own `meta` entries.

## 3. `HttpClient`

```ts
export interface HttpClientOptions {
  adapter: HttpAdapter;
  baseURL?: string;
  headers?: HeadersInput;
  timeout?: number;
  credentials?: 'omit' | 'same-origin' | 'include';
  responseType?: ResponseType;
  paramsSerializer?: (params: QueryParams) => string;
  /** Strategy for appending non-primitive values to the FormData built by upload(). Defaults to WebFileSerializer. */
  fileSerializer?: FileSerializer;
}

export class HttpClient {
  constructor(options: HttpClientOptions);
  use(plugin: Middleware | HttpPlugin): this;

  /** Returns the complete response. */
  request<T>(init: HttpRequestInit): Promise<HttpResponse<T>>;

  /** Verb helpers return the parsed body (`data`), not the full response. */
  get<T>(url: string, init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>): Promise<T>;
  delete<T>(url: string, init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>): Promise<T>;
  head(url: string, init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>): Promise<HttpHeaders>;
  post<T, B = unknown>(
    url: string,
    body?: B,
    init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>,
  ): Promise<T>;
  put<T, B = unknown>(
    url: string,
    body?: B,
    init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>,
  ): Promise<T>;
  patch<T, B = unknown>(
    url: string,
    body?: B,
    init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>,
  ): Promise<T>;

  upload<T>(
    url: string,
    data: Record<string, unknown> | FormData,
    init?: HttpRequestInit,
  ): Promise<T>;
  download(url: string, init?: HttpRequestInit): Promise<Blob>;

  /**
   * New client inheriting the parent's middleware/options — used to build a recovery-only
   * client with no auth/recover plugins attached (typically what a `recover()` callback
   * calls internally to reach the refresh endpoint). Every field falls back via `??`, so
   * an explicit `undefined` can't unset an inherited value, and `headers` is replaced
   * wholesale rather than merged with the parent's — both documented on the method itself.
   */
  extend(options: Partial<HttpClientOptions>): HttpClient;
}

/** Standalone helper — AbortSignal is already first-class via HttpRequestInit.signal, so this isn't a client method. */
export function cancelable<T>(fn: (signal: AbortSignal) => Promise<T>): {
  promise: Promise<T>;
  cancel: (reason?: string) => void;
};
```

**Convention (document prominently in README):** verb helpers (`get`/`post`/...) return
`data`; `request()` returns the full `HttpResponse`. `head()` returns `HttpHeaders`
directly, since headers are the only useful result of a HEAD request.

## 4. Adapters

```ts
export interface AdapterCapabilities {
  uploadProgress: boolean;
  downloadProgress: boolean;
  stream: boolean;
}

export interface HttpAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities; // v1: both adapters report all-false
  send<T>(req: HttpRequest): Promise<HttpResponse<T>>;
}

export function fetchAdapter(options?: { fetch?: typeof globalThis.fetch }): HttpAdapter;
export function axiosAdapter(instance: AxiosInstance): HttpAdapter;
```

Per SPEC v1 (interview-confirmed): `axios.create({ adapter: 'fetch' })` existing doesn't
change this design — `axiosAdapter` treats the axios instance as an opaque black box
regardless of what it uses internally for transport.

**Adapter contract test suite** (`adapters/contract.test-kit.ts`) — one scripted scenario
set run against both adapters against a real local HTTP server, proving they're
interchangeable (v1 scenarios only; progress-specific scenarios deferred to v1.1
alongside the feature):

```
200 JSON · 200 text · 204 No Content · 404 + JSON body · 500 + HTML body
network error · timeout (including a timeout that elapses mid-body-read) · abort before
request · abort during request · invalid JSON on a 2xx (PARSE_ERROR) · a non-2xx response
whose body fails to parse still throws HTTP_ERROR with the raw text as data, not
PARSE_ERROR · lowercase response headers · responseType: 'blob' (including Content-Type
preserved on the Blob) · binary request body (Uint8Array) sent raw, not JSON-stringified ·
responseType: 'stream' throws a clear error, since capabilities.stream is false
```

## 5. Ported Behavior (parity checklist against `omni.com/dashboard/src/lib/http-client`)

| Old (axios-only)                                                                   | New (adapter-agnostic)                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpClient` (get/post/put/delete/patch/upload/download/createCancelable)          | `HttpClient` core class + standalone `cancelable()` helper                                                                                                                                                                                                                                                                          |
| Request interceptor (bearer header)                                                | `auth(bearer(source))` at `PluginOrder.auth` — see §5.1                                                                                                                                                                                                                                                                             |
| Response interceptor (401 → refresh → queue → retry)                               | `recover(options)` at `PluginOrder.recover`, using re-entrant `next()` instead of `dispatch()` — see §5.1                                                                                                                                                                                                                           |
| `TokenProvider` interface                                                          | Unchanged as of v3 — still exported, still the shape both shipped strategies implement; see §5.1 for how it now plugs into `auth()`/`recover()`                                                                                                                                                                                     |
| `LocalStorageTokenProvider`, `CookieHttpOnlyTokenProvider`                         | Unchanged as of v3, still fully supported (§5.1) — `tokenSession()`/`TokenStore` is a second, lower-level session-layer primitive alongside them, not a replacement                                                                                                                                                                 |
| `DefaultTokenRefreshPolicy`                                                        | `onStatus(401, { exclude? })` — same 401-only + excluded-paths behavior, now `recover()`'s `shouldRecover` default instead of a `TokenProvider`-coupled policy type                                                                                                                                                                 |
| `isRefreshing` + `failedQueue`                                                     | Same algorithm inside `recover()`'s closure, plus a generation counter (§5.1) so a request that fails after a _different_ request's cycle already rotated the credential retries directly instead of starting a redundant cycle; each queued request still rejects with its own original error, refresh error attached via `.cause` |
| `HttpEventBus` ('unauthorized'/'forbidden')                                        | Generic `EventBus<TMap>` (§5.1) — `recover()` defines its own `RecoveryEventMap` (`recovery:succeeded`/`recovery:failed`/`recovery:unavailable`); core no longer knows about tokens at the type level                                                                                                                               |
| `HttpError` (status/code/data, `isNetworkError`)                                   | Ported into core as part of the adapter contract, `+isCanceled`, `.cause` (non-enumerable, matching native `Error.cause`), `HttpError.is()`/`.from()` (`'UNKNOWN'` code for anything not recognizably a transport failure — see §2.2)                                                                                               |
| `ErrorNormalizer`/`ErrorHandler`                                                   | `errorMapper(map)` — maps server error payloads only; transport-level normalization is now the adapter's job (§2.2), not the plugin's                                                                                                                                                                                               |
| `FormBuilder` + `FileSerializer` + `WebFileSerializer`/`ReactNativeFileSerializer` | Ported as-is into `serializers/` — pure Web API, no axios coupling                                                                                                                                                                                                                                                                  |
| `createCancelable`                                                                 | `cancelable()` standalone helper (§3)                                                                                                                                                                                                                                                                                               |
| (new) separate `authClient` to avoid interceptor loops                             | `client.extend({...})` producing a client with no auth/recovery plugins, typically what a `recover()` callback calls internally                                                                                                                                                                                                     |

### 5.1 v3: `auth`/`refresh` → `Authenticator`/`recover` (SPEC v2 → v3 migration map)

`TokenProvider` had six methods serving two unrelated consumers (`auth` used
`getAccessToken`/`decorate`; `refresh` used the other four) — the intersection was empty.
v3 splits this into two narrow, independent contracts; `TokenProvider` and both shipped
strategies are unchanged and still slot into the new plugins directly, since
`TokenProvider.getAccessToken()` alone satisfies `bearer()`'s source contract.

| v2                                                                                                | v3                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth(provider, { header, scheme })`                                                              | `auth(bearer(source, { header, scheme }))` — `Authenticator = (req) => Awaitable<HttpRequest>`; presets: `bearer`, `apiKey`, `basic`, `allOf`                                                                                                                                                                                                                                                        |
| `TokenProvider.decorate` (called by `auth` before the header)                                     | Deleted from the call path — `auth()` no longer calls it. A cookie strategy sets `credentials: 'include'` on `HttpClientOptions` instead (was a real bug in v2: `decorate` ran _after_ the `meta.auth === false` skip check, so an opted-out request also silently lost `credentials: 'include'`)                                                                                                    |
| `refresh({ tokenProvider, refreshClient, shouldRefresh, ... })`                                   | `recover({ recover, canRecover?, shouldRecover?, maxAttempts?, events? })` — `recover: (context) => Promise<void>` is the only required contract; the callback decides how renewal happens (an HTTP request, `firebaseUser.getIdToken(true)`, a BroadcastChannel resync, ...)                                                                                                                        |
| `defaultRefreshPolicy({ statuses?, excludePaths? })`                                              | `onStatus(status, { exclude? })` — `recover()`'s `shouldRecover` default                                                                                                                                                                                                                                                                                                                             |
| `HttpMeta.refresh`                                                                                | `HttpMeta.recover` — neither this nor `HttpMeta.auth` is read automatically anymore; a per-request opt-out is composed into `shouldRecover`/`options.skip` yourself (§2.5)                                                                                                                                                                                                                           |
| `refresh` plugin auto-calling `tokenProvider.clear()` on failure/`canRefresh() === false`         | `recover()` calls no cleanup itself — it only emits `recovery:failed`/`recovery:unavailable`; the consumer wires `events.on('recovery:failed', () => provider.clear())`                                                                                                                                                                                                                              |
| `HttpEventBus` (`unauthorized`/`token:refreshed`/`token:refresh-failed`)                          | `EventBus<RecoveryEventMap>` (`recovery:succeeded`/`recovery:failed`/`recovery:unavailable`) — no `unauthorized` event; `recovery:unavailable` covers the old `canRefresh() === false` case                                                                                                                                                                                                          |
| (new in v3) redundant cycle for a stale in-flight request                                         | A generation counter in `recover()`: bumped each time a cycle succeeds; a request whose failure is caught with an older generation than current retries directly via `next()` instead of starting another cycle                                                                                                                                                                                      |
| `TokenProvider.buildRefreshRequest` + `saveTokens` + `canRefresh` + `clear` (session-layer usage) | `tokenSession({ store, client, renew })` — `TokenSession { getAccessToken, renew, canRenew, end }`. Its `getAccessToken()` alone satisfies `bearer()`'s source contract; `renew`/`canRenew` map directly to `recover()`'s `recover`/`canRecover` options; `end()` is wired the same way `provider.clear()` was — via `events.on('recovery:failed', () => session.end())`, never called automatically |

`tokenSession()`/`TokenStore` (§3.5) is implemented as of v3 — see `plugins/token-session.ts`.
It's a second, lower-level way to wire the same `recover()` + credential-source pattern
`TokenProvider` already provides, not a required migration off it: both
`LocalStorageTokenProvider` and `CookieHttpOnlyTokenProvider` remain fully supported via
`auth(bearer(provider))`. A "renew preset" wrapping the common
`buildRefreshRequest`/`saveTokens`/`defaultAccessTokenParser` pattern into a one-line
`tokenSession()` config (mentioned as a possibility in §3.9's migration map) is not built —
today `renew` is written by hand per the pattern shown in the README.

## 6. Commands

No deviation from the repo convention (see `packages/initializer`), plus a second
`tsconfig` pass so the DOM-leakage gate (§9) actually runs, not just when invoked by hand:

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.nodom.json"
  }
}
```

## 7. Project Structure

```
packages/http-client/
  src/
    core/
      types.ts              # HttpRequestInit, HttpRequest, HttpResponse, HttpMeta, Middleware, HttpPlugin, PluginOrder, AdapterCapabilities, Awaitable
      resolve.ts             # HttpRequestInit -> HttpRequest resolution (§2.1 rules table)
      pipeline.ts             # compose() — onion execution with re-entrant next()
      http-error.ts            # HttpError
      event-bus.ts               # generic EventBus<TMap>
      client.ts                  # HttpClient: use/request/get.../upload/download/extend
      cancelable.ts                # standalone cancelable() helper
    plugins/
      auth.plugin.ts                 # Authenticator type, auth() plugin
      authenticators.ts               # bearer/apiKey/basic/allOf presets
      recover.plugin.ts                # recover() plugin, onStatus(), RecoveryEventMap
      error-mapper.plugin.ts
      token-provider.ts                  # TokenProvider interface (unchanged, §5.1)
      local-storage-token.provider.ts
      cookie-token.provider.ts
      token-session.ts                     # tokenSession()/TokenStore/TokenSession (§3.5, §5.1)
    serializers/
      file-serializer.ts
      web-file.serializer.ts
      native-file.serializer.ts
      form-builder.ts
    adapters/
      fetch.adapter.ts                  # subpath export: @lamstack/http-client/adapters/fetch
      axios.adapter.ts                   # subpath export: @lamstack/http-client/adapters/axios
      contract.test-kit.ts                 # shared scenario suite, imported by both adapters' tests
    integration.test.ts                     # full auth+recover+errorMapper stack against a real adapter
    index.ts                                # core + plugins + serializers — NOT adapters
  package.json
  tsconfig.json
  tsconfig.nodom.json                          # lib: ["ES2022"], no DOM — proves root has no DOM/adapter leakage
  tsup.config.ts
  vitest.config.ts
  LICENSE
  README.md
```

`axios` is an optional `peerDependency`, needed only by `adapters/axios.adapter.ts`.

## 8. Code Style

No deviation from `eslint.config.js`/`tsconfig.base.json`. One addition:

```js
{
  // @lamstack/http-client core/plugins/serializers must not import a transport library directly.
  files: ['packages/http-client/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', { paths: ['axios'] }],
  },
},
{
  files: [
    'packages/http-client/src/adapters/axios.adapter.ts',
    'packages/http-client/src/adapters/axios.adapter.test.ts',
  ],
  rules: { 'no-restricted-imports': 'off' },
},
```

Verified the same way as `packages/initializer`'s boundary rule: intentionally import
`axios` from a core file, confirm ESLint errors, then revert.

## 9. Testing Strategy

- `vitest.config.ts`: `environment: 'node'`, `globals: true` (mirrors `packages/initializer`).
- **Resolution rules (§2.1)** each get a dedicated small/unit test — this table is the
  most reusable, highest-leverage test surface in the package since every request goes
  through it.
- **Re-entrant `next()` is explicitly tested**: a 3-middleware pipeline where the middle
  one calls `next()` twice, asserting the outer middleware ran once and the inner ran
  twice — this is the regression test for the bug the v2 redesign fixes.
- **Mock adapter** (`HttpAdapter` test double, scripted responses/errors) for all
  plugin/client tests not specifically about a real adapter.
- **Recovery-cycle concurrency** — highest-risk logic, dedicated tests using the
  `deferred()`-promise pattern from `packages/initializer/src/runner.test.ts`:
  - N concurrent 401s → exactly one recovery call, all N retry successfully.
  - Recovery fails → each queued request rejects with **its own** original error,
    the recovery error attached via `.cause` (not a shared rejection value — this is the
    parity-improving change over the old dashboard code, verify it explicitly).
  - A request after a cycle already resolved doesn't join a stale queue.
  - A request whose failure is caught with an older generation than current (§5.1) retries
    directly instead of starting a redundant cycle — the race a _different_ request's
    already-completed rotation can cause.
  - `exclude`/recovery-endpoint requests never trigger a recovery loop.
  - `auth()` re-runs inside `recover()`'s retry (order 100 sits inside order 0) — explicit
    test, not just an architectural claim.
- **Adapter contract suite** (§4) run once per adapter, asserting identical
  `HttpResponse`/`HttpError` shape for the same scripted exchange — this is what proves
  adapter-agnosticism, not the architecture diagram.
- **Integration test** (`integration.test.ts`): the full `auth` + `recover` + `errorMapper`
  stack against a real local HTTP server via `fetchAdapter()`, not the mock adapter — the
  adapter-parity suite proves each adapter's own behavior in isolation; this proves the
  plugins interact correctly with what a real adapter actually throws.
- **`tsconfig.nodom.json` build check**: compiling `src/index.ts` alone against
  `lib: ["ES2022"]` (no DOM) must succeed — proves the root entry never leaks
  `fetch`/DOM/axios types, catching what the eslint rule alone wouldn't (type-only leaks).
  Wired into the package's own `typecheck` script (§6), not just runnable by hand.
- **Serializer tests** (`FormBuilder`, `WebFileSerializer`, `NativeFileSerializer`) — new
  coverage; none exists in the source implementation today.

## 10. Boundaries

**Always do:**

- Keep `packages/http-client/src/index.ts` (and everything under `core/`, `plugins/`,
  `serializers/`) free of any `axios`/`fetch`-specific import — enforced by §8's lint
  rule and §9's `tsconfig.nodom.json` check, not just review.
- Ship every version change through a `.changeset/*.md` file — never hand-edit
  `package.json`'s `version`.
- Give `auth`/`recover` no capability a third-party plugin couldn't replicate using the
  public `Middleware`/`HttpPlugin`/`PluginOrder` contract.
- Keep v1.1-reserved surface (`PluginOrder.retry`, `AdapterCapabilities` fields) present
  but honestly inert in v1 — don't half-implement retry/progress.

**Ask first about:**

- Any change to `HttpRequest`/`Middleware`/`HttpAdapter`/`PluginOrder` once this ships
  `1.0.0` — these are the contract every plugin and adapter is built against.
- Adding a new subpath export, a new first-party plugin beyond
  `auth`/`recover`/`error-mapper`, or starting v1.1 (`retryPlugin`, progress) work.
- Creating any additional `@lamstack/*` package.
- Removing or deprecating `TokenProvider`/`LocalStorageTokenProvider`/
  `CookieHttpOnlyTokenProvider` in favor of `tokenSession()` — the latter is additive,
  not a signal the former are going away.

**Never do:**

- Never add `axios` or a `fetch` polyfill as a non-optional dependency of the package
  root / `core`.
- Never special-case the built-in `auth`/`recover` plugins in `HttpClient` internals in a
  way a user-authored plugin couldn't also do.
- Never re-enter the pipeline from the top for retry (the v1-draft bug) — retry is
  always a second `next()` call from within the retrying middleware.
- Never publish without the parity checklist in §5 fully green in tests.

## 11. Deferred to v1.1 (explicitly not built now)

- `retryPlugin` — backoff/jitter, `Retry-After` support, method-safety rules (no
  automatic retry of POST/PATCH), abort-during-backoff. `PluginOrder.retry = 50` is
  reserved so it slots in without renumbering.
- Progress capabilities — `onUploadProgress`/`onDownloadProgress`, fetch adapter's
  `ReadableStream`-based response reading, `unsupportedCapability` policy
  (`'throw' | 'warn' | 'ignore'`).
- SSE plugin (deferred since the original interview — architecture must support it,
  implementation does not exist).
- A "renew preset" wrapping the common `buildRefreshRequest`/`saveTokens`/
  `defaultAccessTokenParser` pattern into a one-line `tokenSession()` config (§5.1) —
  `tokenSession()`/`TokenStore` itself is implemented; only this convenience wrapper isn't.
