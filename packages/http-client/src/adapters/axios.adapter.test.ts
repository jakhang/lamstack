import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from '../core/resolve';
import { axiosAdapter } from './axios.adapter';
import { runAdapterContract } from './contract.test-kit';

runAdapterContract('axios', () => axiosAdapter(axios.create()));

describe('axiosAdapter — cancel-vs-timeout precedence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports CANCELED, not TIMEOUT, when the user signal and the internal timeout both end up aborted', async () => {
    // Mirrors real axios: doesn't settle until the signal it was given fires 'abort', at
    // which point it rejects with an ERR_CANCELED AxiosError (same shape axios itself uses).
    const mockInstance = {
      request: (config: { signal?: AbortSignal }) =>
        new Promise((_resolvePromise, reject) => {
          config.signal?.addEventListener('abort', () => {
            reject(
              Object.assign(new Error('canceled'), { isAxiosError: true, code: 'ERR_CANCELED' }),
            );
          });
        }),
    } as unknown as AxiosInstance;

    const adapter = axiosAdapter(mockInstance);
    const controller = new AbortController();
    const request = resolve({ url: '/x', timeout: 5, signal: controller.signal });

    const promise = adapter.send(request);
    void promise.catch(() => {}); // silence Node's "handled asynchronously" noise below
    // Both calls are synchronous, with no `await` between them, so both signals are
    // already `aborted: true` before the JS engine yields to any microtask — including
    // the adapter's own catch handler, which only runs once this synchronous block ends.
    // (The *Async* variant of advanceTimers would yield partway through, letting the
    // catch handler run after only one of the two had fired — not a real race.)
    controller.abort(); // the user cancels...
    vi.advanceTimersByTime(5); // ...at the same moment the internal timeout also fires.

    await expect(promise).rejects.toMatchObject({ code: 'CANCELED' });
  });
});

describe('axiosAdapter — credentials', () => {
  // Documents a known, accepted divergence from fetchAdapter (README's Adapters section
  // has the same note) — not a bug to fix here. Axios/XHR's `withCredentials` is a single
  // boolean: whether to send/accept cross-site cookies. There is no axios request option
  // distinguishing "never send cookies, even same-origin" ('omit') from "send same-origin
  // cookies, never cross-site" ('same-origin', the default) — both collapse to `false`.
  it.each(['omit', 'same-origin'] as const)(
    'maps credentials: %s to withCredentials: false — indistinguishable through axios',
    async (credentials) => {
      const calls: { withCredentials?: boolean }[] = [];
      const mockInstance = {
        request: (config: { withCredentials?: boolean }) => {
          calls.push(config);
          return Promise.resolve({
            status: 204,
            statusText: 'No Content',
            headers: {},
            data: null,
          });
        },
      } as unknown as AxiosInstance;

      const adapter = axiosAdapter(mockInstance);
      await adapter.send(resolve({ url: '/x', credentials }));

      expect(calls[0].withCredentials).toBe(false);
    },
  );

  it('maps credentials: "include" to withCredentials: true', async () => {
    const calls: { withCredentials?: boolean }[] = [];
    const mockInstance = {
      request: (config: { withCredentials?: boolean }) => {
        calls.push(config);
        return Promise.resolve({ status: 204, statusText: 'No Content', headers: {}, data: null });
      },
    } as unknown as AxiosInstance;

    const adapter = axiosAdapter(mockInstance);
    await adapter.send(resolve({ url: '/x', credentials: 'include' }));

    expect(calls[0].withCredentials).toBe(true);
  });
});
