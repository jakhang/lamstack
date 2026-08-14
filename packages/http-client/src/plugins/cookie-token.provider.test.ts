import { describe, expect, it } from 'vitest';
import { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import { resolve } from '../core/resolve';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { auth } from './auth.plugin';
import { bearer } from './authenticators';
import { CookieHttpOnlyTokenProvider } from './cookie-token.provider';
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

describe('CookieHttpOnlyTokenProvider', () => {
  it('getAccessToken() returns null before sign-in', async () => {
    const provider = new CookieHttpOnlyTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/refresh',
    });
    expect(await provider.getAccessToken()).toBeNull();
  });

  it('saveTokens() sets the in-memory access token and the signed-in flag', async () => {
    const store = fakeStorage();
    const provider = new CookieHttpOnlyTokenProvider({ store, refreshUrl: '/refresh' });
    await provider.saveTokens({ accessToken: 'a1' });
    expect(await provider.getAccessToken()).toBe('a1');
    expect(await store.getItem('SIGNED_IN')).toBe('true');
  });

  it('saveTokens() sets the signed-in flag even for a bodyless response — a cookie-only sign-in has no access token to parse', async () => {
    const store = fakeStorage();
    const provider = new CookieHttpOnlyTokenProvider({ store, refreshUrl: '/refresh' });
    await provider.saveTokens(undefined);
    expect(await provider.getAccessToken()).toBeNull();
    expect(await store.getItem('SIGNED_IN')).toBe('true');
  });

  it('clear() resets the in-memory token and the signed-in flag (cannot clear the HttpOnly cookie itself)', async () => {
    const store = fakeStorage();
    const provider = new CookieHttpOnlyTokenProvider({ store, refreshUrl: '/refresh' });
    await provider.saveTokens({ accessToken: 'a1' });

    await provider.clear();

    expect(await provider.getAccessToken()).toBeNull();
    expect(await store.getItem('SIGNED_IN')).toBeNull();
  });

  it('canRefresh() returns true from the signed-in flag alone — it can never read the HttpOnly refresh token', async () => {
    const store = fakeStorage();
    const provider = new CookieHttpOnlyTokenProvider({ store, refreshUrl: '/refresh' });
    expect(await provider.canRefresh()).toBe(false);

    await provider.saveTokens({ accessToken: 'a1' });
    expect(await provider.canRefresh()).toBe(true);
  });

  it('buildRefreshRequest() is a credentialed GET with no body', async () => {
    const provider = new CookieHttpOnlyTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/auth/refresh',
    });
    const init = await provider.buildRefreshRequest();
    expect(init).toEqual({ url: '/auth/refresh', method: 'GET', credentials: 'include' });
  });

  it('decorate() sets credentials: include on every request', () => {
    const provider = new CookieHttpOnlyTokenProvider({
      store: fakeStorage(),
      refreshUrl: '/refresh',
    });
    const request = resolve({ url: '/x' });
    const decorated = provider.decorate!(request);
    expect(decorated.credentials).toBe('include');
  });
});

describe('CookieHttpOnlyTokenProvider — end-to-end with auth + recover plugins', () => {
  it('sends credentials: include on every request, and survives a 401 -> refresh -> retry cycle', async () => {
    const store = fakeStorage();
    const provider = new CookieHttpOnlyTokenProvider({ store, refreshUrl: '/auth/refresh' });
    await provider.saveTokens({ accessToken: 'old-token' });

    let mainCalls = 0;
    const mainAdapter: HttpAdapter = {
      name: 'main',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        mainCalls += 1;
        expect(request.credentials).toBe('include');
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
        expect(request.method).toBe('GET');
        expect(request.credentials).toBe('include');
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

    // The new auth() plugin no longer calls provider.decorate() — a cookie-based strategy
    // declares credentials: 'include' at the client level instead (SPEC v3 §3.3).
    const client = new HttpClient({ adapter: mainAdapter, credentials: 'include' });
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
  });
});
