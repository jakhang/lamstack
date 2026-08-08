import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useEventCallback from './index';

describe('useEventCallback', () => {
  it('returns a stable function reference across re-renders', () => {
    const { result, rerender } = renderHook(({ value }) => useEventCallback(() => value), {
      initialProps: { value: 'a' },
    });

    const firstIdentity = result.current;
    rerender({ value: 'b' });

    expect(result.current).toBe(firstIdentity);
  });

  it('always invokes the latest render logic despite the stable identity', () => {
    const { result, rerender } = renderHook(({ value }) => useEventCallback(() => value), {
      initialProps: { value: 'first' },
    });

    const stableFn = result.current;
    rerender({ value: 'second' });

    expect(stableFn()).toBe('second');
  });
});
