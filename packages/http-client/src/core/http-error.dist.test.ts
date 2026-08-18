import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for the CJS-duplication bug: tsup only code-splits the ESM output, so the
 * CJS build inlines a separate `HttpError` class into each entry point (`index.cjs`,
 * `adapters/fetch.cjs`, `adapters/axios.cjs`). Every other test in this suite imports from
 * `src/`, a single module graph, which is exactly why that class of bug stayed invisible —
 * this one runs against the actual built `dist/` output, requiring the root and an adapter
 * subpath as if they were two separate `node_modules` resolutions, the way a real consumer's
 * bundler would. Rebuilds in `beforeAll` so a stale `dist/` from an earlier run can never mask
 * a regression here.
 */
const packageRoot = path.resolve(__dirname, '../..');
const nodeRequire = createRequire(import.meta.url);

function freshRequire(distPath: string): unknown {
  const resolved = nodeRequire.resolve(path.join(packageRoot, distPath));
  delete nodeRequire.cache[resolved];
  return nodeRequire(resolved);
}

describe('HttpError identity survives across dist entry points', () => {
  beforeAll(() => {
    execSync('pnpm build', { cwd: packageRoot, stdio: 'inherit' });
  }, 120_000);

  it('HttpError.is() recognizes a fetch-adapter error required from a different CJS entry point', async () => {
    const { HttpError, resolve } = freshRequire('dist/index.cjs') as typeof import('../index');
    const { fetchAdapter } = freshRequire('dist/adapters/fetch.cjs') as typeof import('../adapters/fetch.adapter');

    const error: unknown = await fetchAdapter()
      .send(resolve({ url: 'http://127.0.0.1:1/x', timeout: 500 }))
      .catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect(error).toBeInstanceOf(HttpError);
  });

  it('HttpError.is() recognizes an axios-adapter error required from a different CJS entry point', async () => {
    const { HttpError, resolve } = freshRequire('dist/index.cjs') as typeof import('../index');
    const { axiosAdapter } = freshRequire('dist/adapters/axios.cjs') as typeof import('../adapters/axios.adapter');
    const axios = nodeRequire('axios') as typeof import('axios');

    const error: unknown = await axiosAdapter(axios.create({ timeout: 500 }))
      .send(resolve({ url: 'http://127.0.0.1:1/x' }))
      .catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect(error).toBeInstanceOf(HttpError);
  });

  it('HttpError.is() recognizes a fetch-adapter error imported from a different ESM entry point', async () => {
    const indexUrl = pathToFileURL(path.join(packageRoot, 'dist/index.js')).href;
    const fetchUrl = pathToFileURL(path.join(packageRoot, 'dist/adapters/fetch.js')).href;
    const { HttpError, resolve } = (await import(indexUrl)) as typeof import('../index');
    const { fetchAdapter } = (await import(fetchUrl)) as typeof import('../adapters/fetch.adapter');

    const error: unknown = await fetchAdapter()
      .send(resolve({ url: 'http://127.0.0.1:1/x', timeout: 500 }))
      .catch((e: unknown) => e);

    expect(HttpError.is(error)).toBe(true);
    expect(error).toBeInstanceOf(HttpError);
  });
});
