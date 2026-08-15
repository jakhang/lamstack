# @lamstack/http-client

A framework-agnostic HTTP client core built around a pluggable, Koa/onion-style
middleware pipeline. The core has **zero runtime dependency on axios or fetch** — you
choose a transport adapter (`fetch` or `axios`, both included) and layer behavior
(credential attachment, failure recovery, error mapping, or anything you write yourself)
on top via a single `.use()` API. No plugin shipped with this package — not `auth`, not
`recover` — has any capability you don't also have.

> **Pre-1.0** (`0.x`): the API may still change between minor versions. `retryPlugin` and
> upload/download progress are architected for (see [`PluginOrder`](#pluginorder) and
> `HttpAdapter.capabilities`) but not implemented yet — see [Roadmap](#roadmap) for
> what's coming next.

## Table of contents

- [@lamstack/http-client](#lamstackhttp-client)
  - [Table of contents](#table-of-contents)
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
  - [Authentication and recovery](#authentication-and-recovery)
    - [`auth` and `Authenticator`](#auth-and-authenticator)
    - [Built-in authenticators](#built-in-authenticators)
    - [`recover`](#recover)
    - [Wiring `auth` + `recover` to a token store](#wiring-auth--recover-to-a-token-store)
    - [Recovery events (`EventBus`)](#recovery-events-eventbus)
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

Most HTTP client wrappers pick a transport (axios, or `fetch`) and bolt auth/recovery
logic onto it via that transport's own interceptor system. That logic then can't move to
a different transport, and typically can't be unit-tested without mocking the transport
itself. This package inverts that: the pipeline (auth, recovery, error mapping, retry
policy, anything else) is transport-agnostic middleware; adapters are a thin,
interchangeable translation layer between that pipeline and a real transport. The same
`auth`/`recover` setup works identically whether the underlying adapter is `fetch` or an
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

`client.use()` accepts either a bare `Middleware` function (defaults to
`PluginOrder.normalize`) or a full `HttpPlugin` object. Plugins run in `order` order —
ties preserve registration order.

**`next()` is re-entrant.** A middleware may call it more than once; each call re-runs
only the chain _after_ that middleware, never anything that already ran. This is what
lets `recover` retry a request after recovering credentials without re-running whatever
is registered outside it (logging, tracing, ...):

```text
register order:  observe(-200)  →  recover(0)  →  auth(100)  →  transport (adapter)

401 on first attempt:
  observe runs (once) → recover runs → auth runs → transport throws 401
                              ↓
                         recover catches it, runs its recover() callback,
                         calls next() AGAIN — only auth + transport re-run:
                              ↓
                         auth runs (2nd time, fresh credential) → transport → 200
```

### `PluginOrder`

```ts
export const PluginOrder = {
  observe: -200,
  normalize: -100,
  recover: 0,
  retry: 50, // reserved for v1.1's retryPlugin — nothing uses this slot yet
  auth: 100,
  transport: 200,
} as const;
```

These are public, semver-stable ordering slots — `errorMapper` registers at `normalize`,
`recover` at `recover`, `auth` at `auth`. A plain `client.use(fn)` (not wrapped in an
`HttpPlugin`) defaults to `PluginOrder.normalize` too — deliberately not `recover`'s slot,
so it never silently interleaves with recovery retries purely by registration order.
Write your own plugins against these constants (e.g. `PluginOrder.auth - 1` to run just
inside auth) instead of hardcoded numbers.

### `meta` flags

Every resolved `HttpRequest` carries a `meta` bag. `auth`, `recover`, and `errorMapper`
each read one flag off it automatically, via a shared `metaOptOut(key)` helper — a request
opts a plugin out by setting that flag to exactly `false`:

```ts
await client.get('/x', { meta: { auth: false } }); // auth() skips this request
await client.get('/x', { meta: { recover: false } }); // recover() skips this request
await client.get('/x', { meta: { mapError: false } }); // errorMapper leaves the error as-is
```

`metaOptOut('auth')` is `(request) => request.meta.auth === false` — strict equality, so
`undefined`/`0`/`''`/`null` never opt a request out, only a literal `false` does.

Each plugin also takes its own `options.skip?: (request) => boolean`, which **replaces**
the default check entirely rather than adding to it. To keep the default and add your own
condition, compose them yourself:

```ts
import { metaOptOut } from '@lamstack/http-client';

client.use(
  auth(bearer(source), {
    skip: (request) => metaOptOut('auth')(request) || request.url.startsWith('/public'),
  }),
);
```

For `recover` specifically, `skip` is independent of `shouldRecover` and is checked
first, as soon as an error is caught — before `shouldRecover` ever runs. That's
deliberate: if the opt-out were folded into `shouldRecover`'s default instead, overriding
`shouldRecover` would silently lose the opt-out. `shouldRecover` keeps its own
`onStatus(401)` default no matter what `skip` does.

`meta` is also where you can stash your own per-request data for a custom plugin to
read. Internal plugin state (like `recover`'s attempt/generation counters) uses a
`Symbol.for(...)` key instead of a string, specifically so it can never collide with
anything you put here.

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

`extend()` is what you use to build a client for `recover()`'s own callback to call the
refresh endpoint with — call it _before_ registering `auth`/`recover` on the main client,
so the extended client inherits neither and can't recurse into its own recovery logic:

```ts
const client = new HttpClient({ adapter: fetchAdapter(), baseURL: '/api' });
const refreshClient = client.extend({}); // no plugins yet — safe to use for the refresh call itself

client.use(
  recover({
    recover: () => session.renew(), // session: your own renew/getAccessToken object — see below
  }),
);
client.use(auth(bearer(session)));
```

Every field on `extend()`'s options falls back to the parent's via `??`, so passing a
field as explicit `undefined` doesn't unset it, and passing `headers` replaces the
parent's wholesale rather than merging with them (unlike a per-request `headers`
override, which layers on top).

## Authentication and recovery

Two independent, narrow contracts do the work: **`auth`** attaches credentials to every
request; **`recover`** detects an eligible failure, runs a recovery step, and retries.
Neither knows anything about the other, and neither is privileged over a plugin you
write yourself. [Wiring `auth` + `recover` to a token store](#wiring-auth--recover-to-a-token-store)
(below) shows how to tie the two together around a stored token — there's no built-in
session helper yet (see [Roadmap](#roadmap)), so that's a plain object you write.

### `auth` and `Authenticator`

```ts
import { auth } from '@lamstack/http-client';

type Authenticator = (request: HttpRequest) => Awaitable<HttpRequest>;

client.use(auth(myAuthenticator));
client.use(auth(myAuthenticator, { skip: (request) => request.url.startsWith('/public') }));
```

`auth()` is deliberately thin: it applies an `Authenticator` — any
`(request) => Awaitable<HttpRequest>` — to every outgoing request, with an optional
`skip` predicate for requests that shouldn't be authenticated at all. Everything about
_how_ (a Bearer token, an API key, a request signature, several combined) lives in the
`Authenticator` itself, not in the plugin.

### Built-in authenticators

```ts
import { allOf, apiKey, basic, bearer } from '@lamstack/http-client';

// The common case — a Bearer token from any source with getAccessToken():
client.use(auth(bearer(session))); // session: your own getAccessToken object — see below
client.use(auth(bearer(session, { header: 'x-api-key', scheme: '' }))); // custom header, no "Bearer " prefix
client.use(auth(bearer(() => currentToken))); // or a plain function

// A static or dynamically-resolved API key, as a header or a query parameter:
client.use(auth(apiKey({ in: 'header', name: 'x-api-key', value: process.env.API_KEY! })));
client.use(auth(apiKey({ in: 'query', name: 'key', value: async () => rotateKey() })));

// HTTP Basic auth:
client.use(auth(basic(username, password)));

// Compose several — e.g. a bearer token plus a request signature:
client.use(
  auth(
    allOf(bearer(session), async (request) => ({
      ...request,
      headers: { ...request.headers, 'x-signature': await sign(request) },
    })),
  ),
);
```

`bearer()` never emits a literal `"Bearer null"` — if its source resolves `null`/no
token, the header is simply left unset. `bearer()`'s source contract is just
`{ getAccessToken(): Awaitable<string | null> }` (or a plain function) — the session
object shown below satisfies it directly, and so does anything else with a
`getAccessToken()` method.

### `recover`

```ts
import { metaOptOut, onStatus, recover } from '@lamstack/http-client';

client.use(
  recover({
    recover: () => session.renew(), // session: your own renew/getAccessToken object — see below
    shouldRecover: onStatus(401, { exclude: ['/auth/login', '/auth/refresh'] }), // default: onStatus(401)
    skip: metaOptOut('recover'), // default — see meta flags above
    canRecover: () => session.canRenew(), // optional — skips a doomed cycle before it starts
    maxAttempts: 1, // default — one recovery cycle per logical request
    maxStaleRetries: 1, // default — see "Stale retries" below; independent of maxAttempts
    cooldownMs: 1000, // default — see "Refresh storms" below; 0 disables it
    events: recoveryEvents, // optional EventBus<RecoveryEventMap> — see below
  }),
);
```

`recover`'s only required option is `recover: () => Promise<void>` — a single async step
run once per cycle, shared by every request queued behind it. It doesn't have to be an
HTTP call: `firebaseUser.getIdToken(true)`, an OS keychain refresh, or a resync over a
`BroadcastChannel` all fit the same shape.

`skip` is checked first, as soon as an error is caught — before `shouldRecover` runs, and
independent of it (see [meta flags](#meta-flags) above for why the two are kept separate).

On an eligible failure (401 by default, via `shouldRecover`, once `skip` has let it through):

1. If `canRecover` is given and resolves `false`, emits `recovery:unavailable` and
   rethrows the original error immediately — no cycle attempted.
2. Otherwise runs `recover()` (deduplicated — see Concurrency below).
3. Retries the original request via a **re-entrant `next()` call** — never by re-running
   the pipeline from the top, so anything registered outside `recover` (including `auth`,
   which re-runs and picks up the new credential) never re-runs from scratch.
4. If `recover()` itself throws: emits `recovery:failed`, and rethrows the **original**
   request's error with the recovery failure attached via `.cause`.

`recover()` calls no cleanup itself on failure — wire that yourself via events (below),
e.g. `events.on('recovery:failed', () => session.end())`.

**Refresh storms:** without a cooldown, every request that fails while the refresh
endpoint itself is down would trigger its own brand-new cycle against that same down
endpoint, with no ceiling. `cooldownMs` (default `1000`; `0` disables it) closes that gap:
once a cycle fails, any request that would otherwise start a fresh one within `cooldownMs`
instead throws its own original error immediately — `.cause` set to the most recent
recovery failure — and emits `recovery:unavailable`, with no attempt against the refresh
endpoint at all. A successful cycle resets the cooldown immediately, so it never blocks a
request that comes in right after a working recovery.

**Concurrency:** if several requests fail at once while a cycle is already in flight,
they share that one cycle (no duplicate recovery calls) — but each still resolves or
rejects independently. If the shared cycle fails, every queued request rejects with
**its own** original error (not one shared value), each carrying the same recovery
failure via `.cause`. A request that fails _after_ a **different** request's cycle
already completed and rotated the credential retries directly with it instead of
starting a redundant cycle — tracked via an internal generation counter, no configuration
needed.

**Stale retries:** that direct retry (above) is tracked by its own counter, capped by
`maxStaleRetries` (default `1`) — completely independent of `maxAttempts`. A request that
gets stale-retried once never spends its `maxAttempts` budget, so if its retry then hits a
genuine, unrelated 401, it can still start its own recovery cycle. Only _repeated_
staleness — losing the race to unrelated rotations over and over — is what
`maxStaleRetries` eventually gives up on, throwing the original error with no new cycle
attempted.

### Wiring `auth` + `recover` to a token store

There's no built-in session helper in `0.1.0` — a first attempt shipped briefly during
development and was pulled before release to be redesigned (see [Roadmap](#roadmap)).
Until then, `auth`/`recover` need nothing more than a plain object of your own that
satisfies `bearer()`'s source contract — `{ getAccessToken(): Awaitable<string | null> }`
— plus whatever `renew`/`canRenew` shape `recover()`'s options need:

**Backends that return `accessToken`/`refreshToken` in the JSON response body** — the
refresh token is persisted in `localStorage` and sent back as `{ refreshToken }`:

```ts
function parseAccessToken(payload: unknown): string | null {
  return (payload as { accessToken?: string } | null)?.accessToken ?? null;
}

let accessToken: string | null = window.localStorage.getItem('access_token');

const session = {
  getAccessToken: async () => accessToken,
  canRenew: async () => Boolean(window.localStorage.getItem('refresh_token')),
  renew: async () => {
    const refreshToken = window.localStorage.getItem('refresh_token');
    const response = await refreshClient.request({
      url: '/auth/refresh',
      method: 'POST',
      body: { refreshToken },
    });
    accessToken = parseAccessToken(response.data);
    if (accessToken) window.localStorage.setItem('access_token', accessToken);
  },
  end: async () => {
    accessToken = null;
    window.localStorage.removeItem('access_token');
    window.localStorage.removeItem('refresh_token');
  },
};

// After a successful sign-in response elsewhere in the app:
accessToken = parseAccessToken(signInResponse);
if (accessToken) window.localStorage.setItem('access_token', accessToken);

client.use(recover({ recover: () => session.renew(), canRecover: () => session.canRenew() }));
client.use(auth(bearer(session)));
```

**Backends that issue the refresh token as an HttpOnly cookie** the browser sends
automatically — the access token is kept in memory only (never persisted, to limit XSS
exposure):

```ts
let accessToken: string | null = null;

const session = {
  getAccessToken: async () => accessToken,
  canRenew: async () => Boolean(window.localStorage.getItem('SIGNED_IN')),
  renew: async () => {
    const response = await refreshClient.request({
      url: '/auth/refresh',
      method: 'GET',
      credentials: 'include',
    });
    window.localStorage.setItem('SIGNED_IN', 'true');
    accessToken = parseAccessToken(response.data); // kept in memory only, never persisted
  },
  end: async () => {
    accessToken = null;
    window.localStorage.removeItem('SIGNED_IN');
  },
};

// auth() doesn't set credentials: 'include' automatically — declare it on the client itself:
const client = new HttpClient({ adapter: fetchAdapter(), credentials: 'include' });
client.use(recover({ recover: () => session.renew(), canRecover: () => session.canRenew() }));
client.use(auth(bearer(session)));
```

Both examples build `refreshClient` via `client.extend({})` (see [`HttpClient` API](#httpclient-api)
above) so the refresh call itself carries neither `auth` nor `recover`. Neither
`renew`/`canRenew`/`end` is special-cased by the plugins — `recover()` only ever calls
`session.renew()`/`session.canRenew()` because that's what you passed as its
`recover`/`canRecover` options; `end()` isn't called automatically on a failed recovery
cycle either, wire it through `recoveryEvents` yourself, e.g.
`events.on('recovery:failed', () => session.end())`. A multi-tenant token store, one
backed by a secure OS keychain, or Firebase's `getIdToken` all work the same way — just a
different `getAccessToken`/`renew`/`canRenew` implementation behind the same shape.

### Recovery events (`EventBus`)

A generic typed pub/sub, not specific to auth — `recover()` defines its own event map on
top of it:

```ts
import { EventBus } from '@lamstack/http-client';
import type { RecoveryEventMap } from '@lamstack/http-client';

const recoveryEvents = new EventBus<RecoveryEventMap>();

const unsubscribe = recoveryEvents.on('recovery:failed', ({ error }) => {
  session.end();
  redirectToLogin();
});
// later: unsubscribe();

recoveryEvents.on('recovery:succeeded', () => console.log('session renewed'));
recoveryEvents.on('recovery:unavailable', ({ error }) => reportToSentry(error));

client.use(recover({ recover: renewSession, events: recoveryEvents }));
```

`EventBus` is **not a singleton** — create one per app (or per independent set of
clients that should share recovery state) and pass it explicitly; nothing here reaches
across unrelated `HttpClient` instances implicitly. `on()` returns an unsubscribe
function, which composes naturally with a React `useEffect` cleanup. A throwing listener
never prevents its siblings from running.

| Event                  | Payload                | Fires                                                                                                                    |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `recovery:succeeded`   | `{}`                   | Once per successful recovery cycle, never once per queued request                                                        |
| `recovery:failed`      | `{ error: unknown }`   | Once per failed recovery cycle                                                                                           |
| `recovery:unavailable` | `{ error: HttpError }` | Once per request whose `canRecover()` check failed, or that hit an active `cooldownMs` window — recovery never attempted |

## Error handling

Every adapter throws an `HttpError` for any non-2xx response, network failure, timeout,
or cancellation — never a raw transport-specific error:

```ts
class HttpError<T = unknown> extends Error {
  code: 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELED' | 'PARSE_ERROR' | 'UNKNOWN';
  status: number; // 0 when there is no HTTP response at all
  data?: T; // the parsed error response body, when there is one
  request: HttpRequest;
  response?: HttpResponse<T>;
  cause?: unknown; // non-enumerable, matching native Error.cause
  get isNetworkError(): boolean; // code === 'NETWORK_ERROR'
  get isCanceled(): boolean; // code === 'CANCELED'
  static is(error: unknown): error is HttpError;
  static from(error: unknown, request: HttpRequest): HttpError; // wraps anything else, passes an existing HttpError through unchanged
}
```

`HttpError.from()`'s fallback is `'UNKNOWN'`, not `'NETWORK_ERROR'` — it's used by
`recover()`/`errorMapper()` on anything they catch that isn't already an `HttpError`,
which normally only happens for a bug in a plugin between them and the adapter. Claiming
`NETWORK_ERROR` for that would make `isNetworkError` lie and could get a real bug
silently retried by `recover()`.

```ts
try {
  await client.get('/x');
} catch (error) {
  if (HttpError.is(error)) {
    console.log(error.status, error.code, error.data);
  }
}
```

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

`auth`, `recover`, and `errorMapper` are not privileged — they're written against the
exact same `Middleware`/`HttpPlugin` contract available to you. For example, a plugin
that attaches a client-id header (the kind of extensibility a future SSE plugin would
build on, without needing any change to core):

```ts
import { withHeaders } from '@lamstack/http-client';
import type { HttpPlugin } from '@lamstack/http-client';

function clientIdPlugin(clientId: string): HttpPlugin {
  return {
    name: 'client-id',
    order: 50, // between recover and auth — see PluginOrder
    handler: async (request, next) => {
      return next(withHeaders(request, { 'x-client-id': clientId }));
    },
  };
}

client.use(clientIdPlugin('abc123'));
```

Never build the header object by hand (`{ ...request.headers, 'X-Client-Id': ... }`) —
`withHeaders` normalizes the key the same way `resolve()` does, so a header that differs
only in case from one already on the request overwrites it instead of adding a duplicate.
`withMeta(request, meta)` does the equivalent for `meta`, preserving both `string` and
`Symbol.for(...)` keys already on the request. Both are pure — they return a new request,
never mutate the one you pass in.

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
`src/plugins/recover.plugin.test.ts` for scripted-adapter and concurrency-testing
examples (the `deferred()`-promise pattern for controlling exactly when an in-flight
request settles).

## TypeScript

Every public type is exported from the package root (`HttpRequest`, `HttpResponse`,
`HttpPlugin`, `Authenticator`, `RecoveryContext`, ...). Generic type
parameters flow through the whole chain: `client.get<User>('/me')` types the resolved
value; `client.request<User>(init)` types `response.data`;
`client.post<CreatedUser, CreateUserInput>('/users', input)` types both the body and the
result.

## Roadmap

Not yet implemented:

- **`retryPlugin`** — backoff/jitter, `Retry-After` support, method-safety rules (no
  automatic retry of non-idempotent requests). `PluginOrder.retry` is already reserved.
- **Upload/download progress** (`onUploadProgress`/`onDownloadProgress`) — both adapters
  currently report `capabilities: { uploadProgress: false, downloadProgress: false, stream: false }`
  honestly; this is where that flips to `true`.
- **An SSE plugin** — the plugin system is already extensible enough for one (see
  [Writing your own plugin](#writing-your-own-plugin)); it just doesn't ship yet.
- **A session-layer helper** (`0.2.0`) — a built-in primitive tying a stored token to
  both `auth()` and `recover()`, so the [hand-written session objects above](#wiring-auth--recover-to-a-token-store)
  aren't the only option. An earlier version of this shipped briefly during `0.1.0`
  development and was pulled before release to be redesigned rather than carried forward
  as-is.

## Credits

This package generalizes a production `HttpClient` implementation (axios-only) from an
internal dashboard into an adapter-agnostic, publicly reusable one, keeping full behavior
parity with the original (`HttpClient`'s verb methods, request/response interceptors, its
token storage/refresh strategy, `FormBuilder`/`FileSerializer`, `createCancelable`) while
making three deliberate improvements along the way:

- **Per-request error identity on a failed shared recovery cycle** — every request
  queued behind an in-flight `recover()` cycle rejects with its own original error (the
  recovery failure attached via `.cause`), not one shared rejection value across all of
  them.
- **`extend()`** replaces a manually-constructed second client for talking to the refresh
  endpoint without recursing into its own recovery logic.
- **The `Authenticator`/`recover()` split** — the original's monolithic token-provider
  interface is now two narrow, independent contracts (see
  [Authentication and recovery](#authentication-and-recovery)), so credential attachment
  and failure recovery are useful — and testable — on their own.

## License

MIT
