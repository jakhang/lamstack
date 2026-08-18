export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';

export type HttpHeaders = Readonly<Record<string, string>>;

export type HeadersInput = Record<string, string | number | null | undefined>;

type QueryValue = string | number | boolean | Date | null | undefined;

export type QueryParams = Record<string, QueryValue | QueryValue[]>;

/** A value, or a Promise of one — most plugin-facing callbacks accept either. */
export type Awaitable<T> = T | Promise<T>;

/**
 * Free-form bag for plugin behavior toggles (`auth`, `recover`, `mapError`) and
 * consumer data. Plugin-internal state (e.g. a retry-attempt counter) must use a
 * `symbol` key instead of a plain string, so it can never collide with an entry a
 * consumer put here themselves — and, for a plugin a consumer might register more than
 * once on one client (like `recover()`), a fresh `Symbol(...)` created per plugin
 * instance, not the global-registry `Symbol.for(...)`, so separate instances don't
 * silently share the same counter.
 */
export interface HttpMeta {
  auth?: boolean;
  mapError?: boolean;
  recover?: boolean;
  [key: string]: unknown;
  [key: symbol]: unknown;
}

/** Caller-facing request configuration. Every field is optional; `url` may be relative. */
export interface HttpRequestInit<TBody = unknown> {
  url?: string;
  method?: HttpMethod;
  headers?: HeadersInput;
  params?: QueryParams;
  body?: TBody;
  signal?: AbortSignal;
  timeout?: number;
  credentials?: 'omit' | 'same-origin' | 'include';
  responseType?: ResponseType;
  paramsSerializer?: (params: QueryParams) => string;
  meta?: HttpMeta;
}

/**
 * Fully resolved request — immutable throughout the pipeline. Adapters only ever
 * receive this type. Produced once, by `resolve()`, before the first middleware runs.
 */
export interface HttpRequest<TBody = unknown> {
  readonly url: string;
  readonly method: HttpMethod;
  readonly headers: HttpHeaders;
  readonly body?: TBody;
  readonly signal?: AbortSignal;
  /** 0 means unlimited. */
  readonly timeout: number;
  readonly credentials: 'omit' | 'same-origin' | 'include';
  readonly responseType: ResponseType;
  readonly meta: HttpMeta;
}

export interface HttpResponse<T = unknown> {
  readonly data: T;
  readonly status: number;
  readonly statusText: string;
  readonly headers: HttpHeaders;
  readonly request: HttpRequest;
  /** Adapter-specific object (`Response`, `AxiosResponse`). Escape hatch only — core must never depend on it. */
  readonly raw?: unknown;
}

export type Next = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * `next()` is re-entrant: a middleware may call it more than once, and each call
 * re-runs only the inner portion of the pipeline (not the whole chain from the top).
 * This is what makes refresh-and-retry work without re-running outer middleware.
 */
export type Middleware = (request: HttpRequest, next: Next) => Promise<HttpResponse>;

export interface HttpPlugin {
  readonly name: string;
  /** Smaller values execute further outside the pipeline. */
  readonly order: number;
  readonly handler: Middleware;
}

/**
 * Public, semver-stable ordering slots. `retry` is reserved for a v1.1 `retryPlugin` —
 * no built-in plugin uses that slot yet, but the number is fixed so it can be added
 * later without renumbering.
 */
export const PluginOrder = {
  observe: -200,
  normalize: -100,
  recover: 0,
  retry: 50,
  auth: 100,
  transport: 200,
} as const;

export interface AdapterCapabilities {
  uploadProgress: boolean;
  downloadProgress: boolean;
  stream: boolean;
}

export interface HttpAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  send<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
}
