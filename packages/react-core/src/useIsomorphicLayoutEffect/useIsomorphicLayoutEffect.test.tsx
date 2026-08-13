import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { useIsomorphicLayoutEffect } from './index';

describe('useIsomorphicLayoutEffect', () => {
  it('resolves to useLayoutEffect when a DOM is present (jsdom test environment)', () => {
    expect(useIsomorphicLayoutEffect).toBe(React.useLayoutEffect);
  });
});
