import { defineConfig } from 'tsup';

// Three entries: the core (`.`) and each adapter as its own subpath, so
// importing the package root never pulls in axios or fetch-specific code.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/fetch': 'src/adapters/fetch.adapter.ts',
    'adapters/axios': 'src/adapters/axios.adapter.ts',
  },
  format: ['esm', 'cjs'],
  // esbuild only code-splits ESM by default — without this, the CJS build inlines a
  // separate copy of every shared class (HttpError, most importantly) into each of the
  // three entry points above, so `err instanceof HttpError` is false when the error and
  // the check come from different entry points, even for a single `pnpm add`. Explicit
  // `splitting: true` makes esbuild emit a shared `chunk-*.cjs` that all three `require()`,
  // matching the ESM output's existing behavior. `HttpError.is()` (a `Symbol.for(...)`
  // brand check, not `instanceof`) is the belt to this suspenders — it still holds even
  // across a genuinely separate module graph (duplicate installs npm failed to dedupe,
  // a different realm) that no bundler setting can unify.
  splitting: true,
  dts: true,
  clean: true,
  sourcemap: true,
});
