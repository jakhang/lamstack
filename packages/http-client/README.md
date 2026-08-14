# @lamstack/http-client

A framework-agnostic HTTP client core built around a pluggable, Koa/onion-style
middleware pipeline. The core has **zero runtime dependency on axios or fetch** — you
choose a transport adapter (`fetch` or `axios`, both included) and layer behavior
(auth, token refresh, error mapping, or anything you write yourself) on top via a single
`.use()` API. No plugin shipped with this package — not `auth`, not `refresh` — has any
capability you don't also have.

> **Pre-1.0** (`0.x`): the API may still change between minor versions. `retryPlugin` and
> upload/download progress are architected for (see [`PluginOrder`](#pluginorder) and
> `HttpAdapter.capabilities`) but not implemented yet — see
> [SPEC.md §11](./SPEC.md#11-deferred-to-v11-explicitly-not-built-now) for what's coming
> in v1.1.

## Table of contents

- [Why this exists](#why-this-exists)
- [Install](#install)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
  - [The request lifecycle](#the-request-lifecycle)
  - [Resolution rules](#resolution-rules)
  - [The middleware pipeline](#the-middleware-pipeline)
  - [`PluginOrder`](#pluginorder)
  - [`meta` flags](#meta-flags)
- [Adapters](#adapters)
  - [`fetchAdapter()`](#fetchadapter)
  - [`axiosAdapter()`](#axiosadapter)
  - [Writing your own adapter](#writing-your-own-adapter)
- [`HttpClient` API](#httpclient-api)
- [Authentication and token refresh](#authentication-and-token-refresh)
  - [The `TokenProvider` contract](#the-tokenprovider-contract)
  - [`auth`](#auth)
  - [`refresh`](#refresh)
  - [Built-in token providers](#built-in-token-providers)
  - [Writing your own `TokenProvider`](#writing-your-own-tokenprovider)
- [Session events (`HttpEventBus`)](#session-events-httpeventbus)
- [Error handling](#error-handling)
- [File uploads](#file-uploads)
- [Downloads](#downloads)
- [Cancellation](#cancellation)
- [Writing your own plugin](#writing-your-own-plugin)
- [Testing code that uses this package](#testing-code-that-uses-this-package)
- [TypeScript](#typescript)
- [Roadmap](#roadmap)
- [Credits](#credits)
- [License](#license)

## Why this exists

Most HTTP client wrappers pick a transport (axios, or `fetch`) and bolt auth/refresh
logic onto it via that transport's own interceptor system. That logic then can't move to
a different transport, and typically can't be unit-tested without mocking the transport
itself. This package inverts that: the pipeline (auth, refresh, error mapping, retry
policy, anything else) is transport-agnostic middleware; adapters are a thin,
interchangeable translation layer between that pipeline and a real transport. The same
`auth`/`refresh` setup works identically whether the underlying adapter is `fetch` or an
existing `axios` instance — proven by a shared contract test suite that runs both
adapters through identical scenarios (200/404/500/timeout/abort/...) and asserts
identical results.

## Install

```bash
pnpm add @lamstack/http-client
# or: npm install @lamstack/http-client
# or: yarn add @lamstack/http-client
# or: bun add @lamstack/http-client
```

`axios` is an **optional peer dependency** — only needed if you use
`@lamstack/http-client/adapters/axios`. If you only use the `fetch` adapter, you never
install it.

## Quick start

```ts
import { HttpClient } from '@lamstack/http-client';
import { fetchAdapter } from '@lamstack/http-client/adapters/fetch';

const client = new HttpClient({
  adapter: fetchAdapter(),
  baseURL: 'https://api.example.com',
});

interface User {
  id: string;
  name: string;
}

const user = await client.get<User>('/users/me');
await client.post('/users', { name: 'Ada' });
await client.put(`/users/${user.id}`, { name: 'Ada Lovelace' });
await client.delete(`/users/${user.id}`);
```

`get`/`post`/`put`/`patch`/`delete` all return the **parsed response body** directly —
not a wrapper object. Use [`client.request()`](#httpclient-api) when you need the status
code, headers, or other response metadata.

## Core concepts

### The request lifecycle

```text
HttpRequestInit  →  resolve()  →  HttpRequest (immutable)  →  pipeline  →  HttpAdapter  →  HttpResponse
     (yours)                         (what plugins see)      (your .use() chain)   (fetch/axios)
```

You never construct an `HttpRequest` yourself — you pass an `HttpRequestInit` to
`client.get()`/`client.post()`/`client.request()`, and `resolve()` turns it into the
immutable `HttpRequest` every middleware and the adapter actually see:

```ts
export interface HttpRequestInit<TBody = unknown> {
  url?: string;
  method?: HttpMethod; // 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  headers?: Record<string, string | number | null | undefined>;
  params?: Record<string, QueryValue | QueryValue[]>; // string | number | boolean | Date | null | undefined
  body?: TBody;
  signal?: AbortSignal;
  timeout?: number; // ms; 0 = unlimited
  credentials?: 'omit' | 'same-origin' | 'include';
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  paramsSerializer?: (params: QueryParams) => string;
  meta?: HttpMeta;
}
```

### Resolution rules

These run exactly once, before any middleware, and are the same regardless of which
adapter you use:

| Rule                  | Behavior                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `baseURL`             | Combined with a relative `url` via `new URL`-style joining                                                                           |
| Absolute `url`        | Ignores `baseURL` entirely (detected via a leading `scheme://`)                                                                      |
| Slash handling        | `baseURL: 'https://a.com/api'` + `url: 'users'` (or `'/users'`) → `https://a.com/api/users` — no doubled or missing slash either way |
| Header precedence     | client-level `headers` ← request-level `headers`, later wins                                                                         |
| Header deletion       | a `null`/`undefined` header value at the request layer removes a client-level default                                                |
| Header case           | every header key is normalized to lowercase                                                                                          |
| `params`              | `null`/`undefined` values omitted; arrays repeat the key (`id=1&id=2`); `Date` values become ISO strings                             |
| Existing query string | `url: '/x?a=1'` + `params: { b: 2 }` → `/x?a=1&b=2` (merged, not replaced)                                                           |
| `method`              | defaults to `'GET'`, uppercased                                                                                                      |
| `timeout`             | defaults to `0` (unlimited)                                                                                                          |
| `credentials`         | defaults to `'same-origin'`                                                                                                          |
| `responseType`        | defaults to `'json'`                                                                                                                 |

### The middleware pipeline

```ts
type Next = (request: HttpRequest) => Promise<HttpResponse>;
type Middleware = (request: HttpRequest, next: Next) => Promise<HttpResponse>;

interface HttpPlugin {
  name: string;
  order: number; // smaller = further outside the pipeline
  handler: Middleware;
}
```

`client.use()` accepts either a bare `Middleware` function (defaults to `order: 0`) or a
full `HttpPlugin` object. Plugins run in `order` order — ties preserve registration order.

**`next()` is re-entrant.** A middleware may call it more than once; each call re-runs
only the chain _after_ that middleware, never anything that already ran. This is what
lets `refresh` retry a request after a token refresh without re-running whatever is
registered outside it (logging, tracing, ...):

```text
register order:  observe(-200)  →  refresh(0)  →  auth(100)  →  transport (adapter)

401 on first attempt:
  observe runs (once) → refresh runs → auth runs → transport throws 401
                              ↓
                         refresh catches it, refreshes the token,
                         calls next() AGAIN — only auth + transport re-run:
                              ↓
                         auth runs (2nd time, fresh token) → transport → 200
```

### `PluginOrder`

```ts
export const PluginOrder = {
  observe: -200,
  normalize: -100,
  refresh: 0,
  retry: 50, // reserved for v1.1's retryPlugin — nothing uses this slot yet
  auth: 100,
  transport: 200,
} as const;
```

These are public, semver-stable ordering slots — `errorMapper` registers at `normalize`,
`refresh` at `refresh`, `auth` at `auth`. Write your own plugins against these constants
(e.g. `PluginOrder.auth - 1` to run just inside auth) instead of hardcoded numbers.

### `meta` flags

Every resolved `HttpRequest` carries a `meta` bag. The three built-in plugins each
respect one boolean flag on it, settable per request:

```ts
await client.get('/public-data', { meta: { auth: false } }); // auth skips this request
await client.get('/x', { meta: { refresh: false } }); // refresh never attempts a retry
await client.get('/x', { meta: { mapError: false } }); // errorMapper leaves the error as-is
```

`meta` is also where you can stash your own per-request data for a custom plugin to
read. Internal plugin state (like refresh's retry-attempt counter) uses a `Symbol.for(...)`
key instead of a string, specifically so it can never collide with anything you put here.

## Adapters

Adapters are the only place a transport library is imported — never from the package
root, so `import { HttpClient } from '@lamstack/http-client'` never pulls in axios or
adds fetch-specific types to your bundle analysis.

```ts
interface HttpAdapter {
  name: string;
  capabilities: { uploadProgress: boolean; downloadProgress: boolean; stream: boolean };
  send<T>(request: HttpRequest): Promise<HttpResponse<T>>;
}
```

Both shipped adapters currently report every capability `false` (progress support is
v1.1 — see [Roadmap](#roadmap)) and behave identically for the same request: same
`HttpResponse` shape on success, same `HttpError` code/status on failure — verified by a
single shared contract test suite run against both.

### `fetchAdapter()`

```ts
import { fetchAdapter } from '@lamstack/http-client/adapters/fetch';

const client = new HttpClient({ adapter: fetchAdapter() });

// Inject a replacement (e.g. undici's fetch in older Node, or a test double):
const testClient = new HttpClient({ adapter: fetchAdapter({ fetch: myFetch }) });
```

Wraps global `fetch`. Handles JSON/FormData/Blob/string/ArrayBuffer/typed-array
(`Uint8Array`, `DataView`, ...)/URLSearchParams/`ReadableStream` bodies automatically
(sets `content-type: application/json` only when it has to JSON-stringify a plain
object — never for `FormData`, so multipart uploads keep their browser/Node-generated
boundary). Combines your `signal` with an internal timeout-derived one via
`AbortSignal.any(...)`, which needs **Node 20.3+ or Safari 17.4+** — narrower than this
package's own `engines.node: ">=20"`. Chrome/Firefox/Edge have supported it since 2023;
if you must support Node 20.0–20.2 or an older Safari, polyfill `AbortSignal.any` before
constructing the adapter.

### `axiosAdapter()`

```ts
import axios from 'axios';
import { axiosAdapter } from '@lamstack/http-client/adapters/axios';

const client = new HttpClient({ adapter: axiosAdapter(axios.create({ baseURL: '...' })) });
```

Wraps a caller-supplied `AxiosInstance` as an **opaque transport** — it doesn't matter
whether that instance itself uses XHR, Node's `http`, or axios's own newer
`adapter: 'fetch'` option internally. The adapter disables axios's own JSON
auto-parsing/`validateStatus` (both vary across environments) so behavior stays
identical to the fetch adapter regardless of your axios configuration.

### Writing your own adapter

Anything implementing `HttpAdapter` works — e.g. to target `undici` directly, React
Native's networking stack, or a fully scripted adapter for tests:

```ts
import type { HttpAdapter, HttpRequest, HttpResponse } from '@lamstack/http-client';

function myAdapter(): HttpAdapter {
  return {
    name: 'my-adapter',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest) {
      // ...call your transport, then normalize into an HttpResponse...
      // Any non-2xx outcome (or a network/timeout/cancellation failure) must
      // throw an HttpError — that's the one contract every plugin relies on.
      return {} as HttpResponse<T>;
    },
  };
}
```

## `HttpClient` API

```ts
new HttpClient({
  adapter, // HttpAdapter — required
  baseURL, // string?
  headers, // HeadersInput?
  timeout, // number?
  credentials, // 'omit' | 'same-origin' | 'include'?
  responseType, // ResponseType?
  paramsSerializer, // (params) => string?
  fileSerializer, // FileSerializer? — default WebFileSerializer, see File uploads
});
```

| Method                           | Returns                    | Notes                                                                                                                                                                  |
| -------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use(pluginOrMiddleware)`        | `this`                     | Registers a plugin — chainable                                                                                                                                         |
| `request<T>(init)`               | `Promise<HttpResponse<T>>` | The only method returning the full response, not just `data`                                                                                                           |
| `get<T>(url, init?)`             | `Promise<T>`               |                                                                                                                                                                        |
| `delete<T>(url, init?)`          | `Promise<T>`               |                                                                                                                                                                        |
| `head(url, init?)`               | `Promise<HttpHeaders>`     | Returns the response headers directly                                                                                                                                  |
| `post<T, B>(url, body?, init?)`  | `Promise<T>`               |                                                                                                                                                                        |
| `put<T, B>(url, body?, init?)`   | `Promise<T>`               |                                                                                                                                                                        |
| `patch<T, B>(url, body?, init?)` | `Promise<T>`               |                                                                                                                                                                        |
| `upload<T>(url, data, init?)`    | `Promise<T>`               | `data` is a plain object or an existing `FormData` — see [File uploads](#file-uploads)                                                                                 |
| `download(url, init?)`           | `Promise<Blob>`            | Forces `responseType: 'blob'`                                                                                                                                          |
| `extend(options?)`               | `HttpClient`               | New client, options merged over the parent's, **inheriting the plugins registered so far** (a snapshot — later `.use()` calls on either client don't affect the other) |

`extend()` is what you use to build a `refreshClient` — call it _before_ registering
`auth`/`refresh` on the main client, so the extended client inherits neither and can't
recurse into its own refresh logic:

```ts
const client = new HttpClient({ adapter: fetchAdapter(), baseURL: '/api' });
const refreshClient = client.extend({}); // no plugins yet — safe to use for the refresh call itself
client.use(refresh({ tokenProvider, refreshClient }));
client.use(auth(tokenProvider));
```

## Authentication and token refresh

### The `TokenProvider` contract

`auth` and `refresh` are both built entirely on this interface — your own implementation
has exactly the same capabilities as the two shipped strategies:

```ts
interface TokenProvider {
  getAccessToken(): Awaitable<string | null>;
  saveTokens(payload: unknown): Awaitable<void>;
  clear(): Awaitable<void>;
  canRefresh(): Awaitable<boolean>;
  buildRefreshRequest(): Awaitable<HttpRequestInit>;
  decorate?(request: HttpRequest): HttpRequest; // optional — e.g. set credentials: 'include'
}
```

(`Awaitable<T>` is `T | Promise<T>` — every method may be sync or async.)

### `auth`

```ts
import { auth } from '@lamstack/http-client';

client.use(auth(tokenProvider));
client.use(auth(tokenProvider, { header: 'x-api-key', scheme: '' })); // custom header, no "Bearer " prefix
```

Attaches `Authorization: Bearer <token>` (or your configured header/scheme) to every
request, calling `tokenProvider.decorate?.()` first if defined. Never emits a literal
`"Bearer null"` — if `getAccessToken()` resolves `null`, the header is simply left unset.
Skips itself entirely when `meta.auth === false`.

### `refresh`

```ts
import { refresh, defaultRefreshPolicy } from '@lamstack/http-client';

client.use(
  refresh({
    tokenProvider,
    refreshClient, // see extend() above
    shouldRefresh: defaultRefreshPolicy({
      statuses: [401], // default
      excludePaths: ['/auth/login', '/auth/refresh'], // never trigger a refresh loop on these
    }),
    maxAttempts: 1, // default — one refresh cycle per logical request
    events: httpEvents, // optional HttpEventBus — see below
  }),
);
```

On an eligible failure (401 by default), `refresh`:

1. Calls `tokenProvider.canRefresh()` — if `false`, clears tokens, emits `'unauthorized'`,
   and rethrows the original error immediately.
2. Otherwise calls `tokenProvider.buildRefreshRequest()` and sends it through
   `refreshClient`, then `tokenProvider.saveTokens(response.data)`.
3. Retries the original request via a **re-entrant `next()` call** — never by re-running
   the pipeline from the top, so anything registered outside `refresh` never re-runs.
4. If the refresh call itself fails: clears tokens, emits `'token:refresh-failed'` and
   `'unauthorized'`, and rethrows the **original** request's error with the refresh
   failure attached via `.cause`.

**Concurrency:** if several requests fail at once while a refresh is already in flight,
they share that one refresh call (no duplicate refresh requests) — but each still
resolves or rejects independently. If the shared refresh fails, every queued request
rejects with **its own** original error (not one shared value), each carrying the same
refresh failure via `.cause`.

### Built-in token providers

**`LocalStorageTokenProvider`** — for backends that return `accessToken`/`refreshToken`
in the JSON response body:

```ts
import { LocalStorageTokenProvider } from '@lamstack/http-client';

const tokenProvider = new LocalStorageTokenProvider({
  store: window.localStorage, // anything with getItem/setItem/removeItem — see Storage below
  refreshUrl: '/auth/refresh',
  accessTokenKey: 'access_token', // default
  refreshTokenKey: 'refresh_token', // default
  // parser?: defaults to reading { accessToken }, { data: { accessToken } }, or { access_token }
});
```

**`CookieHttpOnlyTokenProvider`** — for backends that issue the refresh token as an
HttpOnly cookie the browser sends automatically. The access token lives in memory only
(never persisted); `canRefresh()` can't verify the cookie exists (JS can't read an
HttpOnly cookie) so it trusts a `SIGNED_IN` flag in `store` instead, letting the backend
reject the refresh call if the cookie is actually gone:

```ts
import { CookieHttpOnlyTokenProvider } from '@lamstack/http-client';

const tokenProvider = new CookieHttpOnlyTokenProvider({
  store: window.localStorage, // only stores the sign-in flag, never a token
  refreshUrl: '/auth/refresh',
});
```

Both accept any `Storage`-shaped object:

```ts
interface Storage {
  getItem(key: string): Awaitable<string | null>;
  setItem(key: string, value: string): Awaitable<void>;
  removeItem(key: string): Awaitable<void>;
}
```

— `localStorage`, React Native's `AsyncStorage`, or a plain `Map` wrapper all qualify.

### Writing your own `TokenProvider`

Nothing above is special-cased — a third strategy (e.g. a multi-tenant token store, or
one backed by a secure OS keychain) implements the same six methods and works with
`auth`/`refresh` exactly the same way.

## Session events (`HttpEventBus`)

A typed pub/sub for session-level state — deliberately separate from the request
pipeline, since these describe the _session_, not any one request:

```ts
import { HttpEventBus } from '@lamstack/http-client';

const httpEvents = new HttpEventBus();

const unsubscribe = httpEvents.on('unauthorized', ({ error }) => {
  redirectToLogin();
});
// later: unsubscribe();

httpEvents.on('token:refreshed', () => console.log('session renewed'));
httpEvents.on('token:refresh-failed', ({ error }) => reportToSentry(error));

client.use(refresh({ tokenProvider, refreshClient, events: httpEvents }));
```

`HttpEventBus` is **not a singleton** — create one per app (or per independent set of
clients that should share session state) and pass it explicitly; nothing here reaches
across unrelated `HttpClient` instances implicitly. `on()` returns an unsubscribe
function, which composes naturally with a React `useEffect` cleanup. A throwing listener
never prevents its siblings from running.

| Event                  | Payload                | Fires                                                                                                                         |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`         | `{ error: HttpError }` | Once per request that can't refresh (`canRefresh()` false), and once per failed refresh cycle (never once per queued request) |
| `token:refreshed`      | `{}`                   | Once per successful refresh cycle                                                                                             |
| `token:refresh-failed` | `{ error: unknown }`   | Once per failed refresh cycle, before `unauthorized`                                                                          |

## Error handling

Every adapter throws an `HttpError` for any non-2xx response, network failure, timeout,
or cancellation — never a raw transport-specific error:

```ts
class HttpError<T = unknown> extends Error {
  code: 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELED' | 'PARSE_ERROR';
  status: number; // 0 when there is no HTTP response at all
  data?: T; // the parsed error response body, when there is one
  request: HttpRequest;
  response?: HttpResponse<T>;
  cause?: unknown;
  get isNetworkError(): boolean; // status === 0
  get isCanceled(): boolean; // code === 'CANCELED'
  static is(error: unknown): error is HttpError;
  static from(error: unknown, request: HttpRequest): HttpError; // wraps anything else, passes an existing HttpError through unchanged
}
```

```ts
try {
  await client.get('/x');
} catch (error) {
  if (HttpError.is(error)) {
    console.log(error.status, error.code, error.data);
  }
}
```

`errorMapper` reshapes an `HttpError` into your own domain error type, registered
_outside_ `refresh`/`auth` (`PluginOrder.normalize`) so `refresh` always sees the raw
`HttpError` — only errors that survive a refresh retry ever reach the mapper:

```ts
import { errorMapper, HttpError } from '@lamstack/http-client';

class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super('Validation failed');
  }
}

client.use(
  errorMapper((error) => (error.status === 422 ? new ValidationError(error.data as never) : error)),
);

await client.get('/x', { meta: { mapError: false } }); // opt this one request out
```

## File uploads

```ts
await client.upload('/files', {
  title: 'Vacation photo',
  taken: new Date(), // -> ISO string
  tags: ['beach', 'sun'], // -> repeated form field
  metadata: { camera: 'Pixel' }, // -> JSON-stringified
  avatar: someFile, // File/Blob -> handled by the configured FileSerializer
});
```

An existing `FormData` is sent through untouched instead of being rebuilt. `upload()`
never sets an explicit `Content-Type` — the adapter's transport generates the multipart
boundary itself.

By default, non-primitive values are handled by `WebFileSerializer` (`File`/`Blob`). For
React Native (no `File`/`Blob`; a `FormData` polyfill that expects
`{ uri, type?, name? }` objects instead), pass `NativeFileSerializer`:

```ts
import { NativeFileSerializer } from '@lamstack/http-client';

const client = new HttpClient({
  adapter: fetchAdapter(),
  fileSerializer: new NativeFileSerializer(),
});

await client.upload('/files', { avatar: { uri: 'file://photo.jpg' } });
```

Write your own by implementing `FileSerializer` (`accepts(value)` / `serialize(formData, key, value)`)
for anything else — e.g. a `Buffer`-based Node upload path.

## Downloads

```ts
const report = await client.download('/report.pdf'); // Blob
```

Equivalent to `client.get(url, { responseType: 'blob' })`, exposed as its own method for
clarity at the call site.

## Cancellation

`AbortSignal` is already first-class on every request (`HttpRequestInit.signal`), so
cancellation isn't a special `HttpClient` method — `cancelable()` is a small standalone
helper for the common "start a request, get a way to cancel it" shape:

```ts
import { cancelable } from '@lamstack/http-client';

const { promise, cancel } = cancelable((signal) => client.get('/slow', { signal }));

cancel(); // rejects `promise` with an HttpError whose code is 'CANCELED'
```

## Writing your own plugin

`auth`, `refresh`, and `errorMapper` are not privileged — they're written against the
exact same `Middleware`/`HttpPlugin` contract available to you. For example, a plugin
that attaches a client-id header (the kind of extensibility a future SSE plugin would
build on, without needing any change to core):

```ts
import type { HttpPlugin } from '@lamstack/http-client';

function clientIdPlugin(clientId: string): HttpPlugin {
  return {
    name: 'client-id',
    order: 50, // between refresh and auth — see PluginOrder
    handler: async (request, next) => {
      return next({ ...request, headers: { ...request.headers, 'x-client-id': clientId } });
    },
  };
}

client.use(clientIdPlugin('abc123'));
```

A retry-style plugin that inspects the response _after_ `next()` resolves/rejects:

```ts
function loggingPlugin(): HttpPlugin {
  return {
    name: 'logging',
    order: PluginOrder.observe,
    handler: async (request, next) => {
      const start = Date.now();
      try {
        const response = await next(request);
        console.log(request.method, request.url, response.status, `${Date.now() - start}ms`);
        return response;
      } catch (error) {
        console.log(request.method, request.url, 'failed', `${Date.now() - start}ms`);
        throw error;
      }
    },
  };
}
```

Remember `next()` is re-entrant (see [The middleware pipeline](#the-middleware-pipeline))
— a plugin that retries by calling `next()` again only re-runs middleware registered
_after_ itself, which is exactly what makes that safe to do from inside `.use()`.

## Testing code that uses this package

Because `HttpAdapter` is a tiny two-property interface, testing code that uses
`HttpClient` doesn't require mocking `fetch` or `axios` — write a scripted adapter:

```ts
import type { HttpAdapter, HttpRequest, HttpResponse } from '@lamstack/http-client';

function scriptedAdapter(response: Partial<HttpResponse>): HttpAdapter {
  return {
    name: 'scripted',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        request,
        ...response,
      } as HttpResponse<T>;
    },
  };
}

const client = new HttpClient({ adapter: scriptedAdapter({ data: { id: '1' } }) });
```

This is the same pattern this package's own test suite uses throughout — see
`src/plugins/refresh.plugin.test.ts` for scripted-adapter and concurrency-testing
examples (the `deferred()`-promise pattern for controlling exactly when an in-flight
request settles).

## TypeScript

Every public type is exported from the package root (`HttpRequest`, `HttpResponse`,
`HttpPlugin`, `TokenProvider`, ...). Generic type parameters flow through the whole
chain: `client.get<User>('/me')` types the resolved value; `client.request<User>(init)`
types `response.data`; `client.post<CreatedUser, CreateUserInput>('/users', input)` types
both the body and the result.

## Roadmap

Not yet implemented — see [SPEC.md §11](./SPEC.md#11-deferred-to-v11-explicitly-not-built-now)
for the full rationale:

- **`retryPlugin`** — backoff/jitter, `Retry-After` support, method-safety rules (no
  automatic retry of non-idempotent requests). `PluginOrder.retry` is already reserved.
- **Upload/download progress** (`onUploadProgress`/`onDownloadProgress`) — both adapters
  currently report `capabilities: { uploadProgress: false, downloadProgress: false, stream: false }`
  honestly; this is where that flips to `true`.
- **An SSE plugin** — the plugin system is already extensible enough for one (see
  [Writing your own plugin](#writing-your-own-plugin)); it just doesn't ship yet.

## Credits

This package generalizes a production `HttpClient` implementation (axios-only) from an
internal dashboard into an adapter-agnostic, publicly reusable one — see
[SPEC.md §5](./SPEC.md#5-ported-behavior-parity-checklist-against-omnicomdashboardsrclibhttp-client)
for the full parity checklist against that original implementation, including the two
deliberate behavior improvements made along the way (per-request error identity on a
failed shared refresh, and `extend()` replacing a manually-constructed second client).

## License

MIT
