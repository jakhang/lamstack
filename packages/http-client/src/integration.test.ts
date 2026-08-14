import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchAdapter } from './adapters/fetch.adapter';
import { HttpClient } from './core/client';
import { HttpError } from './core/http-error';
import { auth } from './plugins/auth.plugin';
import { bearer } from './plugins/authenticators';
import { errorMapper } from './plugins/error-mapper.plugin';
import { recover } from './plugins/recover.plugin';

/**
 * Runs the full auth + recover + errorMapper stack against a real HTTP server via the
 * real fetch adapter — no mock adapter. The adapter-parity contract tests
 * (adapters/contract.test-kit.ts) prove each adapter's own behavior in isolation; this
 * proves the plugins interact correctly with what a real adapter actually throws.
 */
describe('integration — auth + recover + errorMapper against a real adapter', () => {
  const server = createServer((req, res) => {
    if (req.url === '/protected') {
      if (req.headers.authorization === 'Bearer valid-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ secret: 42 }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.url === '/auth/refresh') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accessToken: 'valid-token' }));
      return;
    }
    if (req.url === '/boom') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  let baseURL: string;

  beforeAll(async () => {
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  });

  it('recovers from a real 401, retries with the refreshed token, and resolves — errorMapper never sees the transient failure', async () => {
    let currentToken = 'stale-token';
    const mapCalls: HttpError[] = [];

    const client = new HttpClient({ adapter: fetchAdapter(), baseURL });
    const refreshClient = client.extend({});

    client.use(
      errorMapper((error) => {
        mapCalls.push(error);
        return error;
      }),
    );
    client.use(
      recover({
        recover: async () => {
          const response = await refreshClient.get<{ accessToken: string }>('/auth/refresh');
          currentToken = response.accessToken;
        },
      }),
    );
    client.use(auth(bearer(() => currentToken)));

    const data = await client.get<{ secret: number }>('/protected');

    expect(data).toEqual({ secret: 42 });
    expect(currentToken).toBe('valid-token');
    expect(mapCalls).toHaveLength(0);
  });

  it('a real 500 (unrelated to auth) is left alone by recover() and reaches errorMapper, which maps it to a domain error', async () => {
    class DomainError extends Error {
      constructor(readonly httpError: HttpError) {
        super('Something went wrong upstream');
      }
    }

    const client = new HttpClient({ adapter: fetchAdapter(), baseURL });
    client.use(errorMapper((error) => new DomainError(error)));
    client.use(
      recover({
        recover: async () => {
          throw new Error('should never be called for a 500');
        },
      }),
    );
    client.use(auth(bearer(() => 'valid-token')));

    const error: unknown = await client.get('/boom').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).httpError.status).toBe(500);
    expect((error as DomainError).httpError.code).toBe('HTTP_ERROR');
  });
});
