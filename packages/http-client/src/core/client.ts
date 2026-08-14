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
    return this;
  }

  async request<T = unknown>(init: HttpRequestInit): Promise<HttpResponse<T>> {
    const request = resolve(init, this.defaults);
    const terminal: Next = (req) => this.adapter.send<T>(req) as Promise<HttpResponse>;
    const run = compose(this.plugins, terminal);
    return run(request) as Promise<HttpResponse<T>>;
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
   * an existing `FormData` is sent through as-is. Never sets an explicit
   * `Content-Type` — the adapter's transport must generate the multipart
   * boundary itself.
   */
  async upload<T = unknown>(url: string, data: Record<string, unknown> | FormData, init?: VerbInit): Promise<T> {
    const body = data instanceof FormData ? data : this.formBuilder.build(data);
    const response = await this.request<T>({ ...init, url, method: 'POST', body });
    return response.data;
  }

  /** GET request whose response is resolved as a `Blob`. */
  async download(url: string, init?: VerbInit): Promise<Blob> {
    const response = await this.request<Blob>({ ...init, url, method: 'GET', responseType: 'blob' });
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
