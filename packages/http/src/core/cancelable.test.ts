import { describe, expect, it } from 'vitest';
import { cancelable } from './cancelable';
import { HttpClient } from './client';
import { HttpError } from './http-error';
import type { HttpAdapter, HttpRequest, HttpResponse } from './types';

/** Never resolves on its own — only settles if the request's signal is aborted. */
function hangingAdapter(): HttpAdapter {
  return {
    name: 'hanging',
    capabilities: { uploadProgress: false, downloadProgress: false, stream: false },
    send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener(
          'abort',
          () => reject(new HttpError('Request canceled', { code: 'CANCELED', status: 0, request })),
          { once: true },
        );
      });
    },
  };
}

describe('cancelable', () => {
  it('runs the given function with a fresh AbortSignal', () => {
    let seenSignal: AbortSignal | undefined;
    cancelable((signal) => {
      seenSignal = signal;
      return Promise.resolve('done');
    });

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it("cancel() aborts the in-flight request via the signal, rejecting the client's request", async () => {
    const client = new HttpClient({ adapter: hangingAdapter() });
    const { promise, cancel } = cancelable((signal) => client.get('/slow', { signal }));

    cancel('user navigated away');

    await expect(promise).rejects.toMatchObject({ code: 'CANCELED' });
  });

  it('resolves normally when never canceled', async () => {
    const { promise } = cancelable(async () => 'ok');
    await expect(promise).resolves.toBe('ok');
  });
});
