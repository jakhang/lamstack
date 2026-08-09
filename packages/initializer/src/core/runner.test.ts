import { describe, expect, it, vi } from 'vitest';
import { buildGraph, executeGraph, InitializerTimeoutError } from './runner';
import { createInitializationState } from './state';
import { parallel, type InitializationTask } from './task';
import type { RunnerEvents, RunnerSnapshot } from './runner';

function task(id: string, overrides: Partial<InitializationTask> = {}): InitializationTask {
  return { id, run: async () => {}, ...overrides };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Runs `entries` to completion with no-op events/snapshots by default. */
async function run(
  entries: Parameters<typeof buildGraph>[0],
  events: RunnerEvents = {},
  ac = new AbortController(),
) {
  const nodes = buildGraph(entries);
  const state = createInitializationState();
  const snapshots: RunnerSnapshot[] = [];
  const result = await executeGraph(nodes, ac, state, events, (s) => snapshots.push(s));
  return { result, snapshots, finalSnapshot: snapshots[snapshots.length - 1] };
}

describe('buildGraph', () => {
  it('makes each sequential task depend only on the one before it', () => {
    const nodes = buildGraph([task('a'), task('b'), task('c')]);
    expect(nodes.get('a')!.dependsOn).toEqual(new Set());
    expect(nodes.get('b')!.dependsOn).toEqual(new Set(['a']));
    expect(nodes.get('c')!.dependsOn).toEqual(new Set(['b']));
  });

  it('makes parallel-group members depend on the prior barrier, not each other', () => {
    const nodes = buildGraph([task('a'), parallel([task('b'), task('c')]), task('d')]);
    expect(nodes.get('b')!.dependsOn).toEqual(new Set(['a']));
    expect(nodes.get('c')!.dependsOn).toEqual(new Set(['a']));
    expect(nodes.get('d')!.dependsOn).toEqual(new Set(['b', 'c']));
  });

  it('unions explicit dependsOn with the position-derived dependency', () => {
    const nodes = buildGraph([task('a'), task('b', { dependsOn: ['a'] })]);
    expect(nodes.get('b')!.dependsOn).toEqual(new Set(['a']));
  });

  it('throws on a duplicate task id', () => {
    expect(() => buildGraph([task('a'), task('a')])).toThrow(/Duplicate task id/);
  });

  it('throws when dependsOn references an unknown task', () => {
    expect(() => buildGraph([task('a', { dependsOn: ['ghost'] })])).toThrow(/unknown task/);
  });

  it('throws on a direct circular dependency', () => {
    expect(() =>
      buildGraph([task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })]),
    ).toThrow(/Circular dependency/);
  });

  it('throws on an indirect circular dependency', () => {
    expect(() =>
      buildGraph([
        task('a', { dependsOn: ['c'] }),
        task('b', { dependsOn: ['a'] }),
        task('c', { dependsOn: ['b'] }),
      ]),
    ).toThrow(/Circular dependency/);
  });
});

