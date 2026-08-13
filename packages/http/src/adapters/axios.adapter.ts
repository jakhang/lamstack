import axios, { type AxiosInstance, type AxiosResponse, type ResponseType as AxiosResponseType } from 'axios';
import { HttpError } from '../core/http-error';
import type { HttpAdapter, HttpHeaders, HttpRequest, HttpResponse, ResponseType } from '../core/types';

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

function parseBody(responseType: ResponseType, raw: unknown, status: number, request: HttpRequest): unknown {
  try {
    switch (responseType) {
      case 'blob':
        return new Blob([raw as ArrayBuffer]);
      case 'arrayBuffer':
      case 'stream':
        return raw;
      case 'text':
        return raw as string;
      case 'json':
      default: {
        const text = raw as string;
        return text ? JSON.parse(text) : undefined;
      }
    }
  } catch (cause) {
    throw new HttpError('Failed to parse response body', { code: 'PARSE_ERROR', status, request, cause });
  }
}

/** Wraps a caller-supplied axios instance, treated as an opaque transport — see SPEC.md §4. */
export function axiosAdapter(instance: AxiosInstance): HttpAdapter {
  return {
    name: 'axios',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
      let axiosResponse: AxiosResponse<unknown>;
      try {
        axiosResponse = await instance.request<unknown>({
          url: request.url,
          method: request.method,
          headers: request.headers,
          data: request.body,
          signal: request.signal,
          timeout: request.timeout > 0 ? request.timeout : undefined,
          withCredentials: request.credentials === 'include',
          responseType: mapAxiosResponseType(request.responseType),
          transformResponse: (data: unknown) => data,
          // The adapter, not the caller's axios instance defaults, controls status interpretation.
          validateStatus: () => true,
        });
      } catch (cause) {
        if (axios.isCancel(cause) || (axios.isAxiosError(cause) && cause.code === 'ERR_CANCELED')) {
          throw new HttpError('Request canceled', { code: 'CANCELED', status: 0, request, cause });
        }
        if (axios.isAxiosError(cause) && (cause.code === 'ECONNABORTED' || cause.code === 'ETIMEDOUT')) {
          throw new HttpError('Request timed out', { code: 'TIMEOUT', status: 0, request, cause });
        }
        throw new HttpError('Network Error', { code: 'NETWORK_ERROR', status: 0, request, cause });
      }

      const data = parseBody(request.responseType, axiosResponse.data, axiosResponse.status, request) as T;
      const httpResponse: HttpResponse<T> = {
        data,
        status: axiosResponse.status,
        statusText: axiosResponse.statusText,
        headers: normalizeHeaders(axiosResponse.headers),
        request,
        raw: axiosResponse,
      };

      if (axiosResponse.status < 200 || axiosResponse.status >= 300) {
        throw new HttpError(axiosResponse.statusText || `Request failed with status ${axiosResponse.status}`, {
          code: 'HTTP_ERROR',
          status: axiosResponse.status,
          data,
          request,
          response: httpResponse,
        });
      }

      return httpResponse;
    },
  };
}
