import { HttpError } from '../core/http-error';
import { metaOptOut } from '../core/request';
import { PluginOrder } from '../core/types';
import type { HttpPlugin, HttpRequest } from '../core/types';

export interface ErrorMapperOptions {
  /**
   * Skip mapping for requests matching this predicate. Defaults to
   * `metaOptOut('mapError')` (skips when `meta.mapError === false`). Passing your own
   * `skip` **replaces** the default entirely rather than adding to it — to keep both,
   * compose: `skip: (req) => metaOptOut('mapError')(req) || req.url.startsWith('/x')`.
   */
  skip?: (request: HttpRequest) => boolean;
  /** Defaults to `PluginOrder.normalize`. */
  order?: number;
}

/**
 * Maps a server error payload into a domain-specific error. Transport-level
 * normalization (network failure, timeout, non-2xx status) already happened
 * in the adapter — this only reshapes what a caller sees.
 * Registered at `PluginOrder.normalize` by default, outside `recover`/`auth`, so
 * `recover` still inspects the raw `HttpError`; only errors that
 * survive a recovery retry ever reach the mapper.
 */
export function errorMapper(
  map: (error: HttpError) => HttpError | Error,
  options: ErrorMapperOptions = {},
): HttpPlugin {
  const skip = options.skip ?? metaOptOut('mapError');

  return {
    name: 'error-mapper',
    order: options.order ?? PluginOrder.normalize,
    handler: async (request, next) => {
      if (skip(request)) return next(request);
      try {
        return await next(request);
      } catch (caughtError) {
        throw map(HttpError.from(caughtError, request));
      }
    },
  };
}
