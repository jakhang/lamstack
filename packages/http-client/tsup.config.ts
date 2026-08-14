import { defineConfig } from 'tsup';

// Three entries: the core (`.`) and each adapter as its own subpath, so
// importing the package root never pulls in axios or fetch-specific code —
// see SPEC.md §7.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/fetch': 'src/adapters/fetch.adapter.ts',
    'adapters/axios': 'src/adapters/axios.adapter.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
