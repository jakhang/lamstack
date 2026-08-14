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

  it('isNetworkError is true only when code is NETWORK_ERROR — not just because status is 0', () => {
    expect(new HttpError('x', { code: 'NETWORK_ERROR', status: 0, request }).isNetworkError).toBe(true);
    expect(new HttpError('x', { code: 'HTTP_ERROR', status: 404, request }).isNetworkError).toBe(false);
    // CANCELED, TIMEOUT, and UNKNOWN also carry status: 0 — none of them are network errors.
    expect(new HttpError('x', { code: 'CANCELED', status: 0, request }).isNetworkError).toBe(false);
    expect(new HttpError('x', { code: 'TIMEOUT', status: 0, request }).isNetworkError).toBe(false);
    expect(new HttpError('x', { code: 'UNKNOWN', status: 0, request }).isNetworkError).toBe(false);
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

    it('wraps an unrecognized thrown value as an UNKNOWN HttpError, not a network error — recover()/errorMapper() call this on anything they catch, including a bug in user middleware', () => {
      const cause = new Error('something a plugin threw that has nothing to do with the network');
      const error = HttpError.from(cause, request);
      expect(error.code).toBe('UNKNOWN');
      expect(error.status).toBe(0);
      expect(error.isNetworkError).toBe(false);
      expect(error.cause).toBe(cause);
    });
  });
});
