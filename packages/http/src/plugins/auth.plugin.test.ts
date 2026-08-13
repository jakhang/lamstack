import { describe, expect, it, vi } from 'vitest';
import { fetchAdapter } from '../adapters/fetch.adapter';
import { HttpClient } from '../core/client';
import { authPlugin } from './auth.plugin';
import type { TokenProvider } from './token-provider';

function stubProvider(overrides: Partial<TokenProvider> = {}): TokenProvider {
  return {
    getAccessToken: async () => null,
    saveTokens: async () => {},
    clear: async () => {},
    canRefresh: async () => false,
    buildRefreshRequest: async () => ({ url: '/refresh' }),
    ...overrides,
  };
}

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

describe('authPlugin', () => {
  it('attaches Authorization: Bearer <token> when the provider resolves a token', async () => {
    const { calls, fetchStub } = captureFetch();
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(authPlugin(stubProvider({ getAccessToken: async () => 'tok123' })));

    await client.get('/x');

    expect(headersOf(calls[0].init).authorization).toBe('Bearer tok123');
  });

  it('leaves the header unset when getAccessToken() resolves null', async () => {
    const { calls, fetchStub } = captureFetch();
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(authPlugin(stubProvider({ getAccessToken: async () => null })));

    await client.get('/x');

    expect(headersOf(calls[0].init).authorization).toBeUndefined();
  });

  it("applies provider.decorate() before attaching the auth header", async () => {
    const { calls, fetchStub } = captureFetch();
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(
      authPlugin(
        stubProvider({
          getAccessToken: async () => 'tok123',
          decorate: (request) => ({ ...request, headers: { ...request.headers, 'x-decorated': 'yes' } }),
        }),
      ),
    );

    await client.get('/x');

    const headers = headersOf(calls[0].init);
    expect(headers['x-decorated']).toBe('yes');
    expect(headers.authorization).toBe('Bearer tok123');
  });

  it('skips entirely when meta.auth is false — no decorate call, no header', async () => {
    const { calls, fetchStub } = captureFetch();
    const decorate = vi.fn((request) => request);
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(authPlugin(stubProvider({ getAccessToken: async () => 'tok123', decorate })));

    await client.get('/x', { meta: { auth: false } });

    expect(decorate).not.toHaveBeenCalled();
    expect(headersOf(calls[0].init).authorization).toBeUndefined();
  });

  it('supports a custom header name and scheme', async () => {
    const { calls, fetchStub } = captureFetch();
    const client = new HttpClient({ adapter: fetchAdapter({ fetch: fetchStub }) });
    client.use(
      authPlugin(stubProvider({ getAccessToken: async () => 'tok123' }), {
        header: 'x-api-key',
        scheme: '',
      }),
    );

    await client.get('/x');

    const headers = headersOf(calls[0].init);
    expect(headers['x-api-key']).toBe('tok123');
    expect(headers.authorization).toBeUndefined();
  });
});
