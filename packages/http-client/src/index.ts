export { resolve } from './core/resolve';
export type { ResolveDefaults } from './core/resolve';

export { PluginOrder } from './core/types';
export type {
  Awaitable,
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
  AdapterCapabilities,
} from './core/types';

export { HttpClient } from './core/client';
export type { HttpClientOptions } from './core/client';

export { HttpError } from './core/http-error';
export type { HttpErrorCode, HttpErrorOptions } from './core/http-error';

export { EventBus } from './core/event-bus';

export { cancelable } from './core/cancelable';

export { auth } from './plugins/auth.plugin';
export type { Authenticator, AuthOptions } from './plugins/auth.plugin';

export { bearer, apiKey, basic, allOf } from './plugins/authenticators';
export type { BearerOptions, BearerSource, ApiKeyOptions } from './plugins/authenticators';

export { recover, onStatus } from './plugins/recover.plugin';
export type { RecoverOptions, RecoveryContext, RecoveryEventMap } from './plugins/recover.plugin';

export { errorMapper } from './plugins/error-mapper.plugin';

export { defaultAccessTokenParser } from './plugins/token-provider';
export type { TokenProvider, Storage, AccessTokenParser } from './plugins/token-provider';

export { LocalStorageTokenProvider } from './plugins/local-storage-token.provider';
export type { LocalStorageTokenProviderOptions } from './plugins/local-storage-token.provider';

export { CookieHttpOnlyTokenProvider } from './plugins/cookie-token.provider';
export type { CookieHttpOnlyTokenProviderOptions } from './plugins/cookie-token.provider';

export type { FileSerializer } from './serializers/file-serializer';
export { WebFileSerializer } from './serializers/web-file.serializer';
export { NativeFileSerializer } from './serializers/native-file.serializer';
export { FormBuilder } from './serializers/form-builder';
