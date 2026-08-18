import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type ResponseType as AxiosResponseType,
} from 'axios';
import { HttpError } from '../core/http-error';
import type {
  HttpAdapter,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
  ResponseType,
} from '../core/types';

/**
 * Always requests raw text/binary from axios and parses it ourselves — axios's
 * own JSON auto-parsing/`responseType: 'blob'` behavior varies across
 * environments (browser XHR vs Node's http adapter), which would break parity
 * with the fetch adapter. This is the one file in the package allowed to
 * import `axios` (see eslint.config.js).
 */
function mapAxiosResponseType(responseType: ResponseType): AxiosResponseType {
  switch (responseType) {
    case 'blob':
    case 'arrayBuffer':
      return 'arraybuffer';
    case 'stream':
      return 'stream';
    case 'text':
    case 'json':
    default:
      return 'text';
  }
}

function normalizeHeaders(headers: AxiosResponse['headers']): HttpHeaders {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[key.toLowerCase()] = value;
    else if (Array.isArray(value)) result[key.toLowerCase()] = value.join(', ');
  }
  return result;
}

/** Thrown only when a `'json'` body fails `JSON.parse` — carries the raw text so the caller can fall back to it for a non-2xx response. */
class JsonParseFailure extends Error {
  readonly cause: unknown;

  constructor(
    readonly rawText: string,
    cause: unknown,
  ) {
    super('Failed to parse response body');
    this.cause = cause;
  }
}

function parseBody(responseType: ResponseType, raw: unknown, contentType?: string): unknown {
  switch (responseType) {
    case 'blob':
      return new Blob([raw as ArrayBuffer], contentType ? { type: contentType } : undefined);
    case 'arrayBuffer':
    case 'stream':
      return raw;
    case 'text':
      return raw as string;
    case 'json':
    default: {
      const text = raw as string;
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch (cause) {
        throw new JsonParseFailure(text, cause);
      }
    }
  }
}

/** Wraps a caller-supplied axios instance, treated as an opaque transport (see README's "Adapters"). */
export function axiosAdapter(instance: AxiosInstance): HttpAdapter {
  return {
    name: 'axios',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
      if (request.responseType === 'stream') {
        throw new HttpError(
          "axiosAdapter does not support responseType: 'stream' (capabilities.stream is false)",
          { code: 'UNSUPPORTED', status: 0, request },
        );
      }

      // Own the timeout via AbortController rather than axios's `timeout` option: once a
      // response starts streaming, axios's internal timeout destroys the response stream and
      // surfaces it as a generic ERR_BAD_RESPONSE ("stream has been aborted"), not
      // ECONNABORTED/ETIMEDOUT — so relying on those codes alone misses a mid-body timeout.
      const timeoutController = new AbortController();
      const timer =
        request.timeout > 0
          ? setTimeout(() => timeoutController.abort(), request.timeout)
          : undefined;
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutController.signal])
        : timeoutController.signal;

      let axiosResponse: AxiosResponse<unknown>;
      try {
        axiosResponse = await instance.request<unknown>({
          url: request.url,
          method: request.method,
          headers: request.headers,
          data: request.body,
          signal,
          withCredentials: request.credentials === 'include',
          responseType: mapAxiosResponseType(request.responseType),
          transformResponse: (data: unknown) => data,
          // The adapter, not the caller's axios instance defaults, controls status interpretation.
          validateStatus: () => true,
        });
      } catch (cause) {
        // Checked before the internal timeout, matching fetchAdapter: if a user abort and
        // a timeout race (both signals end up `aborted: true` by the time this runs), the
        // user's own cancellation is the more meaningful signal to report — a caller who
        // aborted knows why they did; inferring "it must have been the timeout" instead
        // would be misleading about a request they specifically chose to stop.
        if (request.signal?.aborted) {
          throw new HttpError('Request canceled', { code: 'CANCELED', status: 0, request, cause });
        }
        if (timeoutController.signal.aborted) {
          throw new HttpError('Request timed out', { code: 'TIMEOUT', status: 0, request, cause });
        }
        if (axios.isCancel(cause) || (axios.isAxiosError(cause) && cause.code === 'ERR_CANCELED')) {
          throw new HttpError('Request canceled', { code: 'CANCELED', status: 0, request, cause });
        }
        if (
          axios.isAxiosError(cause) &&
          (cause.code === 'ECONNABORTED' || cause.code === 'ETIMEDOUT')
        ) {
          throw new HttpError('Request timed out', { code: 'TIMEOUT', status: 0, request, cause });
        }
        throw new HttpError('Network Error', { code: 'NETWORK_ERROR', status: 0, request, cause });
      } finally {
        clearTimeout(timer);
      }

      const ok = axiosResponse.status >= 200 && axiosResponse.status < 300;
      const headers = normalizeHeaders(axiosResponse.headers);
      let data: unknown;
      try {
        data = parseBody(request.responseType, axiosResponse.data, headers['content-type']);
      } catch (cause) {
        if (!ok && cause instanceof JsonParseFailure) {
          data = cause.rawText;
        } else {
          // The raw text is the only useful thing a caller has to inspect what the server
          // actually sent — without it, a 200 with malformed JSON leaves `data` empty, and
          // the text survives only as `cause.rawText` on a class that isn't exported (no
          // stable way to read it from outside).
          throw new HttpError('Failed to parse response body', {
            code: 'PARSE_ERROR',
            status: axiosResponse.status,
            data: cause instanceof JsonParseFailure ? cause.rawText : undefined,
            request,
            cause,
          });
        }
      }

      const httpResponse: HttpResponse<T> = {
        data: data as T,
        status: axiosResponse.status,
        statusText: axiosResponse.statusText,
        headers,
        request,
        raw: axiosResponse,
      };

      if (!ok) {
        throw new HttpError(
          axiosResponse.statusText || `Request failed with status ${axiosResponse.status}`,
          {
            code: 'HTTP_ERROR',
            status: axiosResponse.status,
            data: data as T,
            request,
            response: httpResponse,
          },
        );
      }

      return httpResponse;
    },
  };
}
