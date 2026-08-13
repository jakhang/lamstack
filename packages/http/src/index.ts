export { resolve } from './core/resolve';
export type { ResolveDefaults } from './core/resolve';

export { PluginOrder } from './core/types';
export type {
  HttpMethod,
  ResponseType,
  HttpHeaders,
  HeadersInput,
  QueryParams,
  HttpMeta,
  HttpRequestInit,
  HttpRequest,
  HttpResponse,
  Next,
  Middleware,
  HttpPlugin,
  HttpAdapter,
} from './core/types';

export { HttpClient } from './core/client';
export type { HttpClientOptions } from './core/client';

export { HttpError } from './core/http-error';
export type { HttpErrorCode, HttpErrorOptions } from './core/http-error';

export { HttpEventBus } from './core/http-event-bus';
export type { HttpEventMap } from './core/http-event-bus';

export { cancelable } from './core/cancelable';

export { auth } from './plugins/auth.plugin';
export type { AuthPluginOptions } from './plugins/auth.plugin';

export { refresh } from './plugins/refresh.plugin';
export type { RefreshPluginOptions } from './plugins/refresh.plugin';

export { errorMapper } from './plugins/error-mapper.plugin';

export { defaultRefreshPolicy, defaultAccessTokenParser } from './plugins/token-provider';
export type {
  Awaitable,
  TokenProvider,
  RefreshPolicy,
  RefreshPolicyContext,
  DefaultRefreshPolicyOptions,
  Storage,
  AccessTokenParser,
} from './plugins/token-provider';

export { LocalStorageTokenProvider } from './plugins/local-storage-token.provider';
export type { LocalStorageTokenProviderOptions } from './plugins/local-storage-token.provider';

export { CookieHttpOnlyTokenProvider } from './plugins/cookie-token.provider';
export type { CookieHttpOnlyTokenProviderOptions } from './plugins/cookie-token.provider';

export type { FileSerializer } from './serializers/file-serializer';
export { WebFileSerializer } from './serializers/web-file.serializer';
export { NativeFileSerializer } from './serializers/native-file.serializer';
export { FormBuilder } from './serializers/form-builder';
