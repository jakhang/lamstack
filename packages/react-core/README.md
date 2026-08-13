# @lamstack/react-core

Shared hooks used internally by `@lamstack/react-*` packages. Not feature-specific — usable
standalone in any React 18+ project.

Docs: **[omnireact-six.vercel.app](https://omnireact-six.vercel.app)**

## Install

```bash
pnpm add @lamstack/react-core
```

## Exports

| Export                           | Description                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useEventCallback(fn)`           | Returns a stable function reference that always calls the latest `fn`, without becoming a stale closure. Useful for passing callbacks to memoized children. |
| `useNonNullableContext(context)` | Reads a `React.Context<T \| null>` and throws if the value is `null` (i.e. no provider is mounted), instead of returning `null` silently.                   |
| `useIsomorphicLayoutEffect`      | `useLayoutEffect` on the client, `useEffect` on the server — avoids the SSR warning from calling `useLayoutEffect` outside the browser.                     |

```ts
import {
  useEventCallback,
  useNonNullableContext,
  useIsomorphicLayoutEffect,
} from '@lamstack/react-core';
```

## License

MIT
