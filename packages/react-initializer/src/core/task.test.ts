import { describe, expect, it } from 'vitest';
import { isParallelGroup, parallel } from './task';
import type { InitializationTask } from './task';

function task(id: string): InitializationTask {
  return { id, run: async () => {} };
}

describe('parallel', () => {
  it('wraps tasks into a ParallelGroup', () => {
    const tasks = [task('a'), task('b')];
    expect(parallel(tasks)).toEqual({ type: 'parallel', tasks });
  });
});

describe('isParallelGroup', () => {
  it('distinguishes a ParallelGroup from a plain task', () => {
    expect(isParallelGroup(parallel([task('a')]))).toBe(true);
    expect(isParallelGroup(task('a'))).toBe(false);
  });
});
