import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import { EventBus } from '../core/event-bus';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { auth } from './auth.plugin';
import { bearer } from './authenticators';
import { onStatus, recover } from './recover.plugin';
import type { RecoveryEventMap } from './recover.plugin';
import { tokenSession } from './token-session';
import type { TokenStore } from './token-session';

function fakeStore(initial: Record<string, string> = {}): TokenStore {
  const map = new Map(Object.entries(initial));
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

function noopClient(): HttpClient {
  const adapter: HttpAdapter = {
    name: 'noop',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      return { status: 200, statusText: 'OK', headers: {}, request, data: {} as T };
    },
  };
  return new HttpClient({ adapter });
}

describe('tokenSession', () => {
  it('getAccessToken() returns null before any renew, when the store is empty', async () => {
    const session = tokenSession({ store: fakeStore(), client: noopClient(), renew: vi.fn() });
    expect(await session.getAccessToken()).toBeNull();
  });

  it('getAccessToken() falls back to the store when not cached in memory (e.g. after a reload)', async () => {
    const store = fakeStore({ access_token: 'from-store' });
    const session = tokenSession({ store, client: noopClient(), renew: vi.fn() });
    expect(await session.getAccessToken()).toBe('from-store');
  });

  it('renew() calls the configured callback with (client, store), then re-reads the access token', async () => {
    const store = fakeStore();
    const client = noopClient();
    const renewFn = vi.fn(async (renewClient: HttpClient, renewStore: TokenStore) => {
      expect(renewClient).toBe(client);
      expect(renewStore).toBe(store);
      await renewStore.setItem('access_token', 'new-token');
    });
    const session = tokenSession({ store, client, renew: renewFn });

    await session.renew();

    expect(renewFn).toHaveBeenCalledTimes(1);
    expect(await session.getAccessToken()).toBe('new-token');
  });

  it('renew() propagates a thrown error from the renew callback', async () => {
    const session = tokenSession({
      store: fakeStore(),
      client: noopClient(),
      renew: async () => {
        throw new Error('refresh endpoint down');
      },
    });

    await expect(session.renew()).rejects.toThrow('refresh endpoint down');
  });

  it('supports a custom accessTokenKey', async () => {
    const store = fakeStore();
    const session = tokenSession({
      store,
      client: noopClient(),
      accessTokenKey: 'my_access',
      renew: async (_client, renewStore) => {
        await renewStore.setItem('my_access', 'custom-token');
      },
    });

    await session.renew();

    expect(await session.getAccessToken()).toBe('custom-token');
    expect(await store.getItem('access_token')).toBeNull();
  });

  it('canRenew() defaults to true when no canRenew option is given', async () => {
    const session = tokenSession({ store: fakeStore(), client: noopClient(), renew: vi.fn() });
    expect(await session.canRenew()).toBe(true);
  });

  it('canRenew() delegates to the configured callback, passed the store', async () => {
    const store = fakeStore({ refresh_token: 'r1' });
    const canRenew = vi.fn(
      async (checkStore: TokenStore) => !!(await checkStore.getItem('refresh_token')),
    );
    const session = tokenSession({ store, client: noopClient(), renew: vi.fn(), canRenew });

    expect(await session.canRenew()).toBe(true);
    expect(canRenew).toHaveBeenCalledWith(store);
  });

  it('end() clears the cached access token and removes it from the store', async () => {
    const store = fakeStore({ access_token: 'stale-token' });
    const session = tokenSession({ store, client: noopClient(), renew: vi.fn() });
    expect(await session.getAccessToken()).toBe('stale-token');

    await session.end();

    expect(await session.getAccessToken()).toBeNull();
    expect(await store.getItem('access_token')).toBeNull();
  });

  it('end() also calls the configured onEnd callback, passed the store', async () => {
    const store = fakeStore();
    const onEnd = vi.fn(async (endStore: TokenStore) => {
      await endStore.removeItem('refresh_token');
    });
    const session = tokenSession({ store, client: noopClient(), renew: vi.fn(), onEnd });

    await session.end();

    expect(onEnd).toHaveBeenCalledWith(store);
  });

  it('renew() can set the access token directly from its return value, without touching the store (in-memory-only strategies)', async () => {
    const store = fakeStore();
    const session = tokenSession({
      store,
      client: noopClient(),
      renew: async () => 'in-memory-token',
    });

    await session.renew();

    expect(await session.getAccessToken()).toBe('in-memory-token');
    expect(await store.getItem('access_token')).toBeNull();
  });

  it('renew() falls back to re-reading the store when the callback returns nothing', async () => {
    const store = fakeStore();
    const session = tokenSession({
      store,
      client: noopClient(),
      renew: async (_client, renewStore) => {
        await renewStore.setItem('access_token', 'from-store');
      },
    });

    await session.renew();

    expect(await session.getAccessToken()).toBe('from-store');
  });

  it('save() runs the configured save callback and updates the cached access token from its return value', async () => {
    const store = fakeStore();
    const save = vi.fn(
      async (payload: unknown) => (payload as { accessToken: string }).accessToken,
    );
    const session = tokenSession({ store, client: noopClient(), renew: vi.fn(), save });

    await session.save({ accessToken: 'from-login' });

    expect(save).toHaveBeenCalledWith({ accessToken: 'from-login' }, store);
    expect(await session.getAccessToken()).toBe('from-login');
  });

  it('save() is a no-op when no save option is configured', async () => {
    const session = tokenSession({ store: fakeStore(), client: noopClient(), renew: vi.fn() });
    await expect(session.save({ accessToken: 'ignored' })).resolves.toBeUndefined();
    expect(await session.getAccessToken()).toBeNull();
  });
});

describe('tokenSession — end-to-end with auth(bearer(session)) + recover()', () => {
  it('attaches the access token, recovers on 401 via renew(), and retries with the new token', async () => {
    const store = fakeStore({ access_token: 'old-token' });
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

    const session = tokenSession({
      store,
      client: refreshClient,
      renew: async (client, renewStore) => {
        const response = await client.post<{ accessToken: string }>('/auth/refresh');
        await renewStore.setItem('access_token', response.accessToken);
      },
    });

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(recover({ recover: () => session.renew(), canRecover: () => session.canRenew() }));
    client.use(auth(bearer(session)));

    const data = await client.get('/x');

    expect(data).toEqual({ ok: true });
    expect(mainCalls).toBe(2);
    expect(await store.getItem('access_token')).toBe('new-token');
  });

  it('calling session.end() on recovery:failed clears the stored token', async () => {
    const store = fakeStore({ access_token: 'old-token' });
    const mainAdapter: HttpAdapter = {
      name: 'main',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        throw new HttpError('Unauthorized', { code: 'HTTP_ERROR', status: 401, request });
      },
    };
    const refreshAdapter: HttpAdapter = {
      name: 'refresh',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(): Promise<HttpResponse<T>> {
        throw new Error('refresh endpoint down');
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });
    const events = new EventBus<RecoveryEventMap>();

    const session = tokenSession({
      store,
      client: refreshClient,
      renew: async (client) => {
        await client.post('/auth/refresh');
      },
    });
    events.on('recovery:failed', () => session.end());

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(
      recover({
        recover: () => session.renew(),
        shouldRecover: onStatus(401),
        events,
      }),
    );
    client.use(auth(bearer(session)));

    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(await store.getItem('access_token')).toBeNull();
  });
});
