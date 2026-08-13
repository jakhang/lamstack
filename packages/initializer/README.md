# @lamstack/initializer

Framework-agnostic core of the `lamstack` app-startup orchestrator: `createInitializer`
runs a sequence of stages — a task, or several running concurrently via `parallel([...])`
— with retry, timeout, and critical/non-critical failure handling, and no dependency on
React or any other UI framework. Safe to import anywhere, including a Next.js Server
Component.

For a React app, use [`@lamstack/react-initializer`](../react-initializer) instead — it
depends on this package and adds `<Initializer>`/`useInitializer()`, re-exporting
everything here from its own root so you only need one import.

## Install

```bash
pnpm add @lamstack/initializer
```

## Usage

```ts
import { createInitializer, parallel } from '@lamstack/initializer';
import type { InitializationTask } from '@lamstack/initializer';

const initializeConfig: InitializationTask = {
  id: 'config',
  run: async ({ state }) => {
    state.set('config', await loadConfig());
  },
};

const initializer = createInitializer({ tasks: [initializeConfig] });
initializer.subscribe(() => console.log(initializer.getSnapshot()));
await initializer.run();

console.log(initializer.getState().get('config'));

// later, e.g. on unmount or navigation away:
initializer.abort();
```

## Concepts

- **Stages run in order** — `tasks` is a list of stages, each either one task or a
  `parallel([...])` group; the run waits for a stage to fully settle before starting the
  next one. There's no dependency graph and no `dependsOn` — that's the whole ordering
  model.
- **`parallel(tasks, { concurrency? })`** — runs its tasks concurrently as a single
  stage. `concurrency` caps how many run at once (e.g. to avoid firing 50 simultaneous
  requests) — omit it for no cap.
- **`critical`** — defaults to `true`: a failing task aborts the whole run. Set
  `critical: false` for work that must be attempted before render but can survive
  failing — the run continues to the next stage regardless.
- **`retry`/`retryDelay`** — total attempts (default 1, no retry), with an optional delay
  (a number, or `(attempt) => ms` for backoff) between them.
- **`timeout`** — max time in ms per attempt before it's treated as a failure — trips
  `context.signal` for that specific attempt.
- **`condition`** — an optional async predicate; returning `false` skips the task.
- **`onStart`/`onSuccess`/`onError`** — optional per-task lifecycle callbacks, in addition
  to the run-wide `onTaskStart`/`onTaskComplete`/`onTaskFailed` events passed to
  `createInitializer`.
- **`state`** — a shared key/value bag passed to every task via context
  (`{ signal, state }`), for passing data between tasks. Parameterize
  `InitializationTask<{ user: User }>` (and `createInitializer<{ user: User }>()`) for
  `state.get`/`.set` checked and inferred per key instead of `unknown`.

## Debugging

Outside `NODE_ENV=production`, `createInitializer` logs a `console.warn` for a task with
`retry` set but no `timeout`, and for a `critical: false` task placed in its own
sequential stage. Call `checkTasks(tasks)` to get these as a plain `string[]` yourself.

## License

MIT
