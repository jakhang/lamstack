import { describe, expect, it } from 'vitest';
import { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { auth } from './auth.plugin';
import { bearer } from './authenticators';
import { LocalStorageTokenProvider } from './local-storage-token.provider';
import { recover } from './recover.plugin';
import type { Storage } from './token-provider';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

describe('LocalStorageTokenProvider', () => {
  it('getAccessToken() returns null before any token is saved', async () => {
    const provider = new LocalStorageTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/refresh',
    });
    expect(await provider.getAccessToken()).toBeNull();
  });

  it('getAccessToken() falls back to storage when not cached in memory (e.g. after a reload)', async () => {
    const store = fakeStorage();
    await store.setItem('access_token', 'from-storage');
    const provider = new LocalStorageTokenProvider({ store, refreshUrl: '/refresh' });
    expect(await provider.getAccessToken()).toBe('from-storage');
  });

  it('saveTokens() parses the { accessToken } response shape', async () => {
    const provider = new LocalStorageTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/refresh',
    });
    await provider.saveTokens({ accessToken: 'a1' });
    expect(await provider.getAccessToken()).toBe('a1');
  });

  it('saveTokens() parses the { data: { accessToken } } response shape', async () => {
    const provider = new LocalStorageTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/refresh',
    });
    await provider.saveTokens({ data: { accessToken: 'a1' } });
    expect(await provider.getAccessToken()).toBe('a1');
  });

  it('saveTokens() parses the { access_token } response shape', async () => {
    const provider = new LocalStorageTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/refresh',
    });
    await provider.saveTokens({ access_token: 'a1' });
    expect(await provider.getAccessToken()).toBe('a1');
  });

  it('saveTokens() persists the refreshToken into storage', async () => {
    const store = fakeStorage();
    const provider = new LocalStorageTokenProvider({ store, refreshUrl: '/refresh' });
    await provider.saveTokens({ accessToken: 'a1', refreshToken: 'r1' });
    expect(await store.getItem('refresh_token')).toBe('r1');
  });

  it('clear() removes both tokens from storage and memory', async () => {
    const store = fakeStorage();
    const provider = new LocalStorageTokenProvider({ store, refreshUrl: '/refresh' });
    await provider.saveTokens({ accessToken: 'a1', refreshToken: 'r1' });

    await provider.clear();

    expect(await provider.getAccessToken()).toBeNull();
    expect(await store.getItem('access_token')).toBeNull();
    expect(await store.getItem('refresh_token')).toBeNull();
  });

  it('canRefresh() reflects whether a refresh token is stored', async () => {
    const store = fakeStorage();
    const provider = new LocalStorageTokenProvider({ store, refreshUrl: '/refresh' });
    expect(await provider.canRefresh()).toBe(false);

    await provider.saveTokens({ accessToken: 'a1', refreshToken: 'r1' });
    expect(await provider.canRefresh()).toBe(true);
  });

  it('buildRefreshRequest() sends the stored refresh token as a POST body to refreshUrl', async () => {
    const store = fakeStorage();
    const provider = new LocalStorageTokenProvider({ store, refreshUrl: '/auth/refresh' });
    await provider.saveTokens({ accessToken: 'a1', refreshToken: 'r1' });

    const init = await provider.buildRefreshRequest();

    expect(init).toEqual({ url: '/auth/refresh', method: 'POST', body: { refreshToken: 'r1' } });
  });

  it('supports a custom accessTokenKey/refreshTokenKey/parser', async () => {
    const store = fakeStorage();
    const provider = new LocalStorageTokenProvider({
      store,
      refreshUrl: '/refresh',
      accessTokenKey: 'my_access',
      refreshTokenKey: 'my_refresh',
      parser: () => 'custom-token',
    });

    await provider.saveTokens({ anything: true, refreshToken: 'r1' });

    expect(await store.getItem('my_access')).toBe('custom-token');
    expect(await store.getItem('my_refresh')).toBe('r1');
  });
});

describe('LocalStorageTokenProvider — end-to-end with auth + recover plugins', () => {
  it('attaches the access token, and survives a 401 -> refresh -> retry cycle', async () => {
    const store = fakeStorage();
    const provider = new LocalStorageTokenProvider({ store, refreshUrl: '/auth/refresh' });
    await provider.saveTokens({ accessToken: 'old-token', refreshToken: 'r1' });

    let mainCalls = 0;
    const mainAdapter: HttpAdapter = {
      name: 'main',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        mainCalls += 1;
        if (request.headers.authorization === 'Bearer new-token') {
          return { status: 200, statusText: 'OK', headers: {}, request, data: { ok: true } as T };
        }
        throw new HttpError('Unauthorized', { code: 'HTTP_ERROR', status: 401, request });
      },
    };
    const refreshAdapter: HttpAdapter = {
      name: 'refresh',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        expect(request.url).toBe('/auth/refresh');
        expect((request.body as { refreshToken: string }).refreshToken).toBe('r1');
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          request,
          data: { accessToken: 'new-token' } as T,
        };
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(
      recover({
        recover: async () => {
          const response = await refreshClient.request(await provider.buildRefreshRequest());
          await provider.saveTokens(response.data);
        },
      }),
    );
    client.use(auth(bearer(provider)));

    const data = await client.get('/x');

    expect(data).toEqual({ ok: true });
    expect(mainCalls).toBe(2);
    expect(await store.getItem('access_token')).toBe('new-token');
  });
});
