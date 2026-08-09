// Guards task 2 of the 0.2.0 release against silently regressing: the core
// entry (`dist/index.*`) must stay safely importable from a Server Component
// (no 'use client'), while the React entry (`dist/react.*`) must actually
// carry the directive esbuild would otherwise strip when bundling. Run
// automatically as part of `pnpm build` — see package.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const mustNotHaveUseClient = ['index.js', 'index.cjs'];
const mustHaveUseClient = ['react.js', 'react.cjs'];

let failed = false;

for (const file of mustNotHaveUseClient) {
  const contents = readFileSync(path.join(distDir, file), 'utf8');
  if (contents.includes("'use client'")) {
    console.error(`✗ dist/${file} must NOT contain 'use client' — the core entry has to stay Server Component safe.`);
    failed = true;
  }
}

for (const file of mustHaveUseClient) {
  const contents = readFileSync(path.join(distDir, file), 'utf8');
  if (!contents.trimStart().startsWith("'use client'")) {
    console.error(`✗ dist/${file} must start with 'use client' — it was stripped or misplaced during bundling.`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('✓ dist/index.* has no "use client"; dist/react.* starts with it.');
