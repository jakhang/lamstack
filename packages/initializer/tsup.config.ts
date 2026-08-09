import { defineConfig } from 'tsup';

// Two separate bundles, not one: `src/index.ts` (the framework-independent
// core — createInitializer, task/state types) must stay safely importable
// from a Server Component, so it must NOT carry a `'use client'` banner.
// `src/react.ts` (Initializer, useInitializer) is the client boundary and
// needs one. esbuild strips source-level `'use client'` directives when
// bundling, so it's re-added here via `banner`, scoped to just that entry.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['react'],
  },
  {
    entry: { react: 'src/react.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    external: ['react'],
    banner: { js: "'use client';" },
  },
]);
