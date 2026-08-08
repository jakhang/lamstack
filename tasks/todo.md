# Task List: omnireact — dialog + core packages

## Task 1: Repo scaffold — git init, pnpm workspace root, shared configs — DONE

**Description:** Initialize the git repo (remote already exists at
`git@github.com:jakhang/omnireact.git`, add it but do not push), set up the pnpm
workspace root, and add the shared root-level config every package will rely on:
base tsconfig, ESLint flat config, Prettier config, `.gitignore`, `LICENSE` (MIT),
root `package.json` with workspace scripts, and `pnpm-workspace.yaml` covering
`packages/*` and `apps/*`.

**Acceptance criteria:**
- [ ] `git init`, `git remote add origin git@github.com:jakhang/omnireact.git` (no push)
- [ ] `pnpm-workspace.yaml` lists `packages/*` and `apps/*`
- [ ] Root `package.json`: `private: true`, `type: module`, workspace-wide scripts
      (`build`, `test`, `lint`, `typecheck` each running `pnpm -r run <script>`)
- [ ] `tsconfig.base.json` at root (strict mode, `target: ES2020`, `jsx: react-jsx`,
      `moduleResolution: bundler`), referenced by each package's own `tsconfig.json`
- [ ] `eslint.config.js` (flat config): `@eslint/js` recommended, `typescript-eslint`
      recommended, `eslint-plugin-react-hooks` flat recommended — no
      `eslint-plugin-react-refresh` (that's Vite-app-specific, not relevant to a library)
- [ ] `.prettierrc`: `semi: true, singleQuote: true, trailingComma: "all", printWidth: 100`
- [ ] `.gitignore`: `node_modules`, `dist`, `.turbo` (future-proof), `.next`, `*.tsbuildinfo`
- [ ] `LICENSE`: MIT, author line for jakhang, year 2026
- [ ] Root `README.md`: one paragraph describing omnireact as a collection of
      independent headless React packages, links to (future) docs site, install pattern
      (`pnpm add @omnireact/dialog`)
- [ ] `packages/` and `apps/` directories exist (may be empty aside from `.gitkeep` until
      Task 2/5)

**Verification:**
- [ ] `pnpm install` runs clean at root (no packages yet is fine)
- [ ] `git status` shows a clean working tree after the initial commit
- [ ] `git log --oneline` shows exactly one commit

**Dependencies:** None

**Files likely touched:**
- `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `eslint.config.js`,
  `.prettierrc`, `.gitignore`, `LICENSE`, `README.md`

**Estimated scope:** M

---

## Task 2: `@omnireact/core` — port hooks, build, test — DONE

**Description:** Create `packages/core`, port `useEventCallback`,
`useNonNullableContext`, and `useIsomorphicLayoutEffect` from
`D:\Workspace\job\omni.com\dashboard\src\hooks\` verbatim (Prettier-reformatted only, no
logic changes), set up its `package.json`, `tsup.config.ts`, `vitest.config.ts`, and
`tsconfig.json`, and write tests.

**Acceptance criteria:**
- [ ] `packages/core/src/useEventCallback/index.ts` — ported, default export preserved
- [ ] `packages/core/src/useNonNullableContext/index.ts` — ported, named export preserved
- [ ] `packages/core/src/useIsomorphicLayoutEffect/index.ts` — ported, named export preserved
- [ ] `packages/core/src/index.ts` — barrel re-exporting all three
- [ ] `packages/core/package.json`: name `@omnireact/core`, version `0.0.1`, `main`/
      `module`/`types` fields plus an `exports` map with `import`/`require`/`types`
      conditions, `peerDependencies: { react: "^19" }`, `sideEffects: false`
- [ ] `tsup.config.ts`: entry `src/index.ts`, `format: ["esm", "cjs"]`, `dts: true`,
      `clean: true`, banner preserving `"use client"` for the client-only exports (or
      confirm no `"use client"` directive is actually needed here since these are plain
      hooks with no context/provider — check against source before adding)
- [ ] `vitest.config.ts`: `environment: "jsdom"`
- [ ] Tests: `useEventCallback` (stable identity across re-renders, always calls latest
      fn), `useNonNullableContext` (throws on null context, returns value when provided),
      `useIsomorphicLayoutEffect` (resolves to `useLayoutEffect` in a DOM environment)

**Verification:**
- [ ] `pnpm --filter @omnireact/core test` passes
- [ ] `pnpm --filter @omnireact/core build` succeeds, `dist/` contains `.mjs`, `.js` (or
      `.cjs`), and `.d.ts`
- [ ] `pnpm --filter @omnireact/core typecheck` (`tsc --noEmit`) is clean

**Dependencies:** Task 1

**Files likely touched:**
- `packages/core/src/**`, `packages/core/package.json`, `packages/core/tsup.config.ts`,
  `packages/core/vitest.config.ts`, `packages/core/tsconfig.json`

**Estimated scope:** M

---

## Task 3: `@omnireact/dialog` — port dialog code, depend on core, build, test — DONE

**Description:** Create `packages/dialog`, port `dialog.context.ts`,
`dialog.provider.tsx`, `useDialog.tsx`, `types.ts`, `index.ts` from
`D:\Workspace\job\omni.com\dashboard\src\hooks\useDialogs\`, rewrite the two internal
imports (`../useNonNullableContext` and `../useEventCallback`) to `@omnireact/core`, add
`invariant` as a real dependency, and set up build/test tooling matching Task 2's
pattern.

**Acceptance criteria:**
- [ ] All 5 source files ported into `packages/dialog/src/`
- [ ] `useDialog.tsx` imports `useNonNullableContext` from `@omnireact/core`
- [ ] `dialog.provider.tsx` imports `useEventCallback` from `@omnireact/core`
- [ ] `packages/dialog/package.json`: name `@omnireact/dialog`, version `0.0.1`,
      `dependencies: { invariant: "^2.2.4" }`, `devDependencies: { "@types/invariant":
      "^2.2.37" }`, `peerDependencies: { react: "^19" }`, `dependencies: { "@omnireact/core":
      "workspace:*" }`, `exports` map, `sideEffects: false`
- [ ] `tsup.config.ts`, `vitest.config.ts`, `tsconfig.json` mirroring `packages/core`
- [ ] Tests: `DialogsProvider` + `useDialogs()` — opening a dialog renders the component
      with the right payload, `close()` resolves the promise returned by `open()` with the
      result, `onClose` side effect runs and is awaited before the promise resolves (and
      before UI unmount), a rejected/throwing `onClose` still resolves + closes (per the
      `finally` in `dialog.provider.tsx`), `alert`/`confirm`/`prompt` wrap `open` with the
      right template + payload shape

**Verification:**
- [ ] `pnpm --filter @omnireact/dialog test` passes
- [ ] `pnpm --filter @omnireact/dialog build` succeeds, `dist/` contains ESM+CJS+d.ts
- [ ] `pnpm -r typecheck` clean across `core` + `dialog` together (catches any type drift
      from the import rewrite)

**Dependencies:** Task 2

**Files likely touched:**
- `packages/dialog/src/**`, `packages/dialog/package.json`,
  `packages/dialog/tsup.config.ts`, `packages/dialog/vitest.config.ts`,
  `packages/dialog/tsconfig.json`

**Estimated scope:** M

---

## Task 4: Changesets setup — DONE

**Description:** Add Changesets at the root for independent per-package versioning and
changelog generation.

**Acceptance criteria:**
- [ ] `.changeset/config.json` — `access: "restricted"` initially (flip to `"public"`
      when actually publishing is decided, out of scope here), `baseBranch: "main"`,
      `updateInternalDependencies: "patch"`
- [ ] Root `package.json` scripts: `changeset`, `version-packages` (`changeset version`),
      `release` (`pnpm -r build && changeset publish`) — `release` is wired but not run
- [ ] `.changeset/README.md` present (from `changeset init`)

**Verification:**
- [ ] `pnpm changeset status` runs without error (reports "no changesets present" is fine)

**Dependencies:** Task 1

**Files likely touched:**
- `.changeset/config.json`, `package.json`

**Estimated scope:** S

---

## Task 5: Nextra docs site scaffold (`apps/docs`) with a live dialog demo — DONE (see commit for the two real build blockers hit and fixed: missing @types/mdx, and a zod 4.4.x + nextra-theme-docs prerendering bug worked around via pnpm.overrides)

**Description:** Scaffold a Nextra (Next.js + MDX) site under `apps/docs` that depends
on `@omnireact/dialog` via the workspace, with one MDX page containing a live-rendered
demo component (e.g. a button that opens a confirm dialog via `useDialogs()`).

**Acceptance criteria:**
- [ ] `apps/docs/package.json`: `next`, `nextra`, `nextra-theme-docs`,
      `@omnireact/dialog: "workspace:*"`, `@omnireact/core: "workspace:*"`, `react`,
      `react-dom`
- [ ] `apps/docs/next.config.mjs` wired with the Nextra plugin
- [ ] `apps/docs/theme.config.tsx` (or equivalent) with a minimal "omnireact" branding
- [ ] `apps/docs/pages/index.mdx` — landing page
- [ ] `apps/docs/pages/dialog/index.mdx` — imports a demo component
      (`apps/docs/components/DialogDemo.tsx`) that wraps its content in
      `DialogsProvider` (with alert/confirm/prompt templates) and renders a button using
      `useDialogs().confirm(...)`
- [ ] Package `"exports"` maps from Tasks 2/3 resolve correctly under Next.js (this is
      the dual-package-hazard risk flagged in the plan) — verified live, not just by
      `tsc`

**Verification:**
- [ ] `pnpm --filter docs dev` starts the dev server
- [ ] Manually confirmed in a browser: the dialog demo page opens/closes a confirm
      dialog correctly

**Dependencies:** Task 3

**Files likely touched:**
- `apps/docs/**` (new directory)

**Estimated scope:** M

---

## Task 6: `@omnireact/dialog` docs content + package README — DONE

**Description:** Write the actual docs content for the dialog package (quickstart +
API reference) and each package's `README.md` (core + dialog), since Task 5 only
scaffolds the site and one demo page.

**Acceptance criteria:**
- [ ] `apps/docs/pages/dialog/index.mdx` (or a split `quickstart.mdx` +
      `api-reference.mdx`) covers: install (`pnpm add @omnireact/dialog`), wrapping the
      app in `DialogsProvider` with required `templates`, `useDialogs()` return shape
      (`open`, `close`, `alert`, `confirm`, `prompt`), a custom dialog component example
      using `DialogProps<P, R>`
- [ ] `packages/dialog/README.md`: install, minimal usage example, link to the docs site
- [ ] `packages/core/README.md`: what it's for (shared internal-ish utilities other
      `@omnireact/*` packages depend on), lists the three exported hooks, notes it's
      usable standalone too

**Verification:**
- [ ] Docs pages render without MDX errors (`pnpm --filter docs build`)
- [ ] Every code example in the dialog docs is copy-paste valid against the actual
      package API (cross-check against `packages/dialog/src/types.ts`)

**Dependencies:** Task 5

**Files likely touched:**
- `apps/docs/pages/dialog/**`, `packages/dialog/README.md`, `packages/core/README.md`

**Estimated scope:** S

---

## Task 7: Tailwind CSS live demo — DONE

**Description:** Add a real, verified-interactive dialog demo styled with Tailwind CSS.
The earlier generic inline-style demo (removed) had real bugs — a made-up `--nextra-bg`
CSS variable and no dark-mode contrast handling — that only surfaced when actually driven
with a headless browser, not from code review. This task and Tasks 8-9 must each be
verified the same way: headless Chrome click-through, in both light and dark mode, not
just a successful build.

**Acceptance criteria:**
- [ ] `tailwindcss` + `@tailwindcss/postcss` (or current Next.js-recommended Tailwind v4
      setup) added to `apps/docs`
- [ ] A dialog demo component styled entirely with Tailwind utility classes (no inline
      `style` objects), covering at least the confirm flow
- [ ] Embedded live in a docs page (new "Guides" section, see Task 10)

**Verification:**
- [ ] `pnpm --filter docs build` succeeds
- [ ] Headless Chrome: click the trigger button, assert the dialog appears with expected
      text, in both `prefers-color-scheme: light` and `dark`
- [ ] No made-up CSS custom properties — every variable referenced must be verified to
      actually exist (grep the actual installed CSS, don't assume)

**Dependencies:** Task 6

**Files likely touched:**
- `apps/docs/package.json`, `apps/docs/postcss.config.*` or equivalent,
  `apps/docs/content/dialog/**`, a new demo component under `apps/docs/components/`

**Estimated scope:** M

---

## Task 8: MUI live demo — DONE

**Description:** Add a real, verified-interactive dialog demo built with MUI's `Dialog`/
`Button` components, wired to `@omnireact/dialog`'s templates.

**Acceptance criteria:**
- [ ] `@mui/material`, `@emotion/react`, `@emotion/styled` added to `apps/docs`
- [ ] Emotion SSR cache correctly configured for the Next.js App Router (check current
      official guidance/package — e.g. `@mui/material-nextjs`'s `AppRouterCacheProvider` —
      rather than assuming the Pages Router setup still applies)
- [ ] A dialog demo using real MUI components for the confirm flow
- [ ] Embedded live in a docs page (Task 10's "Guides" section)

**Verification:**
- [ ] `pnpm --filter docs build` succeeds with no SSR/hydration warnings from Emotion in
      the server logs
- [ ] Headless Chrome: click-through verified same as Task 7, light and dark mode

**Dependencies:** Task 6 (parallelizable with Task 7)

**Files likely touched:**
- `apps/docs/package.json`, `apps/docs/app/layout.tsx` (cache provider),
  `apps/docs/content/dialog/**`, a new demo component

**Estimated scope:** M

---

## Task 9: shadcn/ui live demo — DONE

**Description:** Add a real, verified-interactive dialog demo using shadcn/ui's actual
`Dialog` component (Radix UI primitive + Tailwind), wired to `@omnireact/dialog`.

**Acceptance criteria:**
- [ ] Run the real `shadcn` CLI (`npx shadcn@latest add dialog` or current equivalent) to
      scaffold the component into `apps/docs` — do **not** hand-write shadcn's component
      source from memory; its conventions (e.g. `data-slot` attributes, exact class names)
      change between versions and must come from the actual tool output
- [ ] Requires Tailwind already set up (shared with Task 7)
- [ ] A dialog demo using the scaffolded shadcn `Dialog` for the confirm flow
- [ ] Embedded live in a docs page (Task 10's "Guides" section)

**Verification:**
- [ ] `pnpm --filter docs build` succeeds
- [ ] Headless Chrome: click-through verified same as Task 7, light and dark mode

**Dependencies:** Task 7 (needs Tailwind already configured)

**Files likely touched:**
- `apps/docs/components/ui/dialog.tsx` (shadcn-generated), `apps/docs/package.json`,
  `apps/docs/content/dialog/**`, a new demo component

**Estimated scope:** M

---

## Task 10: Docs nav for the Guides section — DONE

**Description:** Add a "Guides" (or "Recipes") section to the docs nav linking the
Tailwind/MUI/shadcn demo pages from Tasks 7-9, and replace the "live demos are coming"
note in `content/dialog/index.mdx` with real links.

**Acceptance criteria:**
- [ ] `content/_meta.ts` (or a new `content/guides/_meta.ts`) lists all three guide pages
- [ ] `content/dialog/index.mdx`'s placeholder note replaced with links to the three guides

**Verification:**
- [ ] `pnpm --filter docs build` succeeds; nav renders all three links correctly

**Dependencies:** Tasks 7, 8, 9

**Files likely touched:**
- `apps/docs/content/**`

**Estimated scope:** S
