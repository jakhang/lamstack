import * as React from 'react';

const canUseDOM =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
  typeof (globalThis as { document?: unknown }).document !== 'undefined';

/**
 * SSR-safe layout effect: avoids the "useLayoutEffect does nothing on the
 * server" warning by falling back to useEffect when no DOM is present.
 */
export const useIsomorphicLayoutEffect = canUseDOM ? React.useLayoutEffect : React.useEffect;
