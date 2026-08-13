import { HttpError } from '../core/http-error';
import type { HttpAdapter, HttpHeaders, HttpRequest, HttpResponse, ResponseType } from '../core/types';

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
    body instanceof ArrayBuffer
  ) {
    return body;
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

async function parseBody(response: Response, responseType: ResponseType, request: HttpRequest): Promise<unknown> {
  try {
    switch (responseType) {
      case 'blob':
        return await response.blob();
      case 'arrayBuffer':
        return await response.arrayBuffer();
      case 'text':
        return await response.text();
      case 'stream':
        return response.body;
      case 'json':
      default: {
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
      }
    }
  } catch (cause) {
    throw new HttpError('Failed to parse response body', {
      code: 'PARSE_ERROR',
      status: response.status,
      request,
      cause,
    });
  }
}

/** Wraps global `fetch` (or an injected replacement) — zero dependency on axios. */
export function fetchAdapter(options: FetchAdapterOptions = {}): HttpAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: 'fetch',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
      const outgoingHeaders: Record<string, string> = { ...request.headers };
      const body = toBodyInit(request.body, outgoingHeaders);

      const timeoutController = new AbortController();
      const timer =
        request.timeout > 0 ? setTimeout(() => timeoutController.abort(), request.timeout) : undefined;
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutController.signal])
        : timeoutController.signal;

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
        clearTimeout(timer);
        if (request.signal?.aborted) {
          throw new HttpError('Request canceled', { code: 'CANCELED', status: 0, request, cause });
        }
        if (timeoutController.signal.aborted) {
          throw new HttpError('Request timed out', { code: 'TIMEOUT', status: 0, request, cause });
        }
        throw new HttpError('Network Error', { code: 'NETWORK_ERROR', status: 0, request, cause });
      }
      clearTimeout(timer);

      const data = (await parseBody(response, request.responseType, request)) as T;
      const httpResponse: HttpResponse<T> = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        request,
        raw: response,
      };

      if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.statusText || `Request failed with status ${response.status}`, {
          code: 'HTTP_ERROR',
          status: response.status,
          data,
          request,
          response: httpResponse,
        });
      }

      return httpResponse;
    },
  };
}
