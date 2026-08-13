# SPEC — @lamstack/http

**Status:** v2 — supersedes the v1 draft. Architecture incorporates a redesign that fixed
a real bug in v1 (`dispatch()` re-entering the pipeline from the top would have run
outer middleware twice on every retry) and formalizes plugin ordering, the
request/response contract, and the adapter contract. **v1 *scope* stays deliberately
lean** per this session's interview — `retryPlugin` and progress capabilities
(`onUploadProgress`/`onDownloadProgress`) are architected for (reserved `PluginOrder.retry`
slot, `AdapterCapabilities` shape) but **not implemented** until v1.1. Everything in this
document describes the v1 build unless explicitly marked "v1.1."

## 1. Objective

`@lamstack/http` is a framework-agnostic HTTP client core with zero hard dependency on
`axios` or `fetch`. All transport goes through a pluggable `HttpAdapter`; all "smart"
behavior (auth header injection, 401 detection, refresh-and-retry, request queueing
during refresh, error mapping) is implemented as **plugins** on a Koa/onion-style
middleware pipeline — not hardcoded into the client class. Built-in plugins (`authPlugin`,
`refreshPlugin`) use the exact same public `client.use()` API a consumer's own plugin
would use; they hold no special privilege beyond the public `PluginOrder` constants.

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
  subpath exports of this one package (`@lamstack/http/adapters/fetch`,
  `@lamstack/http/adapters/axios`), matching how `@lamstack/initializer` has no
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
  readonly url: string;              // absolute, params already serialized
  readonly method: HttpMethod;       // uppercase
  readonly headers: HttpHeaders;     // lowercase keys, fully merged
  readonly body?: TBody;
  readonly signal?: AbortSignal;
  readonly timeout: number;          // 0 = unlimited
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

| Rule | Behavior |
| --- | --- |
| `baseURL` | `new URL(url, baseURL)` |
| Absolute URL | An absolute `http(s)` URL ignores `baseURL` entirely |
| Slash handling | `https://a.com/api` + `users` → `https://a.com/api/users` |
| Header precedence | adapter defaults ← client headers ← request headers |
| Header deletion | `null`/`undefined` at a later layer removes the previous value |
| Header case | All keys normalized to lowercase |
| Header collision | Keys equal after lowercasing overwrite earlier values |
| Params | `null`/`undefined` values omitted |
| Array params | Repeat the key: `id=1&id=2` |
| Date params | Serialized as ISO strings |
| Existing query | `/x?a=1` + `{ b: 2 }` → `/x?a=1&b=2` |

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

export type HttpErrorCode = 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELED' | 'PARSE_ERROR';

export class HttpError<T = unknown> extends Error {
  readonly name = 'HttpError';
  readonly code: HttpErrorCode;
  readonly status: number;          // 0 when there is no HTTP response
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
the correct code. The axios adapter overrides `validateStatus: () => true` on a *copy* of
the caller's axios config so the adapter (not the user's axios instance defaults)
controls status interpretation.

### 2.3 Middleware and Pipeline (`dispatch()` removed)

```ts
export type Next = (req: HttpRequest) => Promise<HttpResponse>;
export type Middleware = (req: HttpRequest, next: Next) => Promise<HttpResponse>;
```

`next()` is **re-entrant** — a middleware may call it more than once, and each call
re-runs only the **inner** portion of the onion (not the whole pipeline from the top).
This is what makes refresh-and-retry work without the v1-draft bug where re-entering
from the top ran outer middleware (e.g. an observability plugin) twice per retry:

```
observe → refresh → auth → transport
```
If `refresh` calls `next(req)` a second time, only `auth → transport` re-run; `observe`
and `refresh` itself each ran exactly once. **This must be an explicit test**, not just
an architectural claim.

