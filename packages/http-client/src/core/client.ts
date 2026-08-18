import { compose } from './pipeline';
import { resolve, type ResolveDefaults } from './resolve';
import type {
  HttpAdapter,
  HttpHeaders,
  HttpPlugin,
  HttpRequestInit,
  HttpResponse,
  Middleware,
  Next,
} from './types';
import { FormBuilder } from '../serializers/form-builder';
import { WebFileSerializer } from '../serializers/web-file.serializer';
import type { FileSerializer } from '../serializers/file-serializer';

export interface HttpClientOptions extends ResolveDefaults {
  adapter: HttpAdapter;
  /** Strategy for appending non-primitive values to the `FormData` built by `upload()`. Defaults to `WebFileSerializer`. */
  fileSerializer?: FileSerializer;
}

type VerbInit = Omit<HttpRequestInit, 'url' | 'method' | 'body'>;

export class HttpClient {
  private readonly adapter: HttpAdapter;
  private readonly defaults: ResolveDefaults;
  private readonly plugins: (Middleware | HttpPlugin)[];
  private readonly fileSerializer: FileSerializer;
  private readonly formBuilder: FormBuilder;
  /** The composed pipeline, built lazily and cached across requests — invalidated in `use()`. */
  private pipeline: Next | null = null;

  /**
   * `plugins` is how `extend()` seeds a new client with the parent's plugin list — not
   * part of the documented public API surface (a fresh client always starts with none;
   * use `.use()`). Kept a plain constructor parameter rather than a private static
   * factory only because `extend()` needs it from outside the class it's called on.
   */
  constructor(options: HttpClientOptions, plugins: readonly (Middleware | HttpPlugin)[] = []) {
    const { adapter, fileSerializer, ...defaults } = options;
    this.adapter = adapter;
    this.defaults = defaults;
    this.plugins = [...plugins];
    this.fileSerializer = fileSerializer ?? new WebFileSerializer();
    this.formBuilder = new FormBuilder(this.fileSerializer);
  }

  use(plugin: Middleware | HttpPlugin): this {
    this.plugins.push(plugin);
    this.pipeline = null;
    return this;
  }

  private getPipeline(): Next {
    if (!this.pipeline) {
      const terminal: Next = (req) => this.adapter.send(req) as Promise<HttpResponse>;
      this.pipeline = compose(this.plugins, terminal);
    }
    return this.pipeline;
  }

  async request<T = unknown>(init: HttpRequestInit): Promise<HttpResponse<T>> {
    const request = resolve(init, this.defaults);
    return this.getPipeline()(request) as Promise<HttpResponse<T>>;
  }

  async get<T = unknown>(url: string, init?: VerbInit): Promise<T> {
    const response = await this.request<T>({ ...init, url, method: 'GET' });
    return response.data;
  }

  async delete<T = unknown>(url: string, init?: VerbInit): Promise<T> {
    const response = await this.request<T>({ ...init, url, method: 'DELETE' });
    return response.data;
  }

  async head(url: string, init?: VerbInit): Promise<HttpHeaders> {
    const response = await this.request({ ...init, url, method: 'HEAD' });
    return response.headers;
  }

  async post<T = unknown, B = unknown>(url: string, body?: B, init?: VerbInit): Promise<T> {
    const response = await this.request<T>({ ...init, url, method: 'POST', body });
    return response.data;
  }

  async put<T = unknown, B = unknown>(url: string, body?: B, init?: VerbInit): Promise<T> {
    const response = await this.request<T>({ ...init, url, method: 'PUT', body });
    return response.data;
  }

  async patch<T = unknown, B = unknown>(url: string, body?: B, init?: VerbInit): Promise<T> {
    const response = await this.request<T>({ ...init, url, method: 'PATCH', body });
    return response.data;
  }

  /**
   * Uploads `data` as `multipart/form-data`. A plain object is built into a
   * `FormData` via the configured `fileSerializer` (default `WebFileSerializer`);
   * an existing `FormData` is sent through as-is. Clears any client-level
   * `Content-Type` default (`headers: { 'content-type': null }` — deleted, same as an
   * explicit request-level `null` override elsewhere) so FormData is never sent
   * mislabelled as whatever the client's default happened to be, with no multipart
   * boundary; the adapter's transport generates that boundary itself. An explicit
   * per-request `init.headers['content-type']` (e.g. a caller-supplied boundary) still
   * wins — it's layered on *after* the clearing default, not instead of it.
   */
  async upload<T = unknown>(
    url: string,
    data: Record<string, unknown> | FormData,
    init?: VerbInit,
  ): Promise<T> {
    const body = data instanceof FormData ? data : this.formBuilder.build(data);
    const response = await this.request<T>({
      ...init,
      headers: { 'content-type': null, ...init?.headers },
      url,
      method: 'POST',
      body,
    });
    return response.data;
  }

  /** GET request whose response is resolved as a `Blob`. */
  async download(url: string, init?: VerbInit): Promise<Blob> {
    const response = await this.request<Blob>({
      ...init,
      url,
      method: 'GET',
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * A new, independent `HttpClient` inheriting the parent's options and the
   * plugins registered so far — a snapshot, not a live link. Registering a
   * plugin on either client afterward does not affect the other. Typically
   * called early (before `use(auth(...))`/`use(recover(...))`) to produce a
   * client with no auth/recovery plugins attached — typically the client a
   * `recover()` callback uses internally to call the refresh endpoint,
   * avoiding a recursive recovery loop.
   *
   * Every field falls back to the parent's value via `??`, which has two
   * consequences: passing a field as explicit `undefined` does not unset
   * it (there's no way to force a field back to "unset" from a parent that
   * has one); and `headers` is replaced wholesale rather than merged —
   * passing any `headers` here drops the parent's entirely, unlike a
   * per-request `headers` override (see `resolve()`'s `mergeHeaders`),
   * which layers on top instead of replacing.
   */
  extend(options: Partial<HttpClientOptions> = {}): HttpClient {
    return new HttpClient(
      {
        adapter: options.adapter ?? this.adapter,
        fileSerializer: options.fileSerializer ?? this.fileSerializer,
        baseURL: options.baseURL ?? this.defaults.baseURL,
        headers: options.headers ?? this.defaults.headers,
        timeout: options.timeout ?? this.defaults.timeout,
        credentials: options.credentials ?? this.defaults.credentials,
        responseType: options.responseType ?? this.defaults.responseType,
        paramsSerializer: options.paramsSerializer ?? this.defaults.paramsSerializer,
      },
      this.plugins,
    );
  }
}
