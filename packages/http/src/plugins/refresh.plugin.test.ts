import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import { PluginOrder } from '../core/types';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { authPlugin } from './auth.plugin';
import { refreshPlugin } from './refresh.plugin';
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

describe('refreshPlugin — single refresh-and-retry', () => {
  it('refreshes once on 401 and retries the original request, resolving with the retried response', async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refresh = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });
    const saveTokens = vi.fn(async () => {});

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refreshPlugin({ tokenProvider: stubProvider({ saveTokens }), refreshClient }));
    client.use(authPlugin(stubProvider()));

    const data = await client.get('/x');

    expect(data).toEqual({ ok: true });
    expect(main.calls).toHaveLength(2);
    expect(refresh.calls).toHaveLength(1);
    expect(saveTokens).toHaveBeenCalledWith({ accessToken: 'new-token' });
  });

  it("re-enters only the inner chain on retry: the auth middleware runs twice, refreshPlugin's own handler runs once", async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refresh = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });

    let refreshPluginInvocations = 0;
    let authRuns = 0;
    const client = new HttpClient({ adapter: main.adapter });
    client.use({
      name: 'count-refresh-plugin-invocations',
      order: PluginOrder.refresh - 1,
      handler: async (request, next) => {
        refreshPluginInvocations += 1;
        return next(request);
      },
    });
    client.use(refreshPlugin({ tokenProvider: stubProvider(), refreshClient }));
    client.use({
      name: 'count-inner-runs',
      order: PluginOrder.auth - 1,
      handler: async (request, next) => {
        authRuns += 1;
        return next(request);
      },
    });
    client.use(authPlugin(stubProvider()));

    await client.get('/x');

    expect(refreshPluginInvocations).toBe(1);
    expect(authRuns).toBe(2);
  });

  it('does not attempt a refresh for a request matching an excludePaths pattern (infinite-loop guard)', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refresh = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      refreshPlugin({
        tokenProvider: stubProvider(),
        refreshClient,
        shouldRefresh: defaultRefreshPolicy({ excludePaths: ['/refresh'] }),
      }),
    );

    await expect(client.get('/refresh')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    expect(refresh.calls).toHaveLength(0);
  });

  it('maxAttempts (default 1) stops after one refresh — a second 401 on the retried request propagates as-is', async () => {
    const main = scriptedAdapter(['unauthorized', 'unauthorized']);
    const refresh = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refreshPlugin({ tokenProvider: stubProvider(), refreshClient }));

    await expect(client.get('/x')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    expect(main.calls).toHaveLength(2);
    expect(refresh.calls).toHaveLength(1);
  });

  it('a failing refresh call propagates the original error with the refresh failure attached via .cause, and does not hang', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refresh = scriptedAdapter(['unauthorized']);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });
    const clear = vi.fn(async () => {});

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refreshPlugin({ tokenProvider: stubProvider({ clear }), refreshClient }));

    const error: unknown = await client.get('/x').catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect((error as HttpError).status).toBe(401);
    expect((error as HttpError).cause).toBeInstanceOf(HttpError);
    expect(((error as HttpError).cause as HttpError).status).toBe(401);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh when tokenProvider.canRefresh() resolves false, and clears tokens', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refresh = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });
    const clear = vi.fn(async () => {});

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refreshPlugin({ tokenProvider: stubProvider({ canRefresh: async () => false, clear }), refreshClient }));

    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(refresh.calls).toHaveLength(0);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('skips refresh entirely when the request meta.refresh is false', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refresh = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refresh.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(refreshPlugin({ tokenProvider: stubProvider(), refreshClient }));

    await expect(client.get('/x', { meta: { refresh: false } })).rejects.toMatchObject({ status: 401 });
    expect(refresh.calls).toHaveLength(0);
  });
});