Any middleware placed *inside* a retrying middleware must be safe to run more than once
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
  refresh: 0,
  retry: 50,     // reserved for v1.1's retryPlugin — no plugin uses this slot in v1
  auth: 100,
  transport: 200,
} as const;
```

`PluginOrder` is public and part of the semver contract from `1.0.0`: smaller numbers
run further outside; equal `order` preserves `use()` insertion order; existing values
never change in a minor/patch release; gaps are intentional so third-party plugins can
insert between built-in layers.

### 2.5 `meta`

```ts
export interface HttpMeta {
  auth?: boolean;      // false → authPlugin skips this request
  mapError?: boolean;  // false → errorMapperPlugin leaves the error untouched
  refresh?: boolean;   // false → refreshPlugin will not attempt refresh
  [key: string]: unknown;
}
```

Plugin-internal state (e.g. a retry-attempt counter, reserved for v1.1) must use
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
  paramsSerializer?: (params: QueryParams) => string;
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
  post<T, B = unknown>(url: string, body?: B, init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>): Promise<T>;
  put<T, B = unknown>(url: string, body?: B, init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>): Promise<T>;
  patch<T, B = unknown>(url: string, body?: B, init?: Omit<HttpRequestInit, 'url' | 'method' | 'body'>): Promise<T>;

  upload<T>(url: string, data: Record<string, unknown> | FormData, init?: HttpRequestInit): Promise<T>;
  download(url: string, init?: HttpRequestInit): Promise<Blob>;

  /** New client inheriting the parent's middleware/options — used to build a refresh-only client with no auth/refresh plugins attached. */
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
  readonly capabilities: AdapterCapabilities;  // v1: both adapters report all-false
  send<T>(req: HttpRequest): Promise<HttpResponse<T>>;
}

export function fetchAdapter(options?: { fetch?: typeof globalThis.fetch }): HttpAdapter;
export function axiosAdapter(instance: AxiosInstance): HttpAdapter;
```

Per SPEC v1 (interview-confirmed): `axios.create({ adapter: 'fetch' })` existing doesn't
change this design — `axiosAdapter` treats the axios instance as an opaque black box
regardless of what it uses internally for transport.

**Adapter contract test suite** — one scripted scenario set run against both adapters,
proving they're interchangeable (v1 scenarios only; progress-specific scenarios deferred
to v1.1 alongside the feature):

```
200 JSON · 200 text · 204 No Content · 404 + JSON body · 500 + HTML body
network error · timeout · abort before request · abort during request
invalid JSON · lowercase response headers · responseType: blob
```

## 5. Ported Behavior (parity checklist against `omni.com/dashboard/src/lib/http-client`)

| Old (axios-only) | New (adapter-agnostic) |
| --- | --- |
| `HttpClient` (get/post/put/delete/patch/upload/download/createCancelable) | `HttpClient` core class + standalone `cancelable()` helper |
| Request interceptor (bearer header) | `authPlugin(tokenProvider)` at `PluginOrder.auth` |
| Response interceptor (401 → refresh → queue → retry) | `refreshPlugin(options)` at `PluginOrder.refresh`, using re-entrant `next()` instead of `dispatch()` |
| `TokenProvider` interface | Same contract, renamed: `bearer`→`getAccessToken`, `persist`→`saveTokens`, `refreshable`→`canRefresh`, `configure`→`decorate`, `prepareRefresh`→`buildRefreshRequest` |
| `LocalStorageTokenProvider`, `CookieHttpOnlyTokenProvider` | Ported with renamed methods — already storage-agnostic via `Storage`, no axios coupling to remove |
| `DefaultTokenRefreshPolicy` | `defaultRefreshPolicy({ statuses?, excludePaths? })`, same 401-only + excluded-paths behavior |
| `isRefreshing` + `failedQueue` | Same algorithm inside `refreshPlugin`'s closure; **on refresh failure, each queued request now rejects with its own original error**, with the refresh error attached via `.cause` (improvement over the old code, which rejected every queued request with the same refresh error) |
| `HttpEventBus` ('unauthorized'/'forbidden') | Typed `HttpEventBus` + `HttpEventMap` (`unauthorized`, `token:refreshed`, `token:refresh-failed`) |
| `HttpError` (status/code/data, `isNetworkError`) | Ported into core as part of the adapter contract, `+isCanceled`, `.cause`, `HttpError.is()`/`.from()` |
| `ErrorNormalizer`/`ErrorHandler` | `errorMapperPlugin(map)` — maps server error payloads only; transport-level normalization is now the adapter's job (§2.2), not the plugin's |
| `FormBuilder` + `FileSerializer` + `WebFileSerializer`/`ReactNativeFileSerializer` | Ported as-is into `serializers/` — pure Web API, no axios coupling |
| `createCancelable` | `cancelable()` standalone helper (§3) |
| (new) separate `authClient` to avoid interceptor loops | `client.extend({...})` producing a client with no auth/refresh plugins, passed as `refreshPlugin`'s `refreshClient` |

