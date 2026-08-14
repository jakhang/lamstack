  import type { HttpPlugin, HttpRequest, HttpResponse, Middleware, Next } from './types';

function isHttpPlugin(entry: Middleware | HttpPlugin): entry is HttpPlugin {
  return typeof entry !== 'function';
}

/**
 * Sorts registered entries by `order` (smaller = further outside the pipeline),
 * preserving `use()` insertion order for entries with equal `order`. A plain
 * `Middleware` function (not wrapped in an `HttpPlugin`) defaults to `order: 0`.
 */
export function normalizePlugins(entries: readonly (Middleware | HttpPlugin)[]): Middleware[] {
  return entries
    .map((entry, index) => ({
      handler: isHttpPlugin(entry) ? entry.handler : entry,
      order: isHttpPlugin(entry) ? entry.order : 0,
      index,
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.handler);
}

/**
 * Composes `entries` into a single `Next`-shaped function terminating in
 * `terminal` (the adapter). `next()` passed to each middleware is a plain
 * function — it is re-entrant: calling it more than once re-runs only the inner
 * chain (everything registered after this middleware), never the outer chain
 * that already ran. This is what makes refresh-and-retry work without
 * re-running outer middleware (e.g. an observability plugin) on every retry.
 */
export function compose(entries: readonly (Middleware | HttpPlugin)[], terminal: Next): Next {
  const handlers = normalizePlugins(entries);

  function run(index: number, request: HttpRequest): Promise<HttpResponse> {
    const handler = handlers[index];
    if (!handler) return terminal(request);
    return handler(request, (nextRequest) => run(index + 1, nextRequest));
  }

  return (request) => run(0, request);
}
