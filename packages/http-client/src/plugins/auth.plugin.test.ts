import { describe, expect, it, vi } from 'vitest';
import { fetchAdapter } from '../adapters/fetch.adapter';
import { HttpClient } from '../core/client';
import { auth } from './auth.plugin';
import type { Authenticator } from './auth.plugin';

function captureFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fetchStub };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe('auth', () => {
  it("applies the authenticator's returned request to the outgoing call", async () => {
    const { calls, fetchStub } = captureFetch();
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    const authenticator: Authenticator = async (request) => ({
      ...request,
      headers: { ...request.headers, authorization: 'Bearer tok123' },
    });
    client.use(auth(authenticator));

    await client.get('/x');

    expect(headersOf(calls[0].init).authorization).toBe('Bearer tok123');
  });

  it('awaits an async authenticator before continuing', async () => {
    const { calls, fetchStub } = captureFetch();
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    const authenticator: Authenticator = (request) =>
      new Promise((resolvePromise) =>
        setTimeout(() => resolvePromise({ ...request, headers: { ...request.headers, 'x-delayed': 'yes' } }), 5),
      );
    client.use(auth(authenticator));

    await client.get('/x');

    expect(headersOf(calls[0].init)['x-delayed']).toBe('yes');
  });

  it('skips the authenticator entirely when options.skip(request) is true', async () => {
    const { calls, fetchStub } = captureFetch();
    const authenticator = vi.fn<Authenticator>(async (request) => request);
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(auth(authenticator, { skip: (request) => request.url.includes('/public') }));

    await client.get('/public/x');

    expect(authenticator).not.toHaveBeenCalled();
    expect(headersOf(calls[0].init).authorization).toBeUndefined();
  });

  it('does not skip requests that do not match options.skip', async () => {
    const { fetchStub } = captureFetch();
    const authenticator = vi.fn<Authenticator>(async (request) => ({
      ...request,
      headers: { ...request.headers, authorization: 'Bearer tok123' },
    }));
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(auth(authenticator, { skip: (request) => request.url.includes('/public') }));

    await client.get('/private/x');

    expect(authenticator).toHaveBeenCalledTimes(1);
  });
});
