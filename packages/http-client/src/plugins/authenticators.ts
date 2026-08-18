import { withHeaders } from '../core/request';
import type { Awaitable } from '../core/types';
import type { Authenticator } from './auth.plugin';

export interface BearerOptions {
  /** Header to set the token on. Defaults to `'authorization'`. */
  header?: string;
  /** Prefix before the token value (e.g. `'Bearer'`). Pass `''` to set the raw token with no scheme. Defaults to `'Bearer'`. */
  scheme?: string;
}

export type BearerSource =
  { getAccessToken(): Awaitable<string | null> } | (() => Awaitable<string | null>);

/** Attaches the current access token as a header — the common case. Accepts anything with a `getAccessToken()`, or a plain function. */
export function bearer(source: BearerSource, options: BearerOptions = {}): Authenticator {
  const header = options.header ?? 'authorization';
  const scheme = options.scheme ?? 'Bearer';
  const getAccessToken = typeof source === 'function' ? source : () => source.getAccessToken();

  return async (request) => {
    const token = await getAccessToken();
    if (!token) return request;
    return withHeaders(request, { [header]: scheme ? `${scheme} ${token}` : token });
  };
}

export interface ApiKeyOptions {
  /** Where to place the key. */
  in: 'header' | 'query';
  /** Header or query parameter name. */
  name: string;
  value: string | (() => Awaitable<string>);
}

/** Attaches a static or dynamically-resolved API key, either as a header or a query parameter. */
export function apiKey(options: ApiKeyOptions): Authenticator {
  return async (request) => {
    const value = typeof options.value === 'function' ? await options.value() : options.value;

    if (options.in === 'header') {
      return withHeaders(request, { [options.name]: value });
    }

    const pair = `${encodeURIComponent(options.name)}=${encodeURIComponent(value)}`;
    return {
      ...request,
      url: request.url.includes('?') ? `${request.url}&${pair}` : `${request.url}?${pair}`,
    };
  };
}

/** Attaches a static `Authorization: Basic <base64>` header from a username/password pair. */
export function basic(username: string, password: string): Authenticator {
  // `btoa` is Latin-1-only and throws on anything outside it, but RFC 7617 permits UTF-8
  // credentials — encode to UTF-8 bytes first, then feed btoa each byte as its own
  // Latin-1 code unit (safe: every byte is 0-255), so it never sees a character it can't
  // represent. `TextEncoder`/`TextDecoder` are plain JS globals in both Node and browsers,
  // not DOM-only, so this stays typecheckable under the no-DOM build (tsconfig.nodom.json).
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const token = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  return async (request) => withHeaders(request, { authorization: `Basic ${token}` });
}

/** Composes several authenticators, applying each in order to the previous one's output. */
export function allOf(...authenticators: Authenticator[]): Authenticator {
  return async (request) => {
    let current = request;
    for (const authenticator of authenticators) {
      current = await authenticator(current);
    }
    return current;
  };
}
