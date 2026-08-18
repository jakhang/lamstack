import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from '../core/resolve';
import { fetchAdapter } from './fetch.adapter';
import { runAdapterContract } from './contract.test-kit';

runAdapterContract('fetch', () => fetchAdapter());

describe('fetchAdapter — cancel-vs-timeout precedence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports CANCELED, not TIMEOUT, when the user signal and the internal timeout both end up aborted', async () => {
    // Mirrors real fetch: doesn't settle until the signal it was given fires 'abort'.
    const fetchStub = ((_url: string, init?: RequestInit) => {
      return new Promise((_resolvePromise, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as typeof fetch;

    const adapter = fetchAdapter({ fetch: fetchStub });
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

describe('fetchAdapter — credentials', () => {
  it.each(['omit', 'same-origin', 'include'] as const)(
    'passes credentials: %s through to fetch() unchanged — fetch is the one adapter that can express all three',
    async (credentials) => {
      const calls: RequestInit[] = [];
      const fetchStub = (async (_url: string, init?: RequestInit) => {
        calls.push(init ?? {});
        return new Response(null, { status: 204 });
      }) as typeof fetch;

      const adapter = fetchAdapter({ fetch: fetchStub });
      await adapter.send(resolve({ url: '/x', credentials }));

      expect(calls[0].credentials).toBe(credentials);
    },
  );
});
