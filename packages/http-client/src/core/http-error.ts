import type { HttpRequest, HttpResponse } from './types';

export type HttpErrorCode =
  'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELED' | 'PARSE_ERROR' | 'UNKNOWN';

export interface HttpErrorOptions<T> {
  code: HttpErrorCode;
  /** 0 when there is no HTTP response. */
  status: number;
  data?: T;
  request: HttpRequest;
  response?: HttpResponse<T>;
  cause?: unknown;
}

/**
 * The only error type an `HttpAdapter` may throw — part of the adapter contract,
 * not something a plugin normalizes after the fact. `send()`
 * resolves only for a 2xx response; every other outcome rejects with one of these.
 */
export class HttpError<T = unknown> extends Error {
  // Declared, not assigned: `Error`'s own `cause` (set below via defineProperty, matching
  // its native non-enumerable behavior) already provides the runtime value — this only
  // types it, since the project's ES2020 lib target predates ES2022's Error.cause typings.
  declare readonly cause?: unknown;
  readonly code: HttpErrorCode;
  readonly status: number;
  readonly data?: T;
  readonly request: HttpRequest;
  readonly response?: HttpResponse<T>;

  constructor(message: string, options: HttpErrorOptions<T>) {
    super(message);
    this.name = 'HttpError';
    this.code = options.code;
    this.status = options.status;
    this.data = options.data;
    this.request = options.request;
    this.response = options.response;
    // Non-enumerable, matching native `new Error(message, { cause })` — a plain `this.cause =`
    // assignment would make it enumerable, leaking into JSON.stringify/spread/Object.keys.
    Object.defineProperty(this, 'cause', {
      value: options.cause,
      enumerable: false,
      configurable: true,
    });
    Object.setPrototypeOf(this, HttpError.prototype);
  }

  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  get isCanceled(): boolean {
    return this.code === 'CANCELED';
  }

  static is(error: unknown): error is HttpError {
    return error instanceof HttpError;
  }

  /**
   * Wraps an arbitrary thrown value into an `HttpError`, passing an existing one through
   * unchanged. A compliant `HttpAdapter` only ever throws `HttpError` itself (see the class
   * doc above), so the fallback branch here only fires for something that reached `recover()`/
   * `errorMapper()` *without* going through an adapter — typically a bug in a plugin between
   * them and the adapter. `code: 'UNKNOWN'` reflects that honestly: it is not a network error,
   * and claiming otherwise would make `isNetworkError` lie and could get a real bug silently
   * retried by `recover()`.
   */
  static from(error: unknown, request: HttpRequest): HttpError {
    if (HttpError.is(error)) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new HttpError('Request canceled', {
        code: 'CANCELED',
        status: 0,
        request,
        cause: error,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return new HttpError(message, { code: 'UNKNOWN', status: 0, request, cause: error });
  }
}
