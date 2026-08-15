import { mergeHeaders } from './headers';
import type {
  HeadersInput,
  HttpMeta,
  HttpRequest,
  HttpRequestInit,
  QueryParams,
  ResponseType,
} from './types';

export interface ResolveDefaults {
  baseURL?: string;
  headers?: HeadersInput;
  timeout?: number;
  credentials?: 'omit' | 'same-origin' | 'include';
  responseType?: ResponseType;
  paramsSerializer?: (params: QueryParams) => string;
}

const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:\/\//i;

function resolveUrl(url: string, baseURL: string | undefined): string {
  if (!baseURL || ABSOLUTE_URL.test(url)) return url;
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  const path = url.startsWith('/') ? url.slice(1) : url;
  // `new URL(path, base)` requires an absolute base and throws otherwise — but a relative
  // baseURL ('/api', the default shape for a same-origin SPA, or even a protocol-relative
  // '//cdn.example.com') is a legitimate, documented case (see the README's extend()
  // example), not an error. Join by string instead; the no-doubled/no-missing-slash
  // guarantee above (trailing on base, leading on path) already makes that safe.
  if (!ABSOLUTE_URL.test(baseURL)) return `${base}${path}`;
  return new URL(path, base).toString();
}

function defaultParamsSerializer(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === null || item === undefined) continue;
      search.append(key, item instanceof Date ? item.toISOString() : String(item));
    }
  }
  return search.toString();
}

function appendParams(
  url: string,
  params: QueryParams | undefined,
  serializer: (params: QueryParams) => string,
): string {
  if (!params || Object.keys(params).length === 0) return url;
  const query = serializer(params);
  if (!query) return url;
  if (url.endsWith('?')) return `${url}${query}`;
  return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

/**
 * Resolves caller-facing `HttpRequestInit` (+ client-level defaults) into an
 * immutable `HttpRequest`. Runs exactly once, before the first middleware — see
 * README's "Resolution rules" table for the full rules this implements.
 */
export function resolve<TBody = unknown>(
  init: HttpRequestInit<TBody>,
  defaults: ResolveDefaults = {},
): HttpRequest<TBody> {
  const serializer = init.paramsSerializer ?? defaults.paramsSerializer ?? defaultParamsSerializer;
  const url = appendParams(resolveUrl(init.url ?? '', defaults.baseURL), init.params, serializer);

  const meta: HttpMeta = { ...init.meta };

  return {
    url,
    method: (init.method ?? 'GET').toUpperCase() as HttpRequest['method'],
    headers: mergeHeaders(defaults.headers, init.headers),
    body: init.body,
    signal: init.signal,
    timeout: init.timeout ?? defaults.timeout ?? 0,
    credentials: init.credentials ?? defaults.credentials ?? 'same-origin',
    responseType: init.responseType ?? defaults.responseType ?? 'json',
    meta,
  };
}
