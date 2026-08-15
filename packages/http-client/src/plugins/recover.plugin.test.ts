import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../core/client';
import { EventBus } from '../core/event-bus';
import { HttpError } from '../core/http-error';
import { PluginOrder } from '../core/types';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { auth } from './auth.plugin';
import { bearer } from './authenticators';
import { onStatus, recover } from './recover.plugin';
import type { RecoveryEventMap } from './recover.plugin';

function stubProvider(overrides: { getAccessToken?: () => Promise<string | null> } = {}) {
  return { getAccessToken: overrides.getAccessToken ?? (async () => 'old-token') };
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

describe('recover — single recovery-and-retry', () => {
  it('recovers once on 401 and retries the original request, resolving with the retried response', async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const saveTokens = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    const events = new EventBus<RecoveryEventMap>();
    const onSucceeded = vi.fn();
    events.on('recovery:succeeded', onSucceeded);

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          const response = await refreshClient.request({ url: '/refresh', method: 'POST' });
          await saveTokens(response.data);
        },
        events,
      }),
    );
    client.use(auth(bearer(stubProvider())));

    const data = await client.get('/x');

    expect(data).toEqual({ ok: true });
    expect(main.calls).toHaveLength(2);
    expect(refreshMock.calls).toHaveLength(1);
    expect(saveTokens).toHaveBeenCalledWith({ accessToken: 'new-token' });
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(onSucceeded).toHaveBeenCalledWith({});
  });

  it("re-enters only the inner chain on retry: the auth middleware runs twice, recover's own handler runs once", async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    let recoverInvocations = 0;
    let authRuns = 0;
    const client = new HttpClient({ adapter: main.adapter });
    client.use({
      name: 'count-recover-plugin-invocations',
      order: PluginOrder.recover - 1,
      handler: async (request, next) => {
        recoverInvocations += 1;
        return next(request);
      },
    });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
      }),
    );
    client.use({
      name: 'count-inner-runs',
      order: PluginOrder.auth - 1,
      handler: async (request, next) => {
        authRuns += 1;
        return next(request);
      },
    });
    client.use(auth(bearer(stubProvider())));

    await client.get('/x');

    expect(recoverInvocations).toBe(1);
    expect(authRuns).toBe(2);
  });

  it('does not attempt recovery for a request matching an excluded pattern (infinite-loop guard)', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
        shouldRecover: onStatus(401, { exclude: ['/refresh'] }),
      }),
    );

    await expect(client.get('/refresh')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    expect(refreshMock.calls).toHaveLength(0);
  });

  it('maxAttempts (default 1) stops after one recovery cycle — a second 401 on the retried request propagates as-is', async () => {
    const main = scriptedAdapter(['unauthorized', 'unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
      }),
    );

    await expect(client.get('/x')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    expect(main.calls).toHaveLength(2);
    expect(refreshMock.calls).toHaveLength(1);
  });

  it('a failing recovery call propagates the original error with the recovery failure attached via .cause, and does not hang', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter(['unauthorized']);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const clear = vi.fn(async () => {});
    const events = new EventBus<RecoveryEventMap>();
    const onFailed = vi.fn();
    events.on('recovery:failed', onFailed);
    events.on('recovery:failed', () => clear());

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
        events,
      }),
    );

    const error: unknown = await client.get('/x').catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect((error as HttpError).status).toBe(401);
    expect((error as HttpError).cause).toBeInstanceOf(HttpError);
    expect(((error as HttpError).cause as HttpError).status).toBe(401);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('does not attempt recovery when canRecover() resolves false, and emits recovery:unavailable', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const clear = vi.fn(async () => {});
    const events = new EventBus<RecoveryEventMap>();
    const onUnavailable = vi.fn();
    events.on('recovery:unavailable', onUnavailable);
    events.on('recovery:unavailable', () => clear());

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
        canRecover: async () => false,
        events,
      }),
    );

    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(refreshMock.calls).toHaveLength(0);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable.mock.calls[0][0].error).toBeInstanceOf(HttpError);
  });

  it('skips recovery entirely by default when meta.recover is false, with no options.skip passed', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
      }),
    );

    await expect(client.get('/x', { meta: { recover: false } })).rejects.toMatchObject({
      status: 401,
    });
    expect(refreshMock.calls).toHaveLength(0);
  });

  it('attempts recovery by default when meta.recover is not set', async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
      }),
    );

    await client.get('/x');

    expect(refreshMock.calls).toHaveLength(1);
  });

  it('a custom options.skip replaces the default meta.recover check entirely — meta.recover is ignored once skip is passed', async () => {
    const main = scriptedAdapter(['unauthorized', { ok: true }]);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
        skip: () => false,
      }),
    );

    await client.get('/x', { meta: { recover: false } });

    expect(refreshMock.calls).toHaveLength(1);
  });

  it('skip is checked before shouldRecover — shouldRecover is never called when skip is true', async () => {
    const main = scriptedAdapter(['unauthorized']);
    const refreshMock = scriptedAdapter([{ accessToken: 'new-token' }]);
    const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
    const shouldRecover = vi.fn(() => true);

    const client = new HttpClient({ adapter: main.adapter });
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
        shouldRecover,
        skip: () => true,
      }),
    );

    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });

    expect(shouldRecover).not.toHaveBeenCalled();
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
function tokenAwareAdapter(currentValidToken: () => string): {
  adapter: HttpAdapter;
  calls: HttpRequest[];
} {
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

/** A bearer() source whose token can be read/written by the test, mimicking real persistence. */
function mutableProvider(initialToken: string): {
  token: string;
  getAccessToken(): Promise<string>;
} {
  const state = { token: initialToken };
  return {
    get token() {
      return state.token;
    },
    set token(value: string) {
      state.token = value;
    },
    getAccessToken: async () => state.token,
  };
}

describe('recover — concurrent request queueing', () => {
  it('queues concurrent 401s behind a single in-flight recovery cycle; all resolve once it completes', async () => {
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
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          request,
          data: { accessToken: 'fresh-token' } as T,
        };
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });

    const client = new HttpClient({ adapter: mainAdapter });
    client.use(
      recover({
        recover: async () => {
          const response = await refreshClient.request({ url: '/refresh', method: 'POST' });
          provider.token = (response.data as { accessToken: string }).accessToken;
        },
      }),
    );
    client.use(auth(bearer(provider)));

    const promises = [0, 1, 2, 3, 4].map((i) => client.get(`/x${i}`));
    await tick();

    expect(refreshCallCount).toBe(1);
    refreshDone.resolve();

    const results = await Promise.all(promises);
    expect(results).toEqual([0, 1, 2, 3, 4].map(() => ({ ok: true })));
    expect(refreshCallCount).toBe(1);
    // Every request retried after the shared recovery, never before — no partial 401 leaks through.
    expect(mainCalls.filter((r) => r.headers.authorization === 'Bearer fresh-token')).toHaveLength(
      5,
    );
  });

  it('rejects each queued request with its own original error when the shared recovery fails, and emits recovery:failed only once', async () => {
    const { adapter: mainAdapter } = tokenAwareAdapter(() => 'never-valid');
    const provider = mutableProvider('stale-token');
    const clear = vi.fn(async () => {});
    const events = new EventBus<RecoveryEventMap>();
    const onFailed = vi.fn();
    events.on('recovery:failed', onFailed);
    events.on('recovery:failed', () => clear());

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
    client.use(
      recover({
        recover: async () => {
          await refreshClient.request({ url: '/refresh', method: 'POST' });
        },
        events,
      }),
    );
    client.use(auth(bearer(provider)));

    const promises = [client.get('/a'), client.get('/b'), client.get('/c')].map((p) =>
      p.catch((e: unknown) => e),
    );
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
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('a later 401 after the previous recovery already resolved triggers a fresh cycle, not a stale queue', async () => {
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
    client.use(
      recover({
        recover: async () => {
          const response = await refreshClient.request({ url: '/refresh', method: 'POST' });
          provider.token = (response.data as { accessToken: string }).accessToken;
        },
      }),
    );
    client.use(auth(bearer(provider)));

    await client.get('/first');
    expect(refreshCallCount).toBe(1);

    // Simulate the server invalidating the token again, independently of anything queued.
    validToken = 'good-token-99';

    await client.get('/second');
    expect(refreshCallCount).toBe(2);
  });
});

