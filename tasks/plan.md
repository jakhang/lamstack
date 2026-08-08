# Implementation Plan: omnireact — dialog + core packages

## Overview

Bootstrap `omnireact`, an MIT-licensed pnpm-workspaces monorepo of independent headless
React packages. This pass builds the foundation and the first two packages:
`@omnireact/core` (shared utilities) and `@omnireact/dialog` (headless imperative dialog
API, ported from `D:\Workspace\job\omni.com\dashboard\src\hooks\useDialogs`). Each
feature package depends only on `@omnireact/core`, never on a sibling feature package, so
`pnpm add @omnireact/dialog` never pulls in unrelated packages. Out of scope for this
pass: touching the `dashboard` app, Turborepo, the `initializer`/`data` packages, and any
real `git push` / `npm publish`.

## Architecture Decisions

- **pnpm workspaces only (no Turborepo).** pnpm's recursive commands already
  topologically order builds by `dependencies`; caching/remote-cache benefits of
  Turborepo aren't worth the extra config with only 2 packages. Addable later without
  restructuring.
- **`packages/core` holds cross-cutting hooks with no feature identity.** Source audit of
  `useDialogs` found three internal dependencies, not two: `useEventCallback` →
  `useIsomorphicLayoutEffect`, and `useNonNullableContext`. All three move to core so
  `dialog` has exactly one internal dependency edge (`@omnireact/core`).
- **tsup per package**, dual ESM+CJS output + `.d.ts`, `"use client"` banner preserved
  (source files already have it) for Next.js App Router compatibility.
- **Vitest + Testing Library + jsdom per package**, run independently (`pnpm -r test`).
- **Changesets at the root**, one config, independent versioning per package.
- **Nextra docs site under `apps/docs`**, MDX pages with live-rendered React demo
  components imported directly from `@omnireact/dialog` via the workspace link — no
  separate demo app.
- **ESLint (flat config) + Prettier at the root**, mirroring `dashboard`'s setup
  (`typescript-eslint`, `eslint-plugin-react-hooks`) minus Vite/React-refresh-specific
  bits that don't apply to a library. Prettier config: `semi: true, singleQuote: true` —
  standard for published TS libraries (source files are currently inconsistent between
  semi/no-semi; Prettier will normalize on move).
- **React `^19` peer dependency**, matching `dashboard`.
- **`invariant` becomes a real dependency of `@omnireact/dialog`** (used in
  `dialog.provider.tsx`), same version dashboard uses (`^2.2.4`), with `@types/invariant`
  as a devDependency.

## Source Inventory (already read, ground truth for the port)

From `D:\Workspace\job\omni.com\dashboard\src\hooks\`:
- `useDialogs/{dialog.context.ts, dialog.provider.tsx, useDialog.tsx, types.ts, index.ts}`
  → becomes `packages/dialog/src/*`
- `useEventCallback/index.ts` (default export, depends on `useIsomorphicLayoutEffect`)
  → `packages/core/src/useEventCallback/index.ts`
- `useNonNullableContext/index.ts` (named export)
  → `packages/core/src/useNonNullableContext/index.ts`
- `useIsomorphicLayoutEffect/index.ts` (named export, SSR-safe layout effect)
  → `packages/core/src/useIsomorphicLayoutEffect/index.ts`

Import rewrites needed when porting `dialog`:
- `useDialog.tsx`: `../useNonNullableContext` → `@omnireact/core`
- `dialog.provider.tsx`: `../useEventCallback` → `@omnireact/core`

## Task List

### Phase 1: Foundation

- [x] Task 1: Repo scaffold — git init, pnpm workspace root, shared configs

### Checkpoint: Foundation
- [x] `pnpm install` succeeds at root
- [x] `git log` shows an initial commit
- [x] `pnpm -r lint` runs (no packages yet, but config is valid)

### Phase 2: Core package

- [x] Task 2: `@omnireact/core` — port hooks, build, test

### Checkpoint: Core
- [x] `pnpm --filter @omnireact/core build` succeeds, emits ESM+CJS+d.ts
- [x] `pnpm --filter @omnireact/core test` passes

### Phase 3: Dialog package

- [x] Task 3: `@omnireact/dialog` — port dialog code, depend on core, build, test

### Checkpoint: Dialog
- [x] `pnpm --filter @omnireact/dialog build` succeeds
- [x] `pnpm --filter @omnireact/dialog test` passes
- [x] `pnpm -r typecheck` clean across both packages

### Phase 4: Versioning

- [ ] Task 4: Changesets setup

### Phase 5: Docs

- [ ] Task 5: Nextra docs site scaffold (`apps/docs`) with a live dialog demo
- [ ] Task 6: `@omnireact/dialog` docs content (quickstart + API reference) and package
      `README.md`

### Checkpoint: Complete
- [ ] `pnpm -r build` succeeds for all packages
- [ ] `pnpm -r test` passes for all packages
- [ ] `pnpm --filter docs dev` serves the docs site with a working live dialog demo
- [ ] Root `README.md`, `LICENSE` (MIT), and per-package `README.md` exist

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nextra + React 19 + this tsup-built ESM/CJS package resolution mismatch (dual package hazard) | Med | Use `"exports"` map with explicit `import`/`require`/`types` conditions in each package.json; verify by actually running the docs dev server against the workspace-linked package in Task 5, not just building in isolation. |
| Prettier reformatting on port changes diffs enough to obscure review | Low | Format immediately after copying, before making logic edits, so the "port" commit is copy+format only and any later logic changes show a clean diff. |
| `invariant`'s CJS-only types interacting oddly with tsup ESM output | Low | Known-working combination (dashboard already uses it under Vite); confirm via the package's own build+test in Task 3. |

## Open Questions

None outstanding — all resolved during the interview (see prior conversation for the
confirmed Outcome/User/Why-now/Success/Constraint/Out-of-scope summary).
