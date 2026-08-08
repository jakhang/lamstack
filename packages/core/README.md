# @omnireact/core

Shared hooks used internally by `@omnireact/*` packages. Not feature-specific — usable
standalone in any React 19 project.

## Install

```bash
pnpm add @omnireact/core
```

## Exports

| Export | Description |
| --- | --- |
| `useEventCallback(fn)` | Returns a stable function reference that always calls the latest `fn`, without becoming a stale closure. Useful for passing callbacks to memoized children. |
| `useNonNullableContext(context)` | Reads a `React.Context<T \| null>` and throws if the value is `null` (i.e. no provider is mounted), instead of returning `null` silently. |
| `useIsomorphicLayoutEffect` | `useLayoutEffect` on the client, `useEffect` on the server — avoids the SSR warning from calling `useLayoutEffect` outside the browser. |

```ts
import { useEventCallback, useNonNullableContext, useIsomorphicLayoutEffect } from '@omnireact/core';
```

## License

MIT
