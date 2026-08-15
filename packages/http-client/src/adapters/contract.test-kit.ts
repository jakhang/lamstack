import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from '../core/resolve';
import type { HttpAdapter, HttpRequestInit } from '../core/types';

type Route = (req: IncomingMessage, res: ServerResponse) => void;

const routes: Record<string, Route> = {
  '/json': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'hi' }));
  },
  '/text': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('hello');
  },
  '/no-content': (_req, res) => {
    res.writeHead(204);
    res.end();
  },
  '/not-found': (_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  },
  '/server-error': (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h1>Internal Server Error</h1>');
  },
  '/server-error-html': (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h1>Broken</h1>');
  },
  '/slow': (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 300);
  },
  '/invalid-json': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{not valid json');
  },
  '/custom-header': (_req, res) => {
    res.writeHead(200, { 'X-Custom-Header': 'Value', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  },
  '/blob': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(Buffer.from([1, 2, 3, 4]));
  },
  '/slow-body': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"a":1');
    setTimeout(() => res.end(',"b":2}'), 100);
  },
  '/echo-body': (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.concat(chunks));
    });
  },
};

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  return (server.address() as AddressInfo).port;
}

/**
 * One scripted scenario suite, run against any `HttpAdapter`, against a real
 * local HTTP server — this is what proves fetch/axios adapters are
 * interchangeable, not the architecture.
 */
export function runAdapterContract(name: string, makeAdapter: () => HttpAdapter): void {
  describe(`adapter contract — ${name}`, () => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = routes[url.pathname];
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }
      route(req, res);
    });

    let baseURL: string;
    let deadPort: number;
    const adapter = makeAdapter();

    beforeAll(async () => {
      const port = await listen(server);
      baseURL = `http://127.0.0.1:${port}`;

      const probe = createServer();
      deadPort = await listen(probe);
      await new Promise<void>((resolvePromise) => probe.close(() => resolvePromise()));
    });

    afterAll(async () => {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    });

    function req(init: HttpRequestInit) {
      return resolve(init, { baseURL });
    }

    it('200 JSON', async () => {
      const response = await adapter.send(req({ url: '/json' }));
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ message: 'hi' });
    });

    it('200 text', async () => {
      const response = await adapter.send(req({ url: '/text', responseType: 'text' }));
      expect(response.status).toBe(200);
      expect(response.data).toBe('hello');
    });

    it('204 No Content', async () => {
      const response = await adapter.send(req({ url: '/no-content' }));
      expect(response.status).toBe(204);
    });

    it('404 + JSON body throws HttpError with the parsed body', async () => {
      await expect(adapter.send(req({ url: '/not-found' }))).rejects.toMatchObject({
        code: 'HTTP_ERROR',
        status: 404,
        data: { error: 'not found' },
      });
    });

    it('500 + HTML body throws HttpError', async () => {
      await expect(
        adapter.send(req({ url: '/server-error', responseType: 'text' })),
      ).rejects.toMatchObject({
        code: 'HTTP_ERROR',
        status: 500,
      });
    });

    it('500 + a body that fails to parse as the default (json) responseType still throws HTTP_ERROR with the raw text as data', async () => {
      const promise = adapter.send(req({ url: '/server-error-html' }));
      await expect(promise).rejects.toMatchObject({
        code: 'HTTP_ERROR',
        status: 500,
        data: '<h1>Broken</h1>',
      });
      const error = await promise.catch((caught: unknown) => caught);
      expect((error as { response?: unknown }).response).toBeDefined();
    });

    it('network error (nothing listening) throws a NETWORK_ERROR HttpError with status 0', async () => {
      const deadAdapter = makeAdapter();
      const request = resolve({ url: '/x' }, { baseURL: `http://127.0.0.1:${deadPort}` });
      await expect(deadAdapter.send(request)).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        status: 0,
      });
    });

    it('timeout throws a TIMEOUT HttpError', async () => {
      await expect(adapter.send(req({ url: '/slow', timeout: 30 }))).rejects.toMatchObject({
        code: 'TIMEOUT',
        status: 0,
      });
    });

    it('a timeout that elapses while the body is still streaming in still throws TIMEOUT, not a resolved response', async () => {
      await expect(adapter.send(req({ url: '/slow-body', timeout: 30 }))).rejects.toMatchObject({
        code: 'TIMEOUT',
        status: 0,
      });
    });

    it('an already-aborted signal rejects immediately with a CANCELED HttpError', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.send(req({ url: '/json', signal: controller.signal })),
      ).rejects.toMatchObject({
        code: 'CANCELED',
      });
    });

    it('aborting mid-request rejects with a CANCELED HttpError', async () => {
      const controller = new AbortController();
      const promise = adapter.send(req({ url: '/slow', signal: controller.signal }));
      setTimeout(() => controller.abort(), 20);
      await expect(promise).rejects.toMatchObject({ code: 'CANCELED' });
    });

    it('invalid JSON in a 200 response throws a PARSE_ERROR HttpError', async () => {
      await expect(adapter.send(req({ url: '/invalid-json' }))).rejects.toMatchObject({
        code: 'PARSE_ERROR',
      });
    });

    it('normalizes response headers to lowercase keys', async () => {
      const response = await adapter.send(req({ url: '/custom-header' }));
      expect(response.headers['x-custom-header']).toBe('Value');
    });

    it("responseType: 'blob' resolves the body as a Blob", async () => {
      const response = await adapter.send(req({ url: '/blob', responseType: 'blob' }));
      expect(response.data).toBeInstanceOf(Blob);
      expect((response.data as Blob).size).toBe(4);
    });

    it("responseType: 'blob' preserves the response's Content-Type on the Blob", async () => {
      const response = await adapter.send(req({ url: '/blob', responseType: 'blob' }));
      expect((response.data as Blob).type).toBe('application/octet-stream');
    });

    it("responseType: 'stream' throws a clear error, since capabilities.stream is false", async () => {
      await expect(adapter.send(req({ url: '/json', responseType: 'stream' }))).rejects.toThrow(
        "does not support responseType: 'stream' (capabilities.stream is false)",
      );
    });

    it('sends a binary body as raw bytes, not JSON-stringified', async () => {
      const response = await adapter.send(
        req({
          url: '/echo-body',
          method: 'POST',
          body: new Uint8Array([1, 2, 3]),
          responseType: 'arrayBuffer',
        }),
      );
      expect(new Uint8Array(response.data as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    });
  });
}
