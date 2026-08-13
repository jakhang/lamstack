# Migrating from `@omnireact/*` to `@lamstack/*`

The `omnireact` repo and its packages have been renamed to `lamstack`, under a single npm
scope (`@lamstack`) with the framework encoded in the package name instead of the scope —
`@lamstack/<target>-<domain>`.

## Package name changes

| Old                     | New                             |
| ------------------------ | --------------------------------- |
| `@omnireact/core`        | `@lamstack/react-core`          |
| `@omnireact/dialog`      | `@lamstack/react-dialog`        |
| `@omnireact/initializer` | `@lamstack/react-initializer`   |

These are **new npm package identities**, not continuations of the old ones — each starts
its own version history on npm rather than picking up where the `@omnireact/*` version left
off. The code and behavior carried over unchanged at the point of rename; only the package
name (and, for `@omnireact/dialog`/`@omnireact/initializer`, their internal dependency on
`@omnireact/core`) changed.

## What to change in your code

Update your `package.json` dependency and every import path:

```diff
-import { useDialogs } from '@omnireact/dialog';
+import { useDialogs } from '@lamstack/react-dialog';
```

```diff
-import { Initializer, useInitializer } from '@omnireact/initializer/react';
+import { Initializer, useInitializer } from '@lamstack/react-initializer/react';
```

```diff
-import { useEventCallback } from '@omnireact/core';
+import { useEventCallback } from '@lamstack/react-core';
```

No exports, APIs, or behavior changed as part of this rename — it's a find-and-replace of
the package name in your imports and `package.json`.

## Old packages

The `@omnireact/core`, `@omnireact/dialog`, and `@omnireact/initializer` packages on npm are
deprecated in favor of the `@lamstack/*` packages above. They are not being unpublished —
existing installs keep working — but they will not receive further updates.
