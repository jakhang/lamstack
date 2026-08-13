import { describe, expect, it } from 'vitest';
import { HttpClient } from './client';
import type { HttpAdapter, HttpHeaders, HttpRequest, HttpResponse } from './types';

function fakeAdapter(handler: (request: HttpRequest) => Partial<HttpResponse>): HttpAdapter {
  return {
    name: 'fake',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      const partial = handler(request);
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        request,
        ...partial,
      } as HttpResponse<T>;
    },
  };
}

describe('HttpClient — verb helpers', () => {
  it('get<T>() returns the parsed response body, not the full response', async () => {
    const client = new HttpClient({ adapter: fakeAdapter(() => ({ data: { message: 'hi' } })) });
    const data = await client.get<{ message: string }>('/x');
    expect(data).toEqual({ message: 'hi' });
  });

  it('request<T>() returns the full HttpResponse', async () => {
    const client = new HttpClient({ adapter: fakeAdapter(() => ({ data: { ok: true }, status: 201 })) });
    const response = await client.request<{ ok: boolean }>({ url: '/x' });
    expect(response.status).toBe(201);
    expect(response.data).toEqual({ ok: true });
    expect(response.request.url).toBe('/x');
  });

  it('head() returns the response headers directly', async () => {
    const headers: HttpHeaders = { 'x-total-count': '5' };
    const client = new HttpClient({ adapter: fakeAdapter(() => ({ headers })) });
    const result = await client.head('/x');
    expect(result).toEqual(headers);
  });

  it('post() sends the given body with method POST', async () => {
    let seen: HttpRequest | undefined;
    const client = new HttpClient({
      adapter: fakeAdapter((request) => {
        seen = request;
        return { data: null };
      }),
    });
    await client.post('/x', { name: 'a' });
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toEqual({ name: 'a' });
  });

  it('put()/patch() send the given body with the matching method', async () => {
    let seenMethod: string | undefined;
    const client = new HttpClient({
      adapter: fakeAdapter((request) => {
        seenMethod = request.method;
        return { data: null };
      }),
    });
    await client.put('/x', { a: 1 });
    expect(seenMethod).toBe('PUT');
    await client.patch('/x', { a: 1 });
    expect(seenMethod).toBe('PATCH');
  });

  it('delete() defaults to no body with method DELETE', async () => {
    let seen: HttpRequest | undefined;
    const client = new HttpClient({
      adapter: fakeAdapter((request) => {
        seen = request;
        return { data: null };
      }),
    });
    await client.delete('/x');
    expect(seen?.method).toBe('DELETE');
    expect(seen?.body).toBeUndefined();
  });
});

describe('HttpClient — use()', () => {
  it('runs a registered middleware for every request', async () => {
    const client = new HttpClient({ adapter: fakeAdapter(() => ({ data: null })) });
    let ran = 0;
    client.use(async (request, next) => {
      ran += 1;
      return next(request);
    });

    await client.get('/a');
    await client.get('/b');

    expect(ran).toBe(2);
  });
});

describe('HttpClient — extend()', () => {
  it('creates an independent client — a plugin registered on the parent after extend() does not run on the child', async () => {
    const parent = new HttpClient({ adapter: fakeAdapter(() => ({ data: null })) });
    const child = parent.extend({});

    let parentRuns = 0;
    parent.use(async (request, next) => {
      parentRuns += 1;
      return next(request);
    });

    await child.get('/x');

    expect(parentRuns).toBe(0);
  });

  it('inherits baseURL from the parent unless overridden', async () => {
    let seenUrl: string | undefined;
    const parent = new HttpClient({
      adapter: fakeAdapter((request) => {
        seenUrl = request.url;
        return { data: null };
      }),
      baseURL: 'https://a.com/api',
    });
    const child = parent.extend({});

    await child.get('/users');

    expect(seenUrl).toBe('https://a.com/api/users');
  });

  it('overrides baseURL when given one explicitly', async () => {
    let seenUrl: string | undefined;
    const parent = new HttpClient({
      adapter: fakeAdapter((request) => {
        seenUrl = request.url;
        return { data: null };
      }),
      baseURL: 'https://a.com/api',
    });
    const child = parent.extend({ baseURL: 'https://b.com/api' });

    await child.get('/users');

    expect(seenUrl).toBe('https://b.com/api/users');
  });
});
