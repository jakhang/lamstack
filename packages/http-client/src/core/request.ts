import { mergeHeaders } from './headers';
import type { HeadersInput, HttpMeta, HttpRequest } from './types';

/**
 * A copy of `request` with `headers` merged on top — same normalization rules as
 * `resolve()`: keys lowercased, a `null`/`undefined` value deletes an existing key.
 * Pure: never mutates `request`.
 */
export function withHeaders(request: HttpRequest, headers: HeadersInput): HttpRequest {
  return { ...request, headers: mergeHeaders(request.headers, headers) };
}

/**
 * A copy of `request` with `meta` shallow-merged. Accepts both `string` and `symbol`
 * keys — existing entries of either kind are preserved unless `meta` overwrites them.
 * Pure: never mutates `request`.
 */
export function withMeta(request: HttpRequest, meta: HttpMeta): HttpRequest {
  return { ...request, meta: { ...request.meta, ...meta } };
}

/**
 * A `skip` predicate reading an opt-out flag from `meta`: `true` (skip the plugin) only
 * when `meta[key] === false` exactly — `undefined`/`0`/`''`/`null` do not opt out, so a
 * `meta` bag that simply never touched `key` behaves the same as one that set it to a
 * non-`false` value.
 */
export function metaOptOut(key: keyof HttpMeta): (request: HttpRequest) => boolean {
  return (request) => request.meta[key] === false;
}
