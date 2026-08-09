# Migrating from 0.1 to 0.2

0.2.0 replaces the dependency graph with a linear stage model and moves the React layer
to its own entry point. Every breaking change is listed below with a before/after.

## 1. Import path — the React layer moved to `/react`

`<Initializer>`, `useInitializer()`, and `InitializerContext` are no longer exported from
the package root — they live at `@omnireact/initializer/react`. The root now only exports
the framework-independent core (`createInitializer`, `parallel`, task/state types), which
is what makes it safe to import from a Next.js Server Component without pulling in a
`'use client'` boundary.

```diff
-import { Initializer, parallel, useInitializer } from '@omnireact/initializer';
+import { parallel } from '@omnireact/initializer';
+import { Initializer, useInitializer } from '@omnireact/initializer/react';
```

`createInitializer`, task types (`InitializationTask`, `TaskEntry`, `ParallelGroup`), and
state types stay at the root, unchanged.

## 2. `dependsOn` is gone — restructure into stages

There is no dependency graph anymore. `tasks` is a plain ordered list of stages — a task,
or a `parallel([...])` group — that run one after another. If a task used `dependsOn` to
express "run after X finishes," give it its own stage positioned after X instead; there's
no other way to express one step depending on another's *result* — use `state` for that.

```diff
 const initializeUser = {
   id: 'user',
   run: async ({ state }) => {
     state.set('user', await fetchCurrentUser());
   },
 };

 const initializePermissions = {
   id: 'permissions',
-  dependsOn: ['user'],
   run: async ({ state }) => {
     await loadPermissions(state.get('user'));
   },
 };

 <Initializer tasks={[initializeUser, initializePermissions]}>
```

That example needed no change beyond deleting `dependsOn: ['user']` — the two tasks were
already positioned sequentially, and sequential position *is* the ordering now (it always
partly was; `dependsOn` was only ever needed for edges position alone couldn't express).

If you had two tasks in the same `parallel([...])` group where one depended on the other
via `dependsOn`, split them into two stages instead — that dependency can no longer exist
within a single concurrent stage:

```diff
-tasks={[parallel([taskA, taskB /* dependsOn: ['taskA'] */])]}
+tasks={[taskA, taskB]}
```

## 3. `'skipped'` no longer cascades — check for `'cancelled'` too if you relied on it

Previously, a task was `'skipped'` if a dependency failed, was itself skipped, or was
cancelled. Now `'skipped'` only ever comes from a `condition` returning `false`. A task
that never got a chance to run because the whole run was aborted (a critical failure, or
manual `abort()`) is `'cancelled'` instead — even in cases that used to report
`'skipped'`.

```diff
 const stillPending = tasks.filter(
-  (t) => t.status === 'skipped',
+  (t) => t.status === 'skipped' || t.status === 'cancelled',
 );
```

If you only ever checked `condition`-driven skips, no change needed — that case still
reports `'skipped'` exactly as before.

## 4. `RunnerSnapshot` / `RunnerEvents` renamed

```diff
-import type { RunnerSnapshot, RunnerEvents } from '@omnireact/initializer';
+import type { InitializerSnapshot, InitializerEvents } from '@omnireact/initializer';
```

`InitializerHandle.getSnapshot()`'s return type is the same shape, just renamed.

## 5. `onComplete` now receives the final `state`

```diff
-onComplete: () => {
+onComplete: (state) => {
   console.log('startup finished');
+  console.log('user:', state.get('user'));
 },
```

If you don't need `state`, no change needed — the extra argument is safe to ignore.

## 6. Graph internals no longer exist

`buildGraph`, `executeGraph`, `GraphNode`, and `ExecuteGraphResult` are gone — there's no
graph to expose. If you imported any of these directly (unlikely — they were always
framed as internals), there's no replacement; the stage list itself (`tasks`) is now the
only thing to inspect. `checkTasks(tasks)` (new in 0.2.0) surfaces the dev-mode
diagnostics that used to require reading the graph — see the README.

## Everything else

`retry`, `timeout`, `critical`, `condition`, `parallel()`, `splashScreen`/`errorScreen`,
and the lifecycle events (`onTaskStart`/`onTaskComplete`/`onTaskFailed`/`onError`/
`onAbort`) are unchanged. New, additive-only features (`retryDelay`, `parallel(tasks, {
concurrency })`, `minSplashDuration`, `cancelledScreen`, typed `state`, `label`,
`durationMs`) don't require any changes to existing code.