describe('executeGraph — ordering', () => {
  it('runs sequential tasks strictly in order', async () => {
    const order: string[] = [];
    const entries = ['a', 'b', 'c'].map((id) => task(id, { run: async () => void order.push(id) }));
    await run(entries);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('runs a parallel group concurrently — neither member blocks the other', async () => {
    const order: string[] = [];
    const dB = deferred();
    const dC = deferred();
    const b = task('b', {
      run: async () => {
        order.push('b-start');
        await dB.promise;
        order.push('b-end');
      },
    });
    const c = task('c', {
      run: async () => {
        order.push('c-start');
        await dC.promise;
        order.push('c-end');
      },
    });

    const runPromise = run([parallel([b, c])]);
    await tick();
    expect(order).toEqual(['b-start', 'c-start']);

    dC.resolve();
    await tick();
    expect(order).toEqual(['b-start', 'c-start', 'c-end']);

    dB.resolve();
    await runPromise;
    expect(order).toEqual(['b-start', 'c-start', 'c-end', 'b-end']);
  });

  it('waits for every member of a parallel group before running what follows', async () => {
    const order: string[] = [];
    const dB = deferred();
    const b = task('b', {
      run: async () => {
        await dB.promise;
        order.push('b');
      },
    });
    const c = task('c', { run: async () => void order.push('c') });
    const d = task('d', { run: async () => void order.push('d') });

    const runPromise = run([parallel([b, c]), d]);
    await tick();
    expect(order).toEqual(['c']);

    dB.resolve();
    await runPromise;
    expect(order).toEqual(['c', 'b', 'd']);
  });

  it('lets explicit dependsOn order two tasks inside the same parallel group', async () => {
    const order: string[] = [];
    const dC = deferred();
    const c = task('c', {
      run: async () => {
        order.push('c-start');
        await dC.promise;
        order.push('c-end');
      },
    });
    const d = task('d', { dependsOn: ['c'], run: async () => void order.push('d-start') });

    const runPromise = run([parallel([c, d])]);
    await tick();
    expect(order).toEqual(['c-start']);

    dC.resolve();
    await runPromise;
    expect(order).toEqual(['c-start', 'c-end', 'd-start']);
  });
});

describe('executeGraph — retry', () => {
  it('retries a failing task and succeeds within the retry budget', async () => {
    let attempts = 0;
    const t = task('a', {
      retry: 3,
      run: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`fail ${attempts}`);
      },
    });
    const { finalSnapshot } = await run([t]);
    expect(attempts).toBe(3);
    expect(finalSnapshot.tasks).toEqual([{ id: 'a', status: 'completed' }]);
  });

  it('marks the task failed after exhausting all retry attempts', async () => {
    let attempts = 0;
    const t = task('a', {
      retry: 2,
      run: async () => {
        attempts += 1;
        throw new Error('always fails');
      },
    });
    const { finalSnapshot } = await run([t]);
    expect(attempts).toBe(2);
    expect(finalSnapshot.tasks).toEqual([{ id: 'a', status: 'failed' }]);
  });
});

describe('executeGraph — timeout', () => {
  it('treats an attempt exceeding `timeout` as a failure', async () => {
    const onTaskFailed = vi.fn();
    const t = task('a', {
      timeout: 10,
      run: () => new Promise(() => {}), // never resolves
    });
    const { finalSnapshot } = await run([t], { onTaskFailed });
    expect(finalSnapshot.tasks).toEqual([{ id: 'a', status: 'failed' }]);
    expect(onTaskFailed).toHaveBeenCalledWith(t, expect.any(InitializerTimeoutError));
  });
});

describe('executeGraph — critical vs non-critical failure', () => {
  it('defaults to critical: a failing task records the top-level error', async () => {
    const t = task('a', {
      run: async () => {
        throw new Error('boom');
      },
    });
    const { result } = await run([t]);
    expect(result.error).toEqual({ taskId: 'a', error: expect.any(Error) });
  });

  it('a critical failure skips dependent tasks and does not run them', async () => {
    const runB = vi.fn(async () => {});
    const a = task('a', {
      run: async () => {
        throw new Error('boom');
      },
    });
    const b = task('b', { run: runB });
    const { finalSnapshot } = await run([a, b]);
    expect(runB).not.toHaveBeenCalled();
    expect(finalSnapshot.tasks).toEqual([
      { id: 'a', status: 'failed' },
      { id: 'b', status: 'skipped' },
    ]);
  });

  it('a non-critical failure does not record a top-level error and independent tasks still run', async () => {
    const runB = vi.fn(async () => {});
    const a = task('a', {
      critical: false,
      run: async () => {
        throw new Error('boom');
      },
    });
    const b = task('b', { run: runB });
    const { result, finalSnapshot } = await run([parallel([a, b])]);
    expect(result.error).toBeNull();
    expect(runB).toHaveBeenCalledTimes(1);
    expect(finalSnapshot.tasks).toEqual(
      expect.arrayContaining([
        { id: 'a', status: 'failed' },
        { id: 'b', status: 'completed' },
      ]),
    );
  });

  it('skips a task that depends on a non-critical task that failed', async () => {
    const runB = vi.fn(async () => {});
    const a = task('a', {
      critical: false,
      run: async () => {
        throw new Error('boom');
      },
    });
    const b = task('b', { run: runB });
    const { finalSnapshot } = await run([a, b]);
    expect(runB).not.toHaveBeenCalled();
    expect(finalSnapshot.tasks).toEqual([
      { id: 'a', status: 'failed' },
      { id: 'b', status: 'skipped' },
    ]);
  });
});

