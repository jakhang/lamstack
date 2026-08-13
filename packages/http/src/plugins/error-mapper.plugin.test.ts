import { describe, expect, it } from 'vitest';
import { HttpClient } from '../core/client';
import { HttpError } from '../core/http-error';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../core/types';
import { errorMapperPlugin } from './error-mapper.plugin';

function failingAdapter(status: number, data: unknown): HttpAdapter {
  return {
    name: 'failing',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      throw new HttpError('Failed', { code: 'HTTP_ERROR', status, data, request });
    },
  };
}

class DomainError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'DomainError';
  }
}

describe('errorMapperPlugin', () => {
  it('maps a thrown HttpError through the given function', async () => {
    const client = new HttpClient({ adapter: failingAdapter(422, { reason: 'invalid' }) });
    client.use(errorMapperPlugin((error) => new DomainError((error.data as { reason: string }).reason)));

    const error: unknown = await client.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).reason).toBe('invalid');
  });

  it('leaves the error untouched when meta.mapError is false', async () => {
    const client = new HttpClient({ adapter: failingAdapter(422, { reason: 'invalid' }) });
    client.use(errorMapperPlugin(() => new DomainError('mapped')));

    const error: unknown = await client.get('/x', { meta: { mapError: false } }).catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect((error as HttpError).status).toBe(422);
  });

  it('passes the raw HttpError through to the map function untouched when it is not a domain error', async () => {
    const client = new HttpClient({ adapter: failingAdapter(500, undefined) });
    client.use(errorMapperPlugin((error) => error));

    const error: unknown = await client.get('/x').catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect((error as HttpError).status).toBe(500);
  });
});
