import { HttpError } from '../core/http-error';
import { PluginOrder } from '../core/types';
import type { Awaitable, HttpPlugin, HttpRequest } from '../core/types';
import type { EventBus } from '../core/event-bus';

const ATTEMPT = Symbol.for('lamstack.http.recoveryAttempt');

export interface RecoveryContext {
  error: HttpError;
  request: HttpRequest;
  /** How many recovery cycles this request has already gone through (0 on the first failure). */
  attempt: number;
}

/** Recovery-specific events — deliberately not part of core; `recover()` is the only thing that knows this shape. */
export type RecoveryEventMap = {
  /** Fires once per recovery cycle, never once per queued request. */
  'recovery:succeeded': Record<string, never>;
  /** Fires once per recovery cycle. The consumer is expected to react here — e.g. sign the user out. */
  'recovery:failed': { error: unknown };
  /** Fires once per request whose `canRecover()` check failed — recovery was never attempted. */
  'recovery:unavailable': { error: HttpError };
};

export interface RecoverOptions {
  /** Runs exactly once per cycle, shared by every request queued behind it. */
  recover: (context: RecoveryContext) => Promise<void>;
  /** Decides whether a given failure is eligible for recovery. Defaults to `onStatus(401)`. */
  shouldRecover?: (context: RecoveryContext) => Awaitable<boolean>;
  /** Optional optimization: skip a doomed recovery attempt before it starts. Without it, a failing `recover()` just throws. */
  canRecover?: () => Awaitable<boolean>;
  /** Maximum recovery cycles per logical request. Defaults to 1. */
  maxAttempts?: number;
  events?: EventBus<RecoveryEventMap>;
  order?: number;
}

/** Matches an eligible status (default `401`), excluding requests whose url matches one of `exclude` — typically the recovery endpoint itself, to avoid a loop. */
export function onStatus(
  status: number | number[],
  options: { exclude?: (string | RegExp)[] } = {},
): (context: RecoveryContext) => boolean {
  const statuses = Array.isArray(status) ? status : [status];
  const exclude = options.exclude ?? [];

  return ({ error, request }) => {
    if (!statuses.includes(error.status)) return false;
    for (const pattern of exclude) {
      const matches = typeof pattern === 'string' ? request.url.includes(pattern) : pattern.test(request.url);
      if (matches) return false;
    }
    return true;
  };
}

function getAttempt(request: HttpRequest): number {
  return (request.meta[ATTEMPT] as number | undefined) ?? 0;
}

function withCause(error: HttpError, cause: unknown): HttpError {
  return new HttpError(error.message, {
    code: error.code,
    status: error.status,
    data: error.data,
    request: error.request,
    response: error.response,
    cause,
  });
}

/**
 * Detects an eligible failure, runs a single shared recovery cycle, and
 * retries the original request — via a re-entrant `next()` call, never by
 * re-entering the pipeline from the top, so outer middleware never re-runs on
 * retry (see `core/pipeline.ts`). Knows nothing about tokens: `recover()` is
 * any `() => Promise<void>` — refreshing an OAuth token, calling
 * `firebaseUser.getIdToken(true)`, or resyncing over a BroadcastChannel all
 * fit the same shape.
 *
 * Concurrent requests that fail while a cycle is already in flight share that
 * one attempt (scoped to this plugin instance) rather than each triggering
 * their own — but each still rejects with its own original error on failure,
 * not a value shared across every queued request.
 */
export function recover(options: RecoverOptions): HttpPlugin {
  const { recover: runRecovery, canRecover, maxAttempts = 1, events } = options;
  const shouldRecover = options.shouldRecover ?? onStatus(401);

  let inFlight: Promise<void> | null = null;

  function runOnce(context: RecoveryContext): Promise<void> {
    if (!inFlight) {
      inFlight = (async () => {
        try {
          await runRecovery(context);
          events?.emit('recovery:succeeded', {});
        } catch (error) {
          events?.emit('recovery:failed', { error });
          throw error;
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  }

  return {
    name: 'recover',
    order: options.order ?? PluginOrder.refresh,
    handler: async (request, next) => {
      let current = request;

      while (true) {
        try {
          return await next(current);
        } catch (caught) {
          const error = HttpError.from(caught, current);

          const attempt = getAttempt(current);
          if (attempt >= maxAttempts) throw error;

          const context: RecoveryContext = { error, request: current, attempt };
          if (!(await shouldRecover(context))) throw error;

          if (canRecover && !(await canRecover())) {
            events?.emit('recovery:unavailable', { error });
            throw error;
          }

          try {
            await runOnce(context);
          } catch (recoveryError) {
            throw withCause(error, recoveryError);
          }

          current = { ...current, meta: { ...current.meta, [ATTEMPT]: attempt + 1 } };
        }
      }
    },
  };
}
