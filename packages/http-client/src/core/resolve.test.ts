import { describe, expect, it } from 'vitest';
import { resolve } from './resolve';

describe('resolve — baseURL', () => {
  it('combines a relative url with baseURL, preserving the baseURL path prefix (axios-style, not literal `new URL()` semantics)', () => {
    const req = resolve({ url: '/users' }, { baseURL: 'https://a.com/api' });
    expect(req.url).toBe('https://a.com/api/users');
  });

  it('an absolute http(s) url ignores baseURL entirely', () => {
    const req = resolve({ url: 'https://other.com/x' }, { baseURL: 'https://a.com/api' });
    expect(req.url).toBe('https://other.com/x');
  });

  it('resolves with no baseURL when url is already absolute', () => {
    const req = resolve({ url: 'https://a.com/x' });
    expect(req.url).toBe('https://a.com/x');
  });
});

describe('resolve — slash handling', () => {
  it('joins baseURL with no trailing slash and url with no leading slash', () => {
    const req = resolve({ url: 'users' }, { baseURL: 'https://a.com/api' });
    expect(req.url).toBe('https://a.com/api/users');
  });

  it('joins baseURL with trailing slash and url with leading slash without doubling the slash', () => {
    const req = resolve({ url: '/users' }, { baseURL: 'https://a.com/api/' });
    expect(req.url).toBe('https://a.com/api/users');
  });
});

describe('resolve — header precedence', () => {
  it('merges default headers with request headers, request headers winning', () => {
    const req = resolve(
      { url: '/x', headers: { 'X-Foo': 'request' } },
      { headers: { 'X-Foo': 'default', 'X-Bar': 'default' } },
    );
    expect(req.headers).toEqual({ 'x-foo': 'request', 'x-bar': 'default' });
  });

  it('a null/undefined header value at the request layer removes a default header', () => {
    const req = resolve(
      { url: '/x', headers: { 'X-Foo': null } },
      { headers: { 'X-Foo': 'default' } },
    );
    expect(req.headers).toEqual({});
  });

  it('normalizes all header keys to lowercase', () => {
    const req = resolve({ url: '/x', headers: { 'Content-Type': 'application/json' } });
    expect(req.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('keys that become equal after lowercasing overwrite earlier values, later layer wins', () => {
    const req = resolve(
      { url: '/x', headers: { 'x-foo': 'request' } },
      { headers: { 'X-Foo': 'default' } },
    );
    expect(req.headers).toEqual({ 'x-foo': 'request' });
  });

  it('coerces a numeric header value to a string', () => {
    const req = resolve({ url: '/x', headers: { 'X-Count': 3 } });
    expect(req.headers).toEqual({ 'x-count': '3' });
  });
});

describe('resolve — params', () => {
  it('omits null and undefined param values', () => {
    const req = resolve({ url: '/x', params: { a: 1, b: null, c: undefined } });
    expect(req.url).toBe('/x?a=1');
  });

  it('repeats the key for array param values', () => {
    const req = resolve({ url: '/x', params: { id: [1, 2] } });
    expect(req.url).toBe('/x?id=1&id=2');
  });

  it('serializes Date param values as ISO strings', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const req = resolve({ url: '/x', params: { since: date } });
    expect(req.url).toBe(`/x?since=${encodeURIComponent(date.toISOString())}`);
  });

  it('merges params onto an existing query string instead of replacing it', () => {
    const req = resolve({ url: '/x?a=1', params: { b: 2 } });
    expect(req.url).toBe('/x?a=1&b=2');
  });
});

describe('resolve — defaults', () => {
  it('defaults method to GET', () => {
    const req = resolve({ url: '/x' });
    expect(req.method).toBe('GET');
  });

  it('uppercases an explicit method', () => {
    const req = resolve({ url: '/x', method: 'post' as never });
    expect(req.method).toBe('POST');
  });

  it('defaults timeout to 0 (unlimited)', () => {
    const req = resolve({ url: '/x' });
    expect(req.timeout).toBe(0);
  });

  it('defaults credentials to same-origin', () => {
    const req = resolve({ url: '/x' });
    expect(req.credentials).toBe('same-origin');
  });

  it('defaults responseType to json', () => {
    const req = resolve({ url: '/x' });
    expect(req.responseType).toBe('json');
  });

  it('defaults meta to an empty object', () => {
    const req = resolve({ url: '/x' });
    expect(req.meta).toEqual({});
  });
});
