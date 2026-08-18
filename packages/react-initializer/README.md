# @lamstack/react-initializer

A lightweight application-startup orchestrator for React. `<Initializer>` runs a sequence
of stages — a task, or several running concurrently via `parallel([...])` — before
rendering your app, with retry, timeout, and critical/non-critical failure handling built
in. This package is `'use client'` throughout; it wraps
[`@lamstack/initializer`](../initializer), the framework-agnostic task runner, and
re-exports its whole API from this package's root.

> **Pre-1.0** (`0.x`): the API may still change between minor versions.
>
> If you only need the task runner without React — e.g. to keep a module safely
> importable from a Next.js Server Component — install
> [`@lamstack/initializer`](../initializer) directly instead of this package.

## Install

```bash
pnpm add @lamstack/react-initializer
```

## Usage

```tsx
import { parallel, Initializer, useInitializer } from '@lamstack/react-initializer';
import type { InitializationTask } from '@lamstack/react-initializer';

const initializeConfig: InitializationTask = {
  id: 'config',
  run: async ({ state }) => {
    state.set('config', await loadConfig());
  },
};

const initializeAuth: InitializationTask = {
  id: 'auth',
  critical: true,
  retry: 3,
  run: async () => {
    await restoreSession();
  },
};

const initializeTranslations: InitializationTask = {
  id: 'translations',
  critical: false, // must be attempted, but a fallback locale covers a failure
  run: async ({ state }) => {
    state.set('translations', await loadTranslations());
  },
};

function App() {
  return (
    <Initializer tasks={[initializeConfig, initializeAuth, parallel([initializeTranslations])]}>
      <Dashboard />
    </Initializer>
  );
}

function Dashboard() {
  const { retry } = useInitializer();
  return <button onClick={retry}>Reload app</button>;
}
```

## Concepts

- **Stages run in order** — `tasks` is a list of stages, each either one task or a
  `parallel([...])` group; the run waits for a stage to fully settle before starting the
  next one. There's no dependency graph and no `dependsOn` — that's the whole ordering
  model.
- **`parallel(tasks, { concurrency? })`** — runs its tasks concurrently as a single
  stage. `concurrency` caps how many run at once (e.g. to avoid firing 50 simultaneous
  requests) — omit it for no cap.
- **`critical`** — defaults to `true`: a failing task aborts the whole run and shows the
  error screen. Set `critical: false` for work that must be attempted before render but
  can survive failing (e.g. loading translations, with a hardcoded fallback locale) — the
  run continues to the next stage regardless.
- **`retry`/`retryDelay`** — total attempts (default 1, no retry), with an optional delay
  (a number, or `(attempt) => ms` for backoff) between them. Defaults to 0 (back-to-back).
- **`timeout`** — max time in ms per attempt before it's treated as a failure — trips
  `context.signal` for that specific attempt, so code that checks it (an abortable delay,
  `fetch(url, { signal })`) can actually stop instead of running on in the background.
- **`condition`** — an optional async predicate; returning `false` skips the task — the
  only source of a `'skipped'` status. Everything that never got a chance to run because
  the whole run was aborted (a critical failure, or manual `abort()`) ends up
  `'cancelled'` instead.
- **`label`** — optional human-readable name for UI, surfaced on `TaskSnapshot` — falls
  back to `id` if unset.
- **`state`** — a shared key/value bag passed to every task via context
  (`{ signal, state }`), for passing data between tasks. Stays readable once the run
  finishes, via `getState()` (on the handle, or `useInitializer()`) or the `onComplete`
  event. Parameterize `InitializationTask<{ user: User }>` (and
  `createInitializer<{ user: User }>()` / `<Initializer<{ user: User }>>`) for
  `state.get`/`.set` checked and inferred per key instead of `unknown`.
- **Custom UI** — pass `splashScreen`/`errorScreen`/`cancelledScreen` components to
  replace the plain built-in defaults. `minSplashDuration` keeps the splash up for a
  minimum duration once shown, to avoid a jarring flash on runs that are fast but not
  instant.
- **Lifecycle events** — `onTaskStart`, `onTaskComplete`, `onTaskFailed`, `onComplete`,
  `onError`, `onAbort` props on `<Initializer>`, for logging/telemetry.

## Debugging

Outside `NODE_ENV=production`, `createInitializer` logs a `console.warn` for a task with
`retry` set but no `timeout` (a hung attempt blocks every retry after it), and for a
`critical: false` task placed in its own sequential stage (the next stage still waits for
it to settle, even though its failure won't halt the run). Call `checkTasks(tasks)` to
get these as a plain `string[]` yourself — e.g. to assert on in a test.

## Framework-independent core

`createInitializer` (re-exported here, or imported directly from
[`@lamstack/initializer`](../initializer)) runs the same stage list outside of React
entirely:

```ts
import { createInitializer } from '@lamstack/initializer';

const initializer = createInitializer({ tasks });
initializer.subscribe(() => console.log(initializer.getSnapshot()));
await initializer.run();

console.log(initializer.getState().get('user'));

// later, e.g. on unmount or navigation away:
initializer.abort();
```

## Non-goals

`@lamstack/react-initializer` does exactly one thing: run a sequence of async startup steps
before rendering the app. It is deliberately not a data-fetching layer, not a background
job scheduler, and not a general dependency-graph runner — ordering is exactly the stage
list plus `parallel()` within a stage, nothing more. It also has no SSR/Suspense
integration and no cross-reload caching: every mount (or `retry()`) is a fresh run, fresh
`state`, fresh `AbortController`.

Full docs and API reference: **[lamstack-docs.vercel.app/initializer](https://lamstack-docs.vercel.app/initializer)**

## License

MIT
