# @lamstack/http-client

Framework-agnostic HTTP client core with a pluggable, Koa/onion-style middleware
pipeline — the core has **zero dependency on axios or fetch**. `fetch` and `axios`
adapters ship as separate subpath exports, so importing the package root never pulls
either one in. Auth and token-refresh (`auth`, `refresh` below) are built entirely on the
same public plugin API available to you — see [Writing your own plugin](#writing-your-own-plugin).

> **Pre-1.0** (`0.x`): the API may still change between minor versions. `retryPlugin` and
> upload/download progress are architected for but not implemented yet — see
> [SPEC.md §11](./SPEC.md#11-deferred-to-v11-explicitly-not-built-now).

## Install

```bash
pnpm add @lamstack/http-client
```

## Usage

```ts
import { HttpClient } from '@lamstack/http-client';
import { fetchAdapter } from '@lamstack/http-client/adapters/fetch';

const client = new HttpClient({ adapter: fetchAdapter(), baseURL: 'https://api.example.com' });

interface User {
  id: string;
  name: string;
}

const user = await client.get<User>('/me');
await client.post('/users', { name: 'Ada' });
```

Or with an existing axios instance instead — nothing else in your code changes, since
both adapters implement the same contract:

```ts
import axios from 'axios';
import { HttpClient } from '@lamstack/http-client';
import { axiosAdapter } from '@lamstack/http-client/adapters/axios';

const client = new HttpClient({ adapter: axiosAdapter(axios.create()) });
```

`get`/`post`/`put`/`patch`/`delete` return the parsed response body directly.
`client.request(init)` returns the full `HttpResponse` (`status`/`headers`/`data`/...)
when you need more than the body. `head()` returns just the response headers.

## Auth + token refresh

```ts
import { HttpClient, auth, refresh, LocalStorageTokenProvider } from '@lamstack/http-client';
import { fetchAdapter } from '@lamstack/http-client/adapters/fetch';

const tokenProvider = new LocalStorageTokenProvider({
  store: window.localStorage,
  refreshUrl: '/auth/refresh',
});

const client = new HttpClient({ adapter: fetchAdapter(), baseURL: '/api' });

// Built before auth/refresh are registered below, so it inherits neither —
// calling the refresh endpoint through it can never recurse into another refresh.
const refreshClient = client.extend({});

client.use(refresh({ tokenProvider, refreshClient }));
client.use(auth(tokenProvider));

const me = await client.get('/me'); // a 401 here is retried once, transparently, after a refresh
```

Two token strategies ship out of the box:

- **`LocalStorageTokenProvider`** — for backends that return `accessToken`/`refreshToken`
  in the JSON response body. Works with any `Storage`-shaped object (`localStorage`,
  `AsyncStorage`, an in-memory `Map` wrapper, ...).
- **`CookieHttpOnlyTokenProvider`** — for backends that issue the refresh token as an
  HttpOnly cookie the browser sends automatically. The access token lives in memory only.

Concurrent requests that all hit a 401 while a refresh is already in flight share that
one refresh call — see `TokenProvider` in [SPEC.md](./SPEC.md#5-ported-behavior-parity-checklist-against-omnireactcom-dashboardsrclibhttp-client)
for the full contract if you want to write your own strategy.

## Writing your own plugin

`auth`, `refresh`, and `errorMapper` hold no capability you don't also have — they're
built on the exact same `Middleware`/`HttpPlugin` contract. For example, a plugin that
attaches a client-id header (the extensibility an SSE plugin would eventually build on):

```ts
import type { HttpPlugin } from '@lamstack/http-client';

function clientIdPlugin(clientId: string): HttpPlugin {
  return {
    name: 'client-id',
    order: 50,
    handler: async (request, next) => {
      return next({ ...request, headers: { ...request.headers, 'x-client-id': clientId } });
    },
  };
}

client.use(clientIdPlugin('abc123'));
```

`next()` is re-entrant: a middleware may call it more than once (e.g. to retry after
refreshing a token) — each call re-runs only the *inner* chain, never middleware that
already ran. `order` controls where a plugin sits in the pipeline; see the exported
`PluginOrder` constants (`observe`, `normalize`, `refresh`, `auth`, `transport`) for the
built-in layout.

## Upload, download, cancelation

```ts
await client.upload('/files', { name: 'a', avatar: someFile }); // plain object -> FormData
const report = await client.download('/report.pdf'); // Blob

import { cancelable } from '@lamstack/http-client';

const { promise, cancel } = cancelable((signal) => client.get('/slow', { signal }));
cancel(); // aborts the in-flight request
```

## Error handling

Every adapter rejects with an `HttpError` (`status`/`code`/`data`/`.cause`) — never a raw
transport error. `errorMapper` reshapes it into your own domain errors:

```ts
import { HttpError, errorMapper } from '@lamstack/http-client';

client.use(errorMapper((error) => (error.status === 404 ? new Error('Not found') : error)));

try {
  await client.get('/x');
} catch (error) {
  if (HttpError.is(error)) console.log(error.status, error.code);
}
```

Skip a specific request with `meta: { mapError: false }` (or `{ auth: false }` /
`{ refresh: false }` for the other two built-in plugins).

## License

MIT
