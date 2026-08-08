import * as React from 'react';
import { useIsomorphicLayoutEffect } from '../useIsomorphicLayoutEffect';

/**
 * Maintains a stable function reference (identity) while always executing
 * the latest render's logic. Useful for passing callbacks to memoized
 * components without them becoming stale closures.
 */
function useEventCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const ref = React.useRef(fn);

  useIsomorphicLayoutEffect(() => {
    ref.current = fn;
  });

  // Lazy useState initializer runs exactly once; the returned wrapper only
  // reads `ref.current` when actually called (an event handler/effect, never
  // render), so identity stays stable without touching a ref during render.
  const [stableCallback] = React.useState<(...args: Args) => Return>(() => {
    return (...args: Args) => ref.current(...args);
  });

  return stableCallback;
}

export default useEventCallback;
