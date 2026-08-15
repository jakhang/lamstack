import type { HttpClient } from '../core/client';
import type { Awaitable } from '../core/types';

/**
 * Storage abstraction `tokenSession()` reads/writes the access token through —
 * `localStorage`, React Native's `AsyncStorage`, or a plain `Map` wrapper all qualify.
 */
export interface TokenStore {
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

/**
 * A renew/save callback may either write the new access token into `store` itself and
 * return nothing (in which case the session re-reads it from `store` afterward), or
 * return the token (or `null`) directly — required for a strategy that never persists
 * the access token to `store` at all (e.g. keeping it in memory only, to limit XSS
 * exposure). Returning `undefined`/nothing always means "check the store instead."
 */
export type TokenResult = Awaitable<string | null | void>;

/**
 * The only place that still knows about tokens (SPEC v3 §3.5) — `bearer()`'s source
 * contract needs only `getAccessToken()`; `recover()` needs only `renew()`/`canRenew()`
 * (via `RecoverOptions.recover`/`canRecover`); cleanup on final failure is `end()`,
 * wired explicitly via `events.on('recovery:failed', () => session.end())` rather than
 * called automatically — `recover()` doesn't know this object has state to clean up.
 */
export interface TokenSession {
  getAccessToken(): Awaitable<string | null>;
  /** Runs the configured renew callback, then updates the access token from its result. */
  renew(): Promise<void>;
  /** Whether a renew attempt is worth trying at all. */
  canRenew(): Awaitable<boolean>;
  /**
   * Persists tokens from a sign-in (or MFA-verification) response — the same logic
   * `renew()` uses internally, callable directly by feature code after a successful
   * login. A no-op if no `save` option was configured.
   */
  save(payload: unknown): Promise<void>;
  /** Clears the cached and stored access token, plus anything `onEnd` cleans up. */
  end(): Awaitable<void>;
}

export interface TokenSessionOptions {
  store: TokenStore;
  /** The session owns this client — typically built via `mainClient.extend({})` so it carries no auth/recover plugins. */
  client: HttpClient;
  /** Performs the actual renewal (an HTTP call, `firebaseUser.getIdToken(true)`, ...). */
  renew: (client: HttpClient, store: TokenStore) => TokenResult;
  /** Persists tokens from a sign-in response — see `TokenSession.save()`. */
  save?: (payload: unknown, store: TokenStore) => TokenResult;
  /** Store key the access token is read from and written to. Defaults to `'access_token'`. */
  accessTokenKey?: string;
  /** Defaults to always `true` (optimistic — let the renew call itself fail if it can't succeed). */
  canRenew?: (store: TokenStore) => Awaitable<boolean>;
  /** Runs in addition to clearing the access token in `end()` — e.g. removing a separate "signed in" flag or a refresh token. */
  onEnd?: (store: TokenStore) => Awaitable<void>;
}

/** Wraps a `TokenStore` + a renewal strategy into the `TokenSession` contract `auth(bearer(...))`/`recover(...)` are built on. */
export function tokenSession(options: TokenSessionOptions): TokenSession {
  const { store, client, renew: runRenew, save: runSave, canRenew, onEnd } = options;
  const accessTokenKey = options.accessTokenKey ?? 'access_token';

  let cached: string | null = null;

  async function applyResult(result: string | null | void): Promise<void> {
    cached = result === undefined ? await store.getItem(accessTokenKey) : result;
  }

  return {
    async getAccessToken() {
      if (cached) return cached;
      cached = await store.getItem(accessTokenKey);
      return cached;
    },
    async renew() {
      await applyResult(await runRenew(client, store));
    },
    async canRenew() {
      return canRenew ? canRenew(store) : true;
    },
    async save(payload) {
      if (!runSave) return;
      await applyResult(await runSave(payload, store));
    },
    async end() {
      cached = null;
      await store.removeItem(accessTokenKey);
      await onEnd?.(store);
    },
  };
}
