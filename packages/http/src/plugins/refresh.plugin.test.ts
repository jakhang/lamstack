import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import { HttpEventBus } from '../core/http-event-bus';
import { PluginOrder } from '../core/types';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { auth } from './auth.plugin';
import { refresh } from './refresh.plugin';
import { defaultRefreshPolicy } from './token-provider';
import type { TokenProvider } from './token-provider';

function stubProvider(overrides: Partial<TokenProvider> = {}): TokenProvider {
  return {
    getAccessToken: async () => 'old-token',
    saveTokens: async () => {},
    clear: async () => {},
    canRefresh: async () => true,
    buildRefreshRequest: async () => ({ url: '/refresh', method: 'POST' }),
    ...overrides,
  };
}

/** An adapter driven by a script — `unauthorized` throws a 401 HttpError, anything else is the response body. */
function scriptedAdapter(script: Array<'unauthorized' | Record<string, unknown>>): {
  adapter: HttpAdapter;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  let index = 0;
  const adapter: HttpAdapter = {
    name: 'scripted',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      calls.push(request);
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      if (step === 'unauthorized') {
        throw new HttpError('Unauthorized', { code: 'HTTP_ERROR', status: 401, request });
      }
      return { status: 200, statusText: 'OK', headers: {}, request, data: step as T };
    },
  };
  return { adapter, calls };
}

describe('refresh — single refresh-and-retry', () => {
  it('refreshes once on 401 and retries the original request, resolving with the retried response', async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const saveTokens = vi.fn(async () => {});
    const events = new HttpEventBus();
    const onTokenRefreshed = vi.fn();
    events.on('token:refreshed', onTokenRefreshed);

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refresh({ tokenProvider: stubProvider({ saveTokens }), refreshClient, events }));
    client.use(auth(stubProvider()));

    const data = await client.get('/x');

    expect(data).toEqual({ ok: true });
    expect(main.calls).toHaveLength(2);
    expect(refreshMock.calls).toHaveLength(1);
    expect(saveTokens).toHaveBeenCalledWith({ accessToken: 'new-token' });
    expect(onTokenRefreshed).toHaveBeenCalledTimes(1);
    expect(onTokenRefreshed).toHaveBeenCalledWith({});
  });

  it("re-enters only the inner chain on retry: the auth middleware runs twice, refresh's own handler runs once", async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    let refreshInvocations = 0;
    let authRuns = 0;
    const client = new HttpClient({ adapter: main.adapter });
    client.use({
      name: 'count-refresh-plugin-invocations',
      order: PluginOrder.refresh - 1,
      handler: async (request, next) => {
        refreshInvocations += 1;
        return next(request);
      },
    });
    client.use(refresh({ tokenProvider: stubProvider(), refreshClient }));
    client.use({
      name: 'count-inner-runs',
      order: PluginOrder.auth - 1,
      handler: async (request, next) => {
        authRuns += 1;
        return next(request);
      },
    });
    client.use(auth(stubProvider()));

    await client.get('/x');

    expect(refreshInvocations).toBe(1);
    expect(authRuns).toBe(2);
  });

  it('does not attempt a refresh for a request matching an excludePaths pattern (infinite-loop guard)', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      refresh({
        tokenProvider: stubProvider(),
        refreshClient,
        shouldRefresh: defaultRefreshPolicy({ excludePaths: ['/refresh'] }),
      }),
    );

    await expect(client.get('/refresh')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    expect(refreshMock.calls).toHaveLength(0);
  });

  it('maxAttempts (default 1) stops after one refresh — a second 401 on the retried request propagates as-is', async () => {
    const main = scriptedAdapter(['unauthorized', 'unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refresh({ tokenProvider: stubProvider(), refreshClient }));

    await expect(client.get('/x')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    expect(main.calls).toHaveLength(2);
    expect(refreshMock.calls).toHaveLength(1);
  });

  it('a failing refresh call propagates the original error with the refresh failure attached via .cause, and does not hang', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter(['unauthorized']);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const clear = vi.fn(async () => {});
    const events = new HttpEventBus();
    const onUnauthorized = vi.fn();
    const onRefreshFailed = vi.fn();
    events.on('unauthorized', onUnauthorized);
    events.on('token:refresh-failed', onRefreshFailed);

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refresh({ tokenProvider: stubProvider({ clear }), refreshClient, events }));

    const error: unknown = await client.get('/x').catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect((error as HttpError).status).toBe(401);
    expect((error as HttpError).cause).toBeInstanceOf(HttpError);
    expect(((error as HttpError).cause as HttpError).status).toBe(401);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onRefreshFailed).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized.mock.calls[0][0].error).toBeInstanceOf(HttpError);
    expect(onUnauthorized.mock.calls[0][0].error.status).toBe(401);
  });

  it('does not attempt a refresh when tokenProvider.canRefresh() resolves false, clears tokens, and emits unauthorized', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const clear = vi.fn(async () => {});
    const events = new HttpEventBus();
    const onUnauthorized = vi.fn();
    events.on('unauthorized', onUnauthorized);

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      refresh({ tokenProvider: stubProvider({ canRefresh: async () => false, clear }), refreshClient, events }),
    );

    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(refreshMock.calls).toHaveLength(0);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized.mock.calls[0][0].error).toBeInstanceOf(HttpError);
  });

  it('skips refresh entirely when the request meta.refresh is false', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refresh({ tokenProvider: stubProvider(), refreshClient }));

    await expect(client.get('/x', { meta: { refresh: false } })).rejects.toMatchObject({ status: 401 });
    expect(refreshMock.calls).toHaveLength(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A token-aware main adapter: succeeds only when the Authorization header matches `currentValidToken()`. */
function tokenAwareAdapter(currentValidToken: () => string): { adapter: HttpAdapter; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const adapter: HttpAdapter = {
    name: 'token-aware',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      calls.push(request);
      if (request.headers.authorization === `Bearer ${currentValidToken()}`) {
        return { status: 200, statusText: 'OK', headers: {}, request, data: { ok: true } as T };
      }
      throw new HttpError('Unauthorized', { code: 'HTTP_ERROR', status: 401, request });
    },
  };
  return { adapter, calls };
}

