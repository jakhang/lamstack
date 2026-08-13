import type { HttpRequest, HttpRequestInit } from '../core/types';

export type Awaitable<T> = T | Promise<T>;

/**
 * Contract for a token storage/refresh strategy. `authPlugin`/`refreshPlugin`
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