describe('recover — stale generation after an unrelated rotation', () => {
  it("a request dispatched before another request's recovery cycle completes retries once with the new credential instead of starting a redundant cycle", async () => {
    // The server already considers token-0 invalid from the start — both A and B's initial
    // attempts fail with it, independently of each other.
    let validToken = 'token-1';
    const { adapter: tokenCheckingAdapter } = tokenAwareAdapter(() => validToken);
    const provider = mutableProvider('token-0');

    let refreshCallCount = 0;
    const refreshAdapter: HttpAdapter = {
      name: 'refresh',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        refreshCallCount += 1;
        validToken = 'token-1';
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          request,
          data: { accessToken: 'token-1' } as T,
        };
      },
    };
    const refreshClient = new HttpClient({ adapter: refreshAdapter });

    // request A's underlying send() only "comes back" (with a 401, carrying the now-stale
    // token-0) once told to — simulating it having been dispatched well before B's own
    // recovery cycle ran and completed.
    const aResponds = deferred<void>();
    let aAttempts = 0;
    const slowAdapter: HttpAdapter = {
      name: 'slow',
      capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
      async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        if (request.url === '/a') {
          aAttempts += 1;
          if (aAttempts === 1) await aResponds.promise;
        }
        return tokenCheckingAdapter.send<T>(request);
      },
    };

    const client = new HttpClient({ adapter: slowAdapter });
    client.use(
      recover({
        recover: async () => {
          const response = await refreshClient.request({ url: '/refresh', method: 'POST' });
          provider.token = (response.data as { accessToken: string }).accessToken;
        },
      }),
    );
    client.use(auth(bearer(provider)));

    const aPromise = client.get('/a'); // hangs on its first attempt, still carrying token-0

    // B triggers and completes a full recovery cycle while A is still waiting on its first attempt.
    await client.get('/b');
    expect(refreshCallCount).toBe(1);
    expect(validToken).toBe('token-1');

    // Now let A's stale attempt finally fail (token-0 no longer matches token-1).
    aResponds.resolve();
    await aPromise;

    // A should have retried directly with token-1 picked up via auth(), not triggered a second cycle.
    expect(refreshCallCount).toBe(1);
    expect(aAttempts).toBe(2);
  });
});

