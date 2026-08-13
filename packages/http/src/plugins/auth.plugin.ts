import { PluginOrder } from '../core/types';
import type { HttpPlugin } from '../core/types';
import type { TokenProvider } from './token-provider';

export interface AuthPluginOptions {
  /** Header to set the token on. Defaults to `'authorization'`. */
  header?: string;
  /** Prefix before the token value (e.g. `'Bearer'`). Pass `''` to set the raw token with no scheme. Defaults to `'Bearer'`. */
  scheme?: string;
}

/**
 * Attaches the current access token to every outgoing request. Built entirely
 * on the public `TokenProvider` contract — holds no capability a
 * user-authored plugin couldn't replicate. Skips itself when a request's
 * `meta.auth` is explicitly `false`.
 */
export function auth(provider: TokenProvider, options: AuthPluginOptions = {}): HttpPlugin {
  const header = (options.header ?? 'authorization').toLowerCase();
  const scheme = options.scheme ?? 'Bearer';

  return {
    name: 'auth',
    order: PluginOrder.auth,
    handler: async (request, next) => {
      if (request.meta.auth === false) return next(request);

      const decorated = provider.decorate ? provider.decorate(request) : request;
      const token = await provider.getAccessToken();
      if (!token) return next(decorated);

      return next({
        ...decorated,
        headers: { ...decorated.headers, [header]: scheme ? `${scheme} ${token}` : token },
      });
    },
  };
}
