import { describe, expect, it } from 'vitest';
import { HttpError } from './http-error';
import { resolve } from './resolve';

const request = resolve({ url: '/x' });

describe('HttpError', () => {
  it('carries code/status/data/request', () => {
    const error = new HttpError('Not Found', { code: 'HTTP_ERROR', status: 404, data: { reason: 'gone' }, request });
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.status).toBe(404);
    expect(error.data).toEqual({ reason: 'gone' });
    expect(error.request).toBe(request);
    expect(error.name).toBe('HttpError');
    expect(error.message).toBe('Not Found');
  });

  it('isNetworkError is true only when status is 0', () => {
    expect(new HttpError('x', { code: 'NETWORK_ERROR', status: 0, request }).isNetworkError).toBe(true);
    expect(new HttpError('x', { code: 'HTTP_ERROR', status: 404, request }).isNetworkError).toBe(false);
  });

  it('isCanceled is true only when code is CANCELED', () => {
    expect(new HttpError('x', { code: 'CANCELED', status: 0, request }).isCanceled).toBe(true);
    expect(new HttpError('x', { code: 'TIMEOUT', status: 0, request }).isCanceled).toBe(false);
  });

  it('exposes the triggering error via .cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new HttpError('Network Error', { code: 'NETWORK_ERROR', status: 0, request, cause });
    expect(error.cause).toBe(cause);
  });

  it('.cause is non-enumerable, matching native Error.cause — it must not leak into JSON.stringify/spread/Object.keys', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new HttpError('Network Error', { code: 'NETWORK_ERROR', status: 0, request, cause });

    expect(Object.getOwnPropertyDescriptor(error, 'cause')?.enumerable).toBe(false);
    expect(Object.keys(error)).not.toContain('cause');
    expect(JSON.stringify({ ...error })).not.toContain('ECONNREFUSED');
  });

  it('HttpError.is() narrows unknown to HttpError', () => {
    const error: unknown = new HttpError('x', { code: 'HTTP_ERROR', status: 500, request });
    expect(HttpError.is(error)).toBe(true);
    expect(HttpError.is(new Error('plain'))).toBe(false);
  });

  describe('HttpError.from()', () => {
    it('returns the same instance when already an HttpError', () => {
      const error = new HttpError('x', { code: 'HTTP_ERROR', status: 500, request });
      expect(HttpError.from(error, request)).toBe(error);
    });

    it('wraps an AbortError as a CANCELED HttpError', () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      const error = HttpError.from(abortError, request);
      expect(error.code).toBe('CANCELED');
      expect(error.status).toBe(0);
      expect(error.cause).toBe(abortError);
    });

    it('wraps any other thrown value as a NETWORK_ERROR HttpError', () => {
      const cause = new Error('getaddrinfo ENOTFOUND');
      const error = HttpError.from(cause, request);
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.status).toBe(0);
      expect(error.cause).toBe(cause);
    });
  });
});
