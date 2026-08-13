---
"@lamstack/initializer": minor
"@lamstack/react-initializer": minor
---

Extracted the framework-independent task runner into a new package,
`@lamstack/initializer` (pure TS, no React dependency — safe for Server Components).

`@lamstack/react-initializer` now depends on it and re-exports its whole API from the
package root. The separate `/react` entry point is gone — `<Initializer>` and
`useInitializer()` now live at `@lamstack/react-initializer`'s root, alongside
`createInitializer`/`parallel`/task types. This means the whole package is now
`'use client'`; code that needs the task runner without pulling in React (e.g. inside a
Server Component) should depend on `@lamstack/initializer` directly instead. See
`packages/react-initializer/MIGRATION.md` for the full before/after.
