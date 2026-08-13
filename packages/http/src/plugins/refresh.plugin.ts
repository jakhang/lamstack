import type { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import { PluginOrder } from '../core/types';
import type { HttpPlugin, HttpRequest } from '../core/types';
import { defaultRefreshPolicy, type RefreshPolicy, type TokenProvider } from './token-provider';

const REFRESH_ATTEMPT = Symbol.for('lamstack.http.refreshAttempt');

export interface RefreshPluginOptions {
  tokenProvider: TokenProvider;
  /**
   * A client with no auth/refresh plugins attached, used to call the refresh
   * endpoint — typically `mainClient.extend({})` called *before* `use(authPlugin(...))`/
   * `use(refreshPlugin(...))` are added to the main client, so it inherits
   * nothing that would recurse.
   */
  refreshClient: HttpClient;
  shouldRefresh?: RefreshPolicy;
  /** Maximum refresh cycles per logical request. Defaults to 1. */
  maxAttempts?: number;
}

function getAttempt(request: HttpRequest): number {
  return (request.meta[REFRESH_ATTEMPT] as number | undefined) ?? 0;
}

/**
 * Detects an eligible failure, refreshes the token, and retries the original
 * request — via a re-entrant `next()` call, never by re-entering the pipeline
 * from the top, so outer middleware never re-runs on retry (see
 * `core/pipeline.ts`). Built entirely on the public `TokenProvider` contract;
 * holds no capability a user-authored plugin couldn't replicate.
 */
export function refreshPlugin(options: RefreshPluginOptions): HttpPlugin {
  const { tokenProvider, refreshClient, maxAttempts = 1 } = options;
  const shouldRefresh = options.shouldRefresh ?? defaultRefreshPolicy();

  return {
    name: 'refresh',
    order: PluginOrder.refresh,
    handler: async (request, next) => {
      let currentRequest = request;

      while (true) {
        try {
          return await next(currentRequest);
        } catch (caughtError) {
          const error = HttpError.from(caughtError, currentRequest);

          if (currentRequest.meta.refresh === false) throw error;

          const attempt = getAttempt(currentRequest);
          if (attempt >= maxAttempts) throw error;

          const eligible = await shouldRefresh({ error, request: currentRequest, attempt });
          if (!eligible) throw error;

          const canRefresh = await tokenProvider.canRefresh();
          if (!canRefresh) {
            await tokenProvider.clear();
            throw error;
          }

          try {
            const refreshInit = await tokenProvider.buildRefreshRequest();
            const refreshResponse = await refreshClient.request(refreshInit);
            await tokenProvider.saveTokens(refreshResponse.data);
          } catch (refreshError) {
            await tokenProvider.clear();
            throw new HttpError(error.message, {
              code: error.code,
              status: error.status,
              data: error.data,
              request: error.request,
              response: error.response,
              cause: refreshError,
            });
          }

          currentRequest = {
            ...currentRequest,
            meta: { ...currentRequest.meta, [REFRESH_ATTEMPT]: attempt + 1 },
          };
        }
      }
    },
  };
}
