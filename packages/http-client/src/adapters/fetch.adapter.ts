import { HttpError } from '../core/http-error';
import type {
  HttpAdapter,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
  ResponseType,
} from '../core/types';

export interface FetchAdapterOptions {
  fetch?: typeof globalThis.fetch;
}

function toBodyInit(body: unknown, headers: Record<string, string>): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof ReadableStream
  ) {
    return body as BodyInit;
  }
  if (!('content-type' in headers)) {
    headers['content-type'] = 'application/json';
  }
  return JSON.stringify(body);
}

function normalizeHeaders(headers: Headers): HttpHeaders {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
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

async function parseBody(response: Response, responseType: ResponseType): Promise<unknown> {
  switch (responseType) {
    case 'blob':
      return response.blob();
    case 'arrayBuffer':
      return response.arrayBuffer();
    case 'text':
      return response.text();
    case 'stream':
      return response.body;
    case 'json':
    default: {
      const text = await response.text();
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch (cause) {
        throw new JsonParseFailure(text, cause);
      }
    }
  }
}

/** Wraps global `fetch` (or an injected replacement) — zero dependency on axios. */
export function fetchAdapter(options: FetchAdapterOptions = {}): HttpAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: 'fetch',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
      if (request.responseType === 'stream') {
        throw new HttpError(
          "fetchAdapter does not support responseType: 'stream' (capabilities.stream is false)",
          { code: 'UNSUPPORTED', status: 0, request },
        );
      }

      const outgoingHeaders: Record<string, string> = { ...request.headers };
      const body = toBodyInit(request.body, outgoingHeaders);

      const timeoutController = new AbortController();
      const timer =
        request.timeout > 0
          ? setTimeout(() => timeoutController.abort(), request.timeout)
          : undefined;
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutController.signal])
        : timeoutController.signal;

      try {
        let response: Response;
        try {
          response = await fetchImpl(request.url, {
            method: request.method,
            headers: outgoingHeaders,
            body,
            credentials: request.credentials,
            signal,
          });
        } catch (cause) {
          // Checked before the internal timeout (same precedence axiosAdapter uses): if a
          // user abort and a timeout race, the user's own cancellation is the more
          // meaningful signal to report — see axios.adapter.ts's matching comment.
          if (request.signal?.aborted) {
            throw new HttpError('Request canceled', {
              code: 'CANCELED',
              status: 0,
              request,
              cause,
            });
          }
          if (timeoutController.signal.aborted) {
            throw new HttpError('Request timed out', {
              code: 'TIMEOUT',
              status: 0,
              request,
              cause,
            });
          }
          throw new HttpError('Network Error', {
            code: 'NETWORK_ERROR',
            status: 0,
            request,
            cause,
          });
        }

        const ok = response.status >= 200 && response.status < 300;
        let data: unknown;
        try {
          data = await parseBody(response, request.responseType);
        } catch (cause) {
          if (cause instanceof JsonParseFailure) {
            if (ok) {
              // The raw text is the only useful thing a caller has to inspect what the
              // server actually sent — without it, a 200 with malformed JSON leaves both
              // `data` and `response` empty, and the text survives only as `cause.rawText`
              // on a class that isn't exported (no stable way to read it from outside).
              throw new HttpError('Failed to parse response body', {
                code: 'PARSE_ERROR',
                status: response.status,
                data: cause.rawText,
                request,
                cause,
              });
            }
            data = cause.rawText;
          } else if (request.signal?.aborted) {
            throw new HttpError('Request canceled', {
              code: 'CANCELED',
              status: 0,
              request,
              cause,
            });
          } else if (timeoutController.signal.aborted) {
            throw new HttpError('Request timed out', {
              code: 'TIMEOUT',
              status: 0,
              request,
              cause,
            });
          } else {
            throw new HttpError('Network Error', {
              code: 'NETWORK_ERROR',
              status: 0,
              request,
              cause,
            });
          }
        }

        const httpResponse: HttpResponse<T> = {
          data: data as T,
          status: response.status,
          statusText: response.statusText,
          headers: normalizeHeaders(response.headers),
          request,
          raw: response,
        };

        if (!ok) {
          throw new HttpError(
            response.statusText || `Request failed with status ${response.status}`,
            {
              code: 'HTTP_ERROR',
              status: response.status,
              data: data as T,
              request,
              response: httpResponse,
            },
          );
        }

        return httpResponse;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
