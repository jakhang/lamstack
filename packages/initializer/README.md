# @omnireact/initializer

A lightweight application-startup orchestrator for React. `<Initializer>` runs a
dependency graph of async tasks — sequential, parallel, or explicitly interdependent —
before rendering your app, with retry, timeout, and critical/non-critical failure
handling built in. The task runner itself has no React dependency; the React layer is a
thin adapter on top of it.

## Install

```bash
pnpm add @omnireact/initializer
```

## Usage

```tsx
import { Initializer, parallel, useInitializer } from '@omnireact/initializer';
import type { InitializationTask } from '@omnireact/initializer';

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

const initializeAnalytics: InitializationTask = {
  id: 'analytics',
  critical: false, // optional — a failure here doesn't block the app
  run: async () => {
    await initAnalytics();
  },
};

function App() {
  return (
    <Initializer tasks={[initializeConfig, initializeAuth, parallel([initializeAnalytics])]}>
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

- **Sequential by default** — tasks run one after another, in array order.
- **`parallel([...])`** — batches tasks to run concurrently; the initializer waits for
  every task in the batch before moving on to whatever comes next.
- **`dependsOn: string[]`** — an explicit dependency on another task's `id`, for edges
  that array position alone can't express (e.g. two tasks in the same `parallel()` batch
  where one still needs to wait for the other).
- **`critical`** — defaults to `true`: a failing task halts the whole sequence and shows
  the error screen. Set `critical: false` for optional work (analytics, prefetching,
  telemetry) that shouldn't block startup if it fails.
- **`retry: number`** — total attempts (default 1, i.e. no retry), run back-to-back with
  no delay.
- **`timeout: number`** — max time in ms per attempt before it's treated as a failure.
- **`condition`** — an optional async predicate; returning `false` skips the task (and,
  transitively, anything that `dependsOn` it).
- **Cascade skipping** — a task whose dependency didn't complete successfully (failed,
  was skipped, or was cancelled) is itself skipped rather than run.
- **`state`** — a shared key/value bag passed to every task via context
  (`{ signal, state }`), for passing data between tasks: `state.set('user', user)` in one
  task, `state.get('user')` in a dependent one.
- **Retry from the UI** — `useInitializer()` returns `{ status, progress, tasks, error,
  retry, abort }`; the built-in error screen's "Retry" button calls `retry()` too.
- **Custom UI** — pass `splashScreen`/`errorScreen` components to replace the plain
  built-in defaults.
- **Lifecycle events** — `onTaskStart`, `onTaskComplete`, `onTaskFailed`, `onComplete`,
  `onError`, `onAbort` props on `<Initializer>`, for logging/telemetry.

## Framework-independent core

`createInitializer` runs the same task graph outside of React entirely:

```ts
import { createInitializer } from '@omnireact/initializer';

const initializer = createInitializer({ tasks });
initializer.subscribe(() => console.log(initializer.getSnapshot()));
await initializer.run();

// later, e.g. on unmount or navigation away:
initializer.abort();
```

Full docs and API reference: **[omnireact-six.vercel.app/initializer](https://omnireact-six.vercel.app/initializer)**

## License

MIT
