import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/.next/**', '**/node_modules/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // @lamstack/react-core depends on nothing else in the repo.
    files: ['packages/react-core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@lamstack/react-dialog', '@lamstack/react-initializer', '@lamstack/initializer'] },
      ],
    },
  },
  {
    // @lamstack/initializer (framework-agnostic) depends on nothing else in the repo.
    files: ['packages/initializer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@lamstack/react-core', '@lamstack/react-dialog', '@lamstack/react-initializer'] },
      ],
    },
  },
  {
    // @lamstack/react-dialog may only depend on @lamstack/react-core — no lateral imports.
    files: ['packages/react-dialog/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@lamstack/react-initializer', '@lamstack/initializer'] },
      ],
    },
  },
  {
    // @lamstack/react-initializer may only depend on @lamstack/initializer — no lateral imports.
    files: ['packages/react-initializer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@lamstack/react-dialog', '@lamstack/react-core'] }],
    },
  },
  {
    // @lamstack/http-client's core/plugins/serializers must not import axios directly —
    // only adapters/axios.adapter(.test).ts (exempted below) may.
    files: ['packages/http-client/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['axios'] }],
    },
  },
  {
    files: [
      'packages/http-client/src/adapters/axios.adapter.ts',
      'packages/http-client/src/adapters/axios.adapter.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]);
