import type { Awaitable, HttpRequest, HttpRequestInit } from '../core/types';

/**
 * Contract for a token storage/refresh strategy, implemented by
 * `LocalStorageTokenProvider`/`CookieHttpOnlyTokenProvider`. Its
 * `getAccessToken()` alone satisfies `bearer()`'s source contract, so any
 * `TokenProvider` slots directly into `auth(bearer(provider))` — a
 * consumer's own implementation has exactly the same capabilities.
 * `decorate` is a legacy escape hatch kept for these two strategies; new
 * code should prefer `HttpClientOptions.credentials` instead (see
 * `CookieHttpOnlyTokenProvider`).
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
