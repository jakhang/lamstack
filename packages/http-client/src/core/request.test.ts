import { describe, expect, it } from 'vitest';
import { resolve } from './resolve';
import { withHeaders, withMeta } from './request';

describe('withHeaders', () => {
  it('lowercases new header keys', () => {
    const request = resolve({ url: '/x' });
    const updated = withHeaders(request, { 'X-Foo': 'bar' });
    expect(updated.headers).toEqual({ 'x-foo': 'bar' });
  });

  it('overwrites an existing key that differs only in case, ending with exactly one key', () => {
    const request = resolve({ url: '/x', headers: { 'x-foo': 'old' } });
    const updated = withHeaders(request, { 'X-Foo': 'new' });
    expect(updated.headers).toEqual({ 'x-foo': 'new' });
    expect(Object.keys(updated.headers)).toHaveLength(1);
  });

  it('a null value deletes an existing key', () => {
    const request = resolve({ url: '/x', headers: { 'x-foo': 'bar' } });
    const updated = withHeaders(request, { 'x-foo': null });
    expect(updated.headers).toEqual({});
  });

  it('does not mutate the original request', () => {
    const request = resolve({ url: '/x', headers: { 'x-foo': 'bar' } });
    const snapshot = { ...request.headers };

    withHeaders(request, { 'x-foo': 'changed', 'x-new': 'value' });

    expect(request.headers).toEqual(snapshot);
  });

  it('preserves every other field, including signal', () => {
    const controller = new AbortController();
    const request = resolve({ url: '/x', signal: controller.signal, timeout: 500 });

    const updated = withHeaders(request, { 'x-foo': 'bar' });

    expect(updated.signal).toBe(controller.signal);
    expect(updated.timeout).toBe(500);
    expect(updated.url).toBe(request.url);
    expect(updated.method).toBe(request.method);
  });
});

describe('withMeta', () => {
  it('shallow-merges new string keys onto existing meta', () => {
    const request = resolve({ url: '/x', meta: { auth: false } });
    const updated = withMeta(request, { mapError: false });
    expect(updated.meta).toEqual({ auth: false, mapError: false });
  });

  it('preserves an existing Symbol.for(...) key when merging new string keys', () => {
    const SYM = Symbol.for('lamstack.http.test.attempt');
    const request = withMeta(resolve({ url: '/x' }), { [SYM]: 1 });

    const updated = withMeta(request, { auth: false });

    expect(updated.meta[SYM]).toBe(1);
    expect(updated.meta.auth).toBe(false);
  });

  it('preserves existing string keys when merging a new Symbol.for(...) key', () => {
    const SYM = Symbol.for('lamstack.http.test.attempt');
    const request = resolve({ url: '/x', meta: { auth: false } });

    const updated = withMeta(request, { [SYM]: 1 });

    expect(updated.meta.auth).toBe(false);
    expect(updated.meta[SYM]).toBe(1);
  });

  it('does not mutate the original request', () => {
    const request = resolve({ url: '/x', meta: { auth: false } });
    const snapshot = { ...request.meta };

    withMeta(request, { auth: true, mapError: false });

    expect(request.meta).toEqual(snapshot);
  });

  it('preserves every other field', () => {
    const request = resolve({ url: '/x', timeout: 500 });
    const updated = withMeta(request, { auth: false });
    expect(updated.url).toBe(request.url);
    expect(updated.timeout).toBe(500);
    expect(updated.headers).toBe(request.headers);
  });
});
