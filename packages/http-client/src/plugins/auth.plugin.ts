import { metaOptOut } from '../core/request';
import { PluginOrder } from '../core/types';
import type { Awaitable, HttpPlugin, HttpRequest } from '../core/types';

/** Produces the outgoing request with credentials attached — a Bearer header, a signature, whatever the strategy needs. */
export type Authenticator = (request: HttpRequest) => Awaitable<HttpRequest>;

export interface AuthOptions {
  /**
   * Skip authentication for requests matching this predicate (e.g. a login endpoint).
   * Defaults to `metaOptOut('auth')` (skips when `meta.auth === false`). Passing your
   * own `skip` **replaces** the default entirely rather than adding to it — to keep
   * both, compose: `skip: (req) => metaOptOut('auth')(req) || req.url.startsWith('/public')`.
   */
  skip?: (request: HttpRequest) => boolean;
  /** Defaults to `PluginOrder.auth`. */
  order?: number;
}

/**
 * Applies `authenticator` to every outgoing request. Deliberately thin: the
 * plugin only knows "produce a request from a request" — everything about
 * *how* (Bearer token, API key, request signing, several strategies
 * combined) lives in the `Authenticator` itself. See `./authenticators.ts`
 * for the built-in presets (`bearer`, `apiKey`, `basic`, `allOf`).
 */
export function auth(authenticator: Authenticator, options: AuthOptions = {}): HttpPlugin {
  const skip = options.skip ?? metaOptOut('auth');

  return {
    name: 'auth',
    order: options.order ?? PluginOrder.auth,
    handler: async (request, next) => {
      if (skip(request)) return next(request);
      return next(await authenticator(request));
    },
  };
}
