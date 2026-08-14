import type { HttpRequest, HttpRequestInit } from '../core/types';
import { defaultAccessTokenParser } from './token-provider';
import type { AccessTokenParser, Storage, TokenProvider } from './token-provider';

const SIGNED_IN_FLAG = 'SIGNED_IN';

export interface CookieHttpOnlyTokenProviderOptions {
  store: Storage;
  /** URL the refresh request is sent to. */
  refreshUrl: string;
  parser?: AccessTokenParser;
}

/**
 * For backends that issue the refresh token as an HttpOnly cookie the
 * browser sends automatically. The access token is kept in memory only
 * (never persisted, to reduce XSS exposure) — it's expected to be re-issued
 * via a silent refresh on every page load.
 */
export class CookieHttpOnlyTokenProvider implements TokenProvider {
  private accessToken: string | null = null;
  private readonly store: Storage;
  private readonly refreshUrl: string;
  private readonly parseAccessToken: AccessTokenParser;

  constructor(options: CookieHttpOnlyTokenProviderOptions) {
    this.store = options.store;
    this.refreshUrl = options.refreshUrl;
    this.parseAccessToken = options.parser ?? defaultAccessTokenParser;
  }

  async getAccessToken(): Promise<string | null> {
    return this.accessToken;
  }

  /**
   * Web sign-in responses are typically bodyless (the refresh token lives in
   * the HttpOnly cookie the browser just received) — being called at all
   * after a non-MFA auth response is itself the signal the session is
   * active, regardless of whether an access token was found in the payload.
   */
  async saveTokens(payload: unknown): Promise<void> {
    const accessToken = this.parseAccessToken(payload);
    if (accessToken) {
      this.accessToken = accessToken;
    }
    await this.store.setItem(SIGNED_IN_FLAG, 'true');
  }

  /** Clears the in-memory token only — the backend must clear the HttpOnly cookie itself via a logout endpoint. */
  async clear(): Promise<void> {
    this.accessToken = null;
    await this.store.removeItem(SIGNED_IN_FLAG);
  }

  /**
   * Always `true` once signed in: JavaScript can't read an HttpOnly cookie to
   * verify the refresh token still exists, so this assumes it does and lets
   * the backend reject the refresh request if it doesn't.
   */
  async canRefresh(): Promise<boolean> {
    const value = await this.store.getItem(SIGNED_IN_FLAG);
    return !!value;
  }

  /** No body — the refresh token travels automatically as a cookie the browser attaches. */
  async buildRefreshRequest(): Promise<HttpRequestInit> {
    return { url: this.refreshUrl, method: 'GET', credentials: 'include' };
  }

  /** Ensures cookies are sent on every request for this strategy. */
  decorate(request: HttpRequest): HttpRequest {
    return { ...request, credentials: 'include' };
  }
}
