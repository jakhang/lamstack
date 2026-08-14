import type { HttpRequestInit } from '../core/types';
import { defaultAccessTokenParser } from './token-provider';
import type { AccessTokenParser, Storage, TokenProvider } from './token-provider';

export interface LocalStorageTokenProviderOptions {
  store: Storage;
  /** URL the refresh request is sent to. */
  refreshUrl: string;
  parser?: AccessTokenParser;
  accessTokenKey?: string;
  refreshTokenKey?: string;
}

/**
 * For backends that return `accessToken`/`refreshToken` in the JSON response
 * body (as opposed to an HttpOnly cookie — see `CookieHttpOnlyTokenProvider`
 * for that strategy). The refresh token is persisted in `store` and sent
 * back as `{ refreshToken }` in the refresh request body.
 */
export class LocalStorageTokenProvider implements TokenProvider {
  private accessToken: string | null = null;
  private readonly store: Storage;
  private readonly refreshUrl: string;
  private readonly parseAccessToken: AccessTokenParser;
  private readonly accessTokenKey: string;
  private readonly refreshTokenKey: string;

  constructor(options: LocalStorageTokenProviderOptions) {
    this.store = options.store;
    this.refreshUrl = options.refreshUrl;
    this.parseAccessToken = options.parser ?? defaultAccessTokenParser;
    this.accessTokenKey = options.accessTokenKey ?? 'access_token';
    this.refreshTokenKey = options.refreshTokenKey ?? 'refresh_token';
  }

  async getAccessToken(): Promise<string | null> {
    if (this.accessToken) return this.accessToken;
    this.accessToken = await this.store.getItem(this.accessTokenKey);
    return this.accessToken;
  }

  /**
   * Saves the access token (via the configured parser) and, if present, the
   * refresh token. Called both by `refresh` internally and explicitly
   * by feature code after sign-in/MFA verification.
   */
  async saveTokens(payload: unknown): Promise<void> {
    const accessToken = this.parseAccessToken(payload);
    if (accessToken) {
      this.accessToken = accessToken;
      await this.store.setItem(this.accessTokenKey, accessToken);
    }

    const refreshToken = (payload as { refreshToken?: string } | null)?.refreshToken;
    if (refreshToken) {
      await this.store.setItem(this.refreshTokenKey, refreshToken);
    }
  }

  async clear(): Promise<void> {
    this.accessToken = null;
    await this.store.removeItem(this.accessTokenKey);
    await this.store.removeItem(this.refreshTokenKey);
  }

  async canRefresh(): Promise<boolean> {
    const refreshToken = await this.store.getItem(this.refreshTokenKey);
    return !!refreshToken;
  }

  async buildRefreshRequest(): Promise<HttpRequestInit> {
    const refreshToken = await this.store.getItem(this.refreshTokenKey);
    return { url: this.refreshUrl, method: 'POST', body: { refreshToken } };
  }
}
