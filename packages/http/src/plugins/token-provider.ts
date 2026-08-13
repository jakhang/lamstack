import type { HttpError } from '../core/http-error';
import type { HttpRequest, HttpRequestInit } from '../core/types';

export type Awaitable<T> = T | Promise<T>;

/**
 * Contract for a token storage/refresh strategy. `auth`/`refresh`
 * are built entirely on this interface — a consumer's own implementation has
 * exactly the same capabilities as the two shipped strategies
 * (`LocalStorageTokenProvider`, `CookieHttpOnlyTokenProvider`, Task 7).
 */
export interface TokenProvider {
  /** The current access token, or `null` if there isn't one. */
  getAccessToken(): Awaitable<string | null>;
  /** Parses and persists tokens from a refresh (or sign-in) response body. */
  saveTokens(payload: unknown): Awaitable<void>;
  /** Clears all stored tokens — called on logout or when refresh ultimately fails. */
  clear(): Awaitable<void>;
  /** Whether a refresh attempt is possible at all (e.g. a refresh token exists). */
  canRefresh(): Awaitable<boolean>;
  /** Builds the request used to refresh tokens. */
  buildRefreshRequest(): Awaitable<HttpRequestInit>;
  /** Optional: modify the outgoing request outside of Authorization handling (e.g. `credentials: 'include'` for a cookie-based strategy). */
  decorate?(request: HttpRequest): HttpRequest;
}

export interface RefreshPolicyContext {
  error: HttpError;
  request: HttpRequest;
  /** How many refresh cycles this request has already gone through (0 on the first failure). */
  attempt: number;
}

/** Decides whether `refresh` should attempt a refresh for a given failure. */
export type RefreshPolicy = (context: RefreshPolicyContext) => Awaitable<boolean>;

export interface DefaultRefreshPolicyOptions {
  /** HTTP statuses that are candidates for a refresh. Defaults to `[401]`. */
  statuses?: number[];
  /**
   * Requests whose (resolved) `url` matches one of these are never eligible
   * for refresh — typically the login endpoint and the refresh endpoint
   * itself, to avoid a refresh loop.
   */
  excludePaths?: (string | RegExp)[];
}

/** Ported from the dashboard's `DefaultTokenRefreshPolicy` — 401-only, excludes configured paths. */
export function defaultRefreshPolicy(options: DefaultRefreshPolicyOptions = {}): RefreshPolicy {
  const statuses = options.statuses ?? [401];
  const excludePaths = options.excludePaths ?? [];

  return ({ error, request }) => {
    if (!statuses.includes(error.status)) return false;
    for (const pattern of excludePaths) {
      const matches = typeof pattern === 'string' ? request.url.includes(pattern) : pattern.test(request.url);
      if (matches) return false;
    }
    return true;
  };
}

/**
 * Storage abstraction (`localStorage`, `AsyncStorage`, an in-memory `Map`,
 * ...) both shipped `TokenProvider` strategies are built on — swap this to
 * change where tokens live without touching the provider itself.
 */
export interface Storage {
  getItem(key: string): Awaitable<string | null>;
  setItem(key: string, value: string): Awaitable<void>;
  removeItem(key: string): Awaitable<void>;
}

/** Extracts an access token string from a refresh/sign-in response payload, or `null` if not found. */
export type AccessTokenParser = (payload: unknown) => string | null;

/**
 * Looks for an access token in common response shapes, in priority order:
 * `{ accessToken }`, `{ data: { accessToken } }`, `{ access_token }`.
 */
export const defaultAccessTokenParser: AccessTokenParser = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.accessToken === 'string') return record.accessToken;
  const data = record.data as Record<string, unknown> | undefined;
  if (data && typeof data.accessToken === 'string') return data.accessToken;
  if (typeof record.access_token === 'string') return record.access_token;
  return null;
};
