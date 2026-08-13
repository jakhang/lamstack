import { HttpError } from '../core/http-error';
import { PluginOrder } from '../core/types';
import type { HttpPlugin } from '../core/types';

/**
 * Maps a server error payload into a domain-specific error. Transport-level
 * normalization (network failure, timeout, non-2xx status) already happened
 * in the adapter (SPEC.md §2.2) — this only reshapes what a caller sees.
 * Registered at `PluginOrder.normalize`, outside `refresh`/`auth`, so
 * `refresh` still inspects the raw `HttpError`; only errors that
 * survive a refresh retry ever reach the mapper.
 */
export function errorMapper(map: (error: HttpError) => HttpError | Error): HttpPlugin {
  return {
    name: 'error-mapper',
    order: PluginOrder.normalize,
    handler: async (request, next) => {
      if (request.meta.mapError === false) return next(request);
      try {
        return await next(request);
      } catch (caughtError) {
        throw map(HttpError.from(caughtError, request));
      }
    },
  };
}
