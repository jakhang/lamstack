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
        { patterns: ['@lamstack/react-dialog', '@lamstack/react-initializer'] },
      ],
    },
  },
  {
    // Feature packages may only depend on @lamstack/react-core — no lateral imports.
    files: ['packages/react-dialog/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@lamstack/react-initializer'] }],
    },
  },
  {
    files: ['packages/react-initializer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@lamstack/react-dialog'] }],
    },
  },
]);
