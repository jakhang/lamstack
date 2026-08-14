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

/**
 * The only place that still knows about tokens (SPEC v3 §3.5) — `bearer()`'s source
 * contract needs only `getAccessToken()`; `recover()` needs only `renew()`/`canRenew()`
 * (via `RecoverOptions.recover`/`canRecover`); cleanup on final failure is `end()`,
 * wired explicitly via `events.on('recovery:failed', () => session.end())` rather than
 * called automatically — `recover()` doesn't know this object has state to clean up.
 */
export interface TokenSession {
  getAccessToken(): Awaitable<string | null>;
  /** Runs the configured renew callback, then re-reads the access token from the store. */
  renew(): Promise<void>;
  /** Whether a renew attempt is worth trying at all. */
  canRenew(): Awaitable<boolean>;
  /** Clears the cached and stored access token. */
  end(): Awaitable<void>;
}

export interface TokenSessionOptions {
  store: TokenStore;
  /** The session owns this client — typically built via `mainClient.extend({})` so it carries no auth/recover plugins. */
  client: HttpClient;
  /** Performs the actual renewal (an HTTP call, `firebaseUser.getIdToken(true)`, ...) and writes the new access token into `store` itself. */
  renew: (client: HttpClient, store: TokenStore) => Promise<void>;
  /** Store key the access token is read from and written to. Defaults to `'access_token'`. */
  accessTokenKey?: string;
  /** Defaults to always `true` (optimistic — let the renew call itself fail if it can't succeed). */
  canRenew?: (store: TokenStore) => Awaitable<boolean>;
}

/** Wraps a `TokenStore` + a renewal strategy into the `TokenSession` contract `auth(bearer(...))`/`recover(...)` are built on. */
export function tokenSession(options: TokenSessionOptions): TokenSession {
  const { store, client, renew: runRenew, canRenew } = options;
  const accessTokenKey = options.accessTokenKey ?? 'access_token';

  let cached: string | null = null;

  return {
    async getAccessToken() {
      if (cached) return cached;
      cached = await store.getItem(accessTokenKey);
      return cached;
    },
    async renew() {
      await runRenew(client, store);
      cached = await store.getItem(accessTokenKey);
    },
    async canRenew() {
      return canRenew ? canRenew(store) : true;
    },
    async end() {
      cached = null;
      await store.removeItem(accessTokenKey);
    },
  };
}
