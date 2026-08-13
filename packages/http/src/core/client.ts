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

export interface HttpClientOptions extends ResolveDefaults {
  adapter: HttpAdapter;
}

type VerbInit = Omit<HttpRequestInit, 'url' | 'method' | 'body'>;

export class HttpClient {
  private readonly adapter: HttpAdapter;
  private readonly defaults: ResolveDefaults;
  private readonly plugins: (Middleware | HttpPlugin)[];

  constructor(options: HttpClientOptions, plugins: readonly (Middleware | HttpPlugin)[] = []) {
    const { adapter, ...defaults } = options;
    this.adapter = adapter;
    this.defaults = defaults;
    this.plugins = [...plugins];
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
   * A new, independent `HttpClient` inheriting the parent's options and the
   * plugins registered so far — a snapshot, not a live link. Registering a
   * plugin on either client afterward does not affect the other. Typically
   * called early (before `use(authPlugin(...))`/`use(refreshPlugin(...))`) to
   * produce a `refreshClient` with no auth/refresh plugins attached, avoiding
   * a recursive refresh loop.
   */
  extend(options: Partial<HttpClientOptions> = {}): HttpClient {
    return new HttpClient(
      {
        adapter: options.adapter ?? this.adapter,
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