## 6. Commands

No deviation from the repo convention (see `packages/initializer`):

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

## 7. Project Structure

```
packages/http/
  src/
    core/
      types.ts              # HttpRequestInit, HttpRequest, HttpResponse, HttpMeta, Middleware, HttpPlugin, PluginOrder
      resolve.ts             # HttpRequestInit -> HttpRequest resolution (§2.1 rules table)
      pipeline.ts             # compose() — onion execution with re-entrant next()
      http-error.ts            # HttpError
      http-event-bus.ts         # HttpEventBus + HttpEventMap
      client.ts                  # HttpClient: use/request/get.../upload/download/extend
      cancelable.ts                # standalone cancelable() helper
    plugins/
      auth.plugin.ts
      refresh.plugin.ts             # includes defaultRefreshPolicy, RefreshPolicy type
      error-mapper.plugin.ts
      token-provider.ts               # TokenProvider interface
      local-storage-token.provider.ts
      cookie-token.provider.ts
    serializers/
      file-serializer.ts
      web-file.serializer.ts
      native-file.serializer.ts
      form-builder.ts
    adapters/
      fetch.adapter.ts                  # subpath export: @lamstack/http/adapters/fetch
      axios.adapter.ts                   # subpath export: @lamstack/http/adapters/axios
      contract.test-kit.ts                 # shared scenario suite, imported by both adapters' tests
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
  // @lamstack/http core/plugins/serializers must not import a transport library directly.
  files: ['packages/http/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', { paths: ['axios'] }],
  },
},
{
  files: ['packages/http/src/adapters/axios.adapter.ts'],
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
- **Refresh-queue concurrency** — highest-risk logic, dedicated tests using the
  `deferred()`-promise pattern from `packages/initializer/src/runner.test.ts`:
  - N concurrent 401s → exactly one refresh call, all N retry successfully.
  - Refresh fails → each queued request rejects with **its own** original error,
    refresh error attached via `.cause` (not a shared rejection value — this is the
    parity-improving change over the old dashboard code, verify it explicitly).
  - A request after refresh already resolved doesn't join a stale queue.
  - `excludePaths`/refresh-endpoint requests never trigger a refresh loop.
- **Adapter contract suite** (§4) run once per adapter, asserting identical
  `HttpResponse`/`HttpError` shape for the same scripted exchange — this is what proves
  adapter-agnosticism, not the architecture diagram.
- **`tsconfig.nodom.json` build check**: compiling `src/index.ts` alone against
  `lib: ["ES2022"]` (no DOM) must succeed — proves the root entry never leaks
  `fetch`/DOM/axios types, catching what the eslint rule alone wouldn't (type-only leaks).
- **Serializer tests** (`FormBuilder`, `WebFileSerializer`, `NativeFileSerializer`) — new
  coverage; none exists in the source implementation today.

## 10. Boundaries

**Always do:**
- Keep `packages/http/src/index.ts` (and everything under `core/`, `plugins/`,
  `serializers/`) free of any `axios`/`fetch`-specific import — enforced by §8's lint
  rule and §9's `tsconfig.nodom.json` check, not just review.
- Ship every version change through a `.changeset/*.md` file — never hand-edit
  `package.json`'s `version`.
- Give `authPlugin`/`refreshPlugin` no capability a third-party plugin couldn't
  replicate using the public `Middleware`/`HttpPlugin`/`PluginOrder` contract.
- Keep v1.1-reserved surface (`PluginOrder.retry`, `AdapterCapabilities` fields) present
  but honestly inert in v1 — don't half-implement retry/progress.

**Ask first about:**
- Any change to `HttpRequest`/`Middleware`/`HttpAdapter`/`PluginOrder` once this ships
  `1.0.0` — these are the contract every plugin and adapter is built against.
- Adding a new subpath export, a new first-party plugin beyond
  `auth`/`refresh`/`error-mapper`, or starting v1.1 (`retryPlugin`, progress) work.
- Creating any additional `@lamstack/*` package.

**Never do:**
- Never add `axios` or a `fetch` polyfill as a non-optional dependency of the package
  root / `core`.
- Never special-case the built-in `auth`/`refresh` plugins in `HttpClient` internals in a
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