describe('recover — cooldown after a failed cycle', () => {
  it('calls recover() at most once across repeated 401s within the cooldown window, throwing the cached recovery failure via .cause instead of starting a new cycle', async () => {
    vi.useFakeTimers();
    try {
      const main = scriptedAdapter(['unauthorized']);
      const refreshMock = scriptedAdapter(['unauthorized']);
      const refreshClient = new HttpClient({ adapter: refreshMock.adapter });
      const events = new EventBus<RecoveryEventMap>();
      const onUnavailable = vi.fn();
      events.on('recovery:unavailable', onUnavailable);

      const client = new HttpClient({ adapter: main.adapter });
      client.use(
        recover({
          recover: async () => {
            await refreshClient.request({ url: '/refresh', method: 'POST' });
          },
          events,
        }),
      );

      const first: unknown = await client.get('/x').catch((e: unknown) => e);
      expect(HttpError.is(first)).toBe(true);
      expect(refreshMock.calls).toHaveLength(1);

      vi.advanceTimersByTime(500); // well within the default 1000ms cooldown

      const second: unknown = await client.get('/x').catch((e: unknown) => e);
      expect(HttpError.is(second)).toBe(true);
      expect((second as HttpError).cause).toBeInstanceOf(HttpError);
      expect(((second as HttpError).cause as HttpError).status).toBe(401);
      expect(refreshMock.calls).toHaveLength(1); // no second cycle attempted
      expect(onUnavailable).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a fresh cycle once the cooldown window has fully elapsed', async () => {
    vi.useFakeTimers();
    try {
      const main = scriptedAdapter(['unauthorized']);
      const refreshMock = scriptedAdapter(['unauthorized']);
      const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

      const client = new HttpClient({ adapter: main.adapter });
      client.use(
        recover({
          recover: async () => {
            await refreshClient.request({ url: '/refresh', method: 'POST' });
          },
        }),
      );

      await client.get('/x').catch((e: unknown) => e);
      expect(refreshMock.calls).toHaveLength(1);

      vi.advanceTimersByTime(1000); // exactly the default cooldownMs

      await client.get('/x').catch((e: unknown) => e);
      expect(refreshMock.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the cooldown as soon as a cycle succeeds, so the very next failure can start its own fresh cycle immediately', async () => {
    vi.useFakeTimers();
    try {
      const main = scriptedAdapter(['unauthorized']);
      const refreshMock = scriptedAdapter(['unauthorized', { accessToken: 'new-token' }, 'unauthorized']);
      const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

      const client = new HttpClient({ adapter: main.adapter });
      client.use(
        recover({
          recover: async () => {
            await refreshClient.request({ url: '/refresh', method: 'POST' });
          },
        }),
      );

      await client.get('/x').catch((e: unknown) => e); // cycle 1: fails, cooldown starts
      expect(refreshMock.calls).toHaveLength(1);

      vi.advanceTimersByTime(1000); // let the cooldown from cycle 1 fully elapse

      await client.get('/x').catch((e: unknown) => e); // cycle 2: succeeds, resets cooldown
      expect(refreshMock.calls).toHaveLength(2);

      // No time advance at all — a lingering cooldown from cycle 1 would still be active here.
      await client.get('/x').catch((e: unknown) => e); // cycle 3: starts immediately, fails
      expect(refreshMock.calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cooldownMs: 0 disables the cooldown — repeated failures each attempt their own fresh cycle immediately', async () => {
    vi.useFakeTimers();
    try {
      const main = scriptedAdapter(['unauthorized']);
      const refreshMock = scriptedAdapter(['unauthorized']);
      const refreshClient = new HttpClient({ adapter: refreshMock.adapter });

      const client = new HttpClient({ adapter: main.adapter });
      client.use(
        recover({
          recover: async () => {
            await refreshClient.request({ url: '/refresh', method: 'POST' });
          },
          cooldownMs: 0,
        }),
      );

      await client.get('/x').catch((e: unknown) => e);
      expect(refreshMock.calls).toHaveLength(1);

      // No time advance at all — cooldownMs: 0 means nothing should ever block a fresh cycle.
      await client.get('/x').catch((e: unknown) => e);
      expect(refreshMock.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