describe('executeGraph — condition', () => {
  it('skips the task without running it when condition resolves false', async () => {
    const runSpy = vi.fn(async () => {});
    const t = task('a', { condition: async () => false, run: runSpy });
    const { finalSnapshot } = await run([t]);
    expect(runSpy).not.toHaveBeenCalled();
    expect(finalSnapshot.tasks).toEqual([{ id: 'a', status: 'skipped' }]);
  });

  it('runs the task normally when condition resolves true', async () => {
    const t = task('a', { condition: async () => true });
    const { finalSnapshot } = await run([t]);
    expect(finalSnapshot.tasks).toEqual([{ id: 'a', status: 'completed' }]);
  });

  it('treats a throwing condition as a task failure that respects `critical`', async () => {
    const t = task('a', {
      condition: async () => {
        throw new Error('condition exploded');
      },
    });
    const { result, finalSnapshot } = await run([t]);
    expect(finalSnapshot.tasks).toEqual([{ id: 'a', status: 'failed' }]);
    expect(result.error).toEqual({ taskId: 'a', error: expect.any(Error) });
  });
});

describe('executeGraph — cancellation', () => {
  it('marks concurrent in-flight, independent tasks cancelled once the whole graph is aborted', async () => {
    const ac = new AbortController();
    const dA = deferred();
    const dB = deferred();
    const a = task('a', { run: () => dA.promise });
    const b = task('b', { run: () => dB.promise });

    const runPromise = run([parallel([a, b])], {}, ac);
    await tick();
    ac.abort();
    dA.resolve();
    dB.resolve();
    const { finalSnapshot } = await runPromise;

    expect(finalSnapshot.tasks).toEqual(
      expect.arrayContaining([
        { id: 'a', status: 'cancelled' },
        { id: 'b', status: 'cancelled' },
      ]),
    );
  });

  it('cascades a dependent task to "skipped" when its dependency was cancelled by an abort', async () => {
    const ac = new AbortController();
    const dA = deferred();
    const a = task('a', {
      run: async () => {
        await dA.promise;
      },
    });
    const b = task('b'); // sequential — depends on `a` by position

    const runPromise = run([a, b], {}, ac);
    await tick();
    ac.abort();
    dA.resolve();
    const { finalSnapshot } = await runPromise;

    expect(finalSnapshot.tasks).toEqual([
      { id: 'a', status: 'cancelled' },
      { id: 'b', status: 'skipped' },
    ]);
  });
});

describe('executeGraph — progress', () => {
  it('reflects settled/total, reaching 100 when everything has settled', async () => {
    const { snapshots } = await run([task('a'), task('b')]);
    const progressValues = snapshots.map((s) => s.progress);
    expect(progressValues[progressValues.length - 1]).toBe(100);
    expect(progressValues).toEqual([...progressValues].sort((x, y) => x - y));
  });

  it('is 100 immediately for an empty task list', async () => {
    const { result, snapshots } = await run([]);
    expect(result.error).toBeNull();
    expect(snapshots[0].progress).toBe(100);
  });
});

describe('executeGraph — lifecycle events', () => {
  it('fires onTaskStart/onTaskComplete for a successful task', async () => {
    const onTaskStart = vi.fn();
    const onTaskComplete = vi.fn();
    const t = task('a');
    await run([t], { onTaskStart, onTaskComplete });
    expect(onTaskStart).toHaveBeenCalledWith(t);
    expect(onTaskComplete).toHaveBeenCalledWith(t);
  });

  it('fires onTaskFailed with the task and the thrown error', async () => {
    const onTaskFailed = vi.fn();
    const error = new Error('boom');
    const t = task('a', {
      run: async () => {
        throw error;
      },
    });
    await run([t], { onTaskFailed });
    expect(onTaskFailed).toHaveBeenCalledWith(t, error);
  });
});