/** A TokenProvider whose stored token can be read/written by the test, mimicking real persistence. */
function mutableProvider(initialToken: string): TokenProvider & { token: string } {
  const state = { token: initialToken };
  return {
    get token() {
      return state.token;
    },
    set token(value: string) {
      state.token = value;
    },
    getAccessToken: async () => state.token,
    saveTokens: async (payload) => {
      state.token = (payload as { accessToken: string }).accessToken;
    },
    clear: async () => {
      state.token = 'cleared';
    },
    canRefresh: async () => true,
    buildRefreshRequest: async () => ({ url: '/refresh', method: 'POST' }),
  };
}

describe('refresh — concurrent request queueing', () => {
  it('queues concurrent 401s behind a single in-flight refresh; all resolve once it completes', async () => {
    let validToken = 'fresh-token';
    const { adapter: mainAdapter, calls: mainCalls } = tokenAwareAdapter(() => validToken);
    const provider = mutableProvider('stale-token');

    let refreshCallCount = 0;
    const refreshDone = deferred<void>();
    const refreshAdapter: HttpAdapter = {
      name: 'refresh',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        refreshCallCount += 1;
        await refreshDone.promise;
        validToken = 'fresh-token';
        return { status: 200, statusText: 'OK', headers: {}, request, data: { accessToken: 'fresh-token' } as T };
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(refresh({ tokenProvider: provider, refreshClient }));
    client.use(auth(provider));

    const promises = [0, 1, 2, 3, 4].map((i) => client.get(`/x${i}`));
    await tick();

    expect(refreshCallCount).toBe(1);
    refreshDone.resolve();

    const results = await Promise.all(promises);
    expect(results).toEqual([0, 1, 2, 3, 4].map(() => ({ ok: true })));
    expect(refreshCallCount).toBe(1);
    // Every request retried after the shared refresh, never before — no partial 401 leaks through.
    expect(mainCalls.filter((r) => r.headers.authorization === 'Bearer fresh-token')).toHaveLength(5);
  });

  it('rejects each queued request with its own original error when the shared refresh fails, refreshing tokenProvider.clear() and emitting unauthorized only once', async () => {
    const { adapter: mainAdapter } = tokenAwareAdapter(() => 'never-valid');
    const provider = mutableProvider('stale-token');
    const clear = vi.fn(async () => {});
    provider.clear = clear;
    const events = new HttpEventBus();
    const onUnauthorized = vi.fn();
    events.on('unauthorized', onUnauthorized);

    let refreshCallCount = 0;
    const refreshDone = deferred<void>();
    const refreshAdapter: HttpAdapter = {
      name: 'refresh',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(): Promise<HttpResponse<T>> {
        refreshCallCount += 1;
        await refreshDone.promise;
        throw new Error('refresh endpoint down');
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(refresh({ tokenProvider: provider, refreshClient, events }));
    client.use(auth(provider));

    const promises = [client.get('/a'), client.get('/b'), client.get('/c')].map((p) => p.catch((e: unknown) => e));
    await tick();

    expect(refreshCallCount).toBe(1);
    refreshDone.reject(new Error('refresh endpoint down'));

    const errors = (await Promise.all(promises)) as HttpError[];
    expect(errors).toHaveLength(3);
    for (const error of errors) {
      expect(HttpError.is(error)).toBe(true);
      expect(error.status).toBe(401);
      expect((error.cause as Error).message).toBe('refresh endpoint down');
    }
    // Each request got its own distinct HttpError, not a single shared rejection value.
    expect(new Set(errors).size).toBe(3);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a later 401 after the previous refresh already resolved triggers a fresh refresh, not a stale queue', async () => {
    let validToken = 'good-token-1';
    let refreshCallCount = 0;
    const { adapter: mainAdapter } = tokenAwareAdapter(() => validToken);
    const provider = mutableProvider('stale-token');
    const refreshAdapter: HttpAdapter = {
      name: 'refresh',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        refreshCallCount += 1;
        const accessToken = `good-token-${refreshCallCount + 1}`;
        validToken = accessToken;
        return { status: 200, statusText: 'OK', headers: {}, request, data: { accessToken } as T };
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(refresh({ tokenProvider: provider, refreshClient }));
    client.use(auth(provider));

    await client.get('/first');
    expect(refreshCallCount).toBe(1);

    // Simulate the server invalidating the token again, independently of anything queued.
    validToken = 'good-token-99';

    await client.get('/second');
    expect(refreshCallCount).toBe(2);
  });
});
