export { resolve } from './core/resolve';
export type { ResolveDefaults } from './core/resolve';

export { withHeaders, withMeta, metaOptOut } from './core/request';

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

export { tokenSession, defaultAccessTokenParser } from './plugins/token-session';
export type {
  TokenSession,
  TokenSessionOptions,
  TokenStore,
  TokenResult,
  AccessTokenParser,
} from './plugins/token-session';

export type { FileSerializer } from './serializers/file-serializer';
export { WebFileSerializer } from './serializers/web-file.serializer';
export { NativeFileSerializer } from './serializers/native-file.serializer';
export { FormBuilder } from './serializers/form-builder';
