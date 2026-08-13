import { defineConfig } from 'tsup';

// The whole package is a client boundary now that the React layer lives at
// the root (no more separate framework-independent entry point) — esbuild
// strips source-level `'use client'` directives when bundling, so it's
// re-added here via `banner`.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['react', '@lamstack/initializer'],
  banner: { js: "'use client';" },
});
