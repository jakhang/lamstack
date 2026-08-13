---
"@lamstack/initializer": minor
"@lamstack/react-initializer": patch
---

Added per-task lifecycle callbacks to `InitializationTask`: `onStart`, `onSuccess`, and
`onError`, each scoped to that one task (in addition to the existing run-wide
`onTaskStart`/`onTaskComplete`/`onTaskFailed` events passed to `createInitializer`/
`<Initializer>`). `onError` receives `(error, context)`; `onStart`/`onSuccess` receive
`(context)`.
