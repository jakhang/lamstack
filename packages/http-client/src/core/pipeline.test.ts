import { describe, expect, it } from 'vitest';
import { compose } from './pipeline';
import { resolve } from './resolve';
import type { HttpPlugin, HttpResponse, Middleware } from './types';

function response(data: unknown): HttpResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    request: resolve({ url: '/x' }),
  };
}

describe('compose — re-entrant next()', () => {
  it('next() re-entry does not re-run outer middleware', async () => {
    let outerRuns = 0;
    let terminalRuns = 0;

    const outer: Middleware = async (request, next) => {
      outerRuns += 1;
      return next(request);
    };

    const middle: Middleware = async (request, next) => {
      await next(request);
      return next(request); // re-entrant: calls the inner chain a second time
    };

    const result = await compose([outer, middle], async (request) => {
      terminalRuns += 1;
      return response({ url: request.url });
    })(resolve({ url: '/x' }));

    expect(outerRuns).toBe(1);
    expect(terminalRuns).toBe(2);
    expect(result.data).toEqual({ url: '/x' });
  });
});

describe('compose — short-circuit', () => {
  it('a middleware that never calls next() short-circuits the chain', async () => {
    let terminalRuns = 0;

    const shortCircuit: Middleware = async () => response('short-circuited');

    const result = await compose([shortCircuit], async () => {
      terminalRuns += 1;
      return response('terminal');
    })(resolve({ url: '/x' }));

    expect(terminalRuns).toBe(0);
    expect(result.data).toBe('short-circuited');
  });
});

describe('compose — plugin ordering', () => {
  it('executes HttpPlugin entries in `order` order, regardless of use() registration order', async () => {
    const ran: string[] = [];
    const record =
      (name: string): Middleware =>
      async (request, next) => {
        ran.push(name);
        return next(request);
      };

    const plugins: HttpPlugin[] = [
      { name: 'transport', order: 200, handler: record('transport') },
      { name: 'observe', order: -200, handler: record('observe') },
      { name: 'auth', order: 100, handler: record('auth') },
    ];

    await compose(plugins, async (request) => {
      ran.push('terminal');
      return response(request.url);
    })(resolve({ url: '/x' }));

    expect(ran).toEqual(['observe', 'auth', 'transport', 'terminal']);
  });

  it('preserves use() insertion order for entries with equal `order`', async () => {
    const ran: string[] = [];
    const record =
      (name: string): Middleware =>
      async (request, next) => {
        ran.push(name);
        return next(request);
      };

    const plugins: HttpPlugin[] = [
      { name: 'first', order: 0, handler: record('first') },
      { name: 'second', order: 0, handler: record('second') },
    ];

    await compose(plugins, async (request) => response(request.url))(resolve({ url: '/x' }));

    expect(ran).toEqual(['first', 'second']);
  });

  it('a plain Middleware function (not an HttpPlugin) defaults to order PluginOrder.normalize', async () => {
    const ran: string[] = [];
    const plainMiddleware: Middleware = async (request, next) => {
      ran.push('plain');
      return next(request);
    };
    const observePlugin: HttpPlugin = {
      name: 'observe',
      order: -200,
      handler: async (request, next) => {
        ran.push('observe');
        return next(request);
      },
    };

    await compose([plainMiddleware, observePlugin], async (request) => response(request.url))(
      resolve({ url: '/x' }),
    );

    expect(ran).toEqual(['observe', 'plain']);
  });

  it("a plain Middleware runs before an HttpPlugin registered at order 0, regardless of registration order — it isn't in recover()'s slot", async () => {
    const ran: string[] = [];
    const plainMiddleware: Middleware = async (request, next) => {
      ran.push('plain');
      return next(request);
    };
    const orderZeroPlugin: HttpPlugin = {
      name: 'order-zero',
      order: 0,
      handler: async (request, next) => {
        ran.push('order-zero');
        return next(request);
      },
    };

    // Registered order-zero first, plain second — if the plain middleware still defaulted to
    // order 0, insertion order would put order-zero first. PluginOrder.normalize (-100) puts
    // it first regardless.
    await compose([orderZeroPlugin, plainMiddleware], async (request) => response(request.url))(
      resolve({ url: '/x' }),
    );

    expect(ran).toEqual(['plain', 'order-zero']);
  });
});
