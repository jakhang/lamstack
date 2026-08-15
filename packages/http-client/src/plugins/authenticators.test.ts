import { describe, expect, it } from 'vitest';
import { resolve } from '../core/resolve';
import { allOf, apiKey, basic, bearer } from './authenticators';

describe('bearer', () => {
  it('attaches Authorization: Bearer <token> when the source resolves a token', async () => {
    const authenticator = bearer({ getAccessToken: async () => 'tok123' });
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers.authorization).toBe('Bearer tok123');
  });

  it('accepts a plain function as the source', async () => {
    const authenticator = bearer(async () => 'tok123');
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers.authorization).toBe('Bearer tok123');
  });

  it('leaves the header unset when the source resolves null', async () => {
    const authenticator = bearer({ getAccessToken: async () => null });
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers.authorization).toBeUndefined();
  });

  it('supports a custom header name and an empty scheme', async () => {
    const authenticator = bearer(
      { getAccessToken: async () => 'tok123' },
      { header: 'x-api-key', scheme: '' },
    );
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers['x-api-key']).toBe('tok123');
    expect(request.headers.authorization).toBeUndefined();
  });

  it('overwrites an existing differently-cased header instead of adding a duplicate — a mixed-case header option is still lowercased via withHeaders', async () => {
    const authenticator = bearer({ getAccessToken: async () => 'tok123' }, { header: 'X-Api-Key' });
    const request = await authenticator(resolve({ url: '/x', headers: { 'x-api-key': 'stale' } }));
    expect(request.headers['x-api-key']).toBe('Bearer tok123');
    expect(Object.keys(request.headers)).toHaveLength(1);
  });
});

describe('apiKey', () => {
  it('attaches a static key as a header', async () => {
    const authenticator = apiKey({ in: 'header', name: 'X-Api-Key', value: 'secret' });
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers['x-api-key']).toBe('secret');
  });

  it('attaches a dynamically-resolved key as a header', async () => {
    const authenticator = apiKey({
      in: 'header',
      name: 'x-api-key',
      value: async () => 'dynamic-secret',
    });
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers['x-api-key']).toBe('dynamic-secret');
  });

  it('attaches the key as a query parameter on a url with no existing query string', async () => {
    const authenticator = apiKey({ in: 'query', name: 'key', value: 'secret' });
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.url).toBe('/x?key=secret');
  });

  it('appends the key to a url that already has a query string', async () => {
    const authenticator = apiKey({ in: 'query', name: 'key', value: 'secret' });
    const request = await authenticator(resolve({ url: '/x?a=1' }));
    expect(request.url).toBe('/x?a=1&key=secret');
  });

  it('URL-encodes the key name and value', async () => {
    const authenticator = apiKey({ in: 'query', name: 'my key', value: 'a b' });
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.url).toBe('/x?my%20key=a%20b');
  });
});

describe('basic', () => {
  it('attaches Authorization: Basic <base64(username:password)>', async () => {
    const authenticator = basic('user', 'pass');
    const request = await authenticator(resolve({ url: '/x' }));
    expect(request.headers.authorization).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('supports non-ASCII credentials (RFC 7617 permits UTF-8) instead of throwing on btoa\'s Latin-1-only encoding', async () => {
    const authenticator = basic('user', 'mật khẩu');
    const request = await authenticator(resolve({ url: '/x' }));

    const encoded = request.headers.authorization.replace(/^Basic /, '');
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);

    expect(decoded).toBe('user:mật khẩu');
  });
});

describe('allOf', () => {
  it('applies each authenticator in order, each seeing the previous one’s output', async () => {
    const authenticator = allOf(
      async (request) => ({ ...request, headers: { ...request.headers, 'x-first': 'a' } }),
      async (request) => ({
        ...request,
        headers: { ...request.headers, 'x-second': request.headers['x-first'] },
      }),
    );

    const request = await authenticator(resolve({ url: '/x' }));

    expect(request.headers['x-first']).toBe('a');
    expect(request.headers['x-second']).toBe('a');
  });

  it('with zero authenticators, returns the request unchanged', async () => {
    const authenticator = allOf();
    const original = resolve({ url: '/x' });
    const request = await authenticator(original);
    expect(request).toEqual(original);
  });
});
