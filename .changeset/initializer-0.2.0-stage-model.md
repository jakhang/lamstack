---
"@omnireact/initializer": minor
---

**0.2.0 — scope-narrowing and bug-fixing release.** `@omnireact/initializer` does exactly
one thing: run a sequence of async startup steps before rendering the app. This release
removes everything that served a broader ambition than that, and fixes every bug that
ambition was causing. Breaking changes are bundled into this one release rather than
spread across several — see `MIGRATION.md` for a full before/after.

## Breaking

- **Replaced the dependency graph with a linear stage model.** `tasks` is now a plain
  ordered list of stages (a task, or a `parallel([...])` group) that run one after
  another — no more implicit position-based "barrier", no `dependsOn`, no cycle
  detection. `InitializationTask.dependsOn` is removed. If two steps genuinely depend on
  each other, put them in separate, ordered stages and pass data via `state`.
- **`'skipped'` now only comes from a `condition` returning `false`.** The old
  cascade-skip rule (a task skipped because its dependency didn't complete) is gone —
  there's no dependency to cascade from anymore. A task that never got a chance to run
  because the whole run was aborted (a critical failure, or manual `abort()`) is
  `'cancelled'` instead, even if that would previously have been `'skipped'`.
- **`RunnerSnapshot`/`RunnerEvents` renamed to `InitializerSnapshot`/`InitializerEvents`**
  — consistent with the rest of the public, machinery-facing API.
- **`onComplete` now receives the final `state`**: `onComplete: (state) => void`, not
  `() => void`. See "New" below.
- **`buildGraph`/`executeGraph`/`GraphNode`/`ExecuteGraphResult` and other DAG internals
  no longer exist** — there's no graph to expose. The public surface is now
  `createInitializer`/`parallel`/task/state types, `<Initializer>`/`useInitializer` (at
  `@omnireact/initializer/react`), and the dev-diagnostics helpers below.
- **`<Initializer>`/`useInitializer`/`InitializerContext` moved to
  `@omnireact/initializer/react`.** The package root only exports the
  framework-independent core, so it's safely importable from a Server Component — see
  "Fixed" below. `'use client'` is now verified present in the React build output and
  absent from the core build output by an automated check wired into `pnpm build`.

## Fixed

- `'use client'` was silently stripped from the bundled output by esbuild, breaking
  `<Initializer>` in the Next.js App Router.
- `timeout` didn't actually cancel a timed-out attempt — the work kept running in the
  background, retries overlapped (three attempts could be in flight simultaneously), and
  `context.signal` never tripped, so a task checking it had no way to bail. Each attempt
  now gets its own signal, scoped to that attempt.
- `status: 'cancelled'` left `<Initializer>` stuck showing the splash screen forever — it
  now shows a dedicated, customizable `cancelledScreen`.
- A failing `critical: false` task no longer needs a special case to avoid swallowing a
  later critical task — under the stage model, a non-critical failure simply doesn't stop
  the next stage from starting, which is now true by construction rather than by a
  cascade-skip carve-out.
- The default error screen no longer renders `[object Object]` for a thrown non-`Error`
  value.

## New

- **`state` is now readable after the run completes** — via `getState()` on the
  `InitializerHandle` / `useInitializer()`, or the `state` argument now passed to
  `onComplete`.
- **`TaskSnapshot` gained `label`, `error`, and `durationMs`.** A non-critical failure's
  error was previously only reachable via the `onTaskFailed` event, invisible to any UI
  driven off snapshots alone.
- **`retryDelay`** on a task: a number, or `(attempt) => ms` for backoff between retries.
- **`parallel(tasks, { concurrency })`** caps how many of a stage's tasks run at once.
- **Typed `state`**: parameterize `InitializationTask<S>` / `createInitializer<S>()` /
  `<Initializer<S>>` with a `StateMap` to get `state.get`/`.set` checked and inferred per
  key instead of `unknown`.
- **Dev-mode diagnostics** (outside `NODE_ENV=production`, via `console.warn`): a task
  with `retry` but no `timeout`; a `critical: false` task placed in its own sequential
  stage (its failure won't block the run, but the next stage still waits for it to
  settle). Call `checkTasks(tasks)` to get these as a plain `string[]` instead of relying
  on the console.
- Default splash/error/cancelled screens now carry `role="status"`/`aria-live`/
  `aria-busy`/`role="alert"`.

See `MIGRATION.md` in this package for the full 0.1 → 0.2 upgrade guide.
