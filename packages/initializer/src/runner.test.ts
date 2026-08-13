import { describe, expect, it, vi } from 'vitest';
import { runStages, InitializerTimeoutError } from './runner';
import { createInitializationState } from './state';
import { parallel, type InitializationTask } from './task';
import type { InitializerEvents, InitializerSnapshot } from './runner';
import type { TaskEntry } from './task';

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

const completed = (id: string, critical = true) => ({
  id,
  status: 'completed' as const,
  critical,
  durationMs: expect.any(Number),
});
const skipped = (id: string, critical = true) => ({ id, status: 'skipped' as const, critical });
const cancelled = (id: string, critical = true) => ({ id, status: 'cancelled' as const, critical });
const failed = (id: string, critical = true) => ({
  id,
  status: 'failed' as const,
  critical,
  error: expect.anything(),
  durationMs: expect.any(Number),
});

/** Runs `entries` to completion with no-op events/snapshots by default. */
async function run(entries: TaskEntry[], events: InitializerEvents = {}, ac = new AbortController()) {
  const state = createInitializationState();
  const snapshots: InitializerSnapshot[] = [];
  const result = await runStages(entries, ac, state, events, (s) => snapshots.push(s));
  return { result, snapshots, finalSnapshot: snapshots[snapshots.length - 1] };
}

describe('runStages — validation', () => {
  it('throws on a duplicate task id across separate stages', async () => {
    await expect(run([task('a'), task('a')])).rejects.toThrow(/Duplicate task id/);
  });

  it('throws on a duplicate task id within the same parallel() group', async () => {
    await expect(run([parallel([task('a'), task('a')])])).rejects.toThrow(/Duplicate task id/);
  });
});

describe('runStages — ordering', () => {
  it('runs sequential tasks (one-task stages) strictly in order', async () => {
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

  it('waits for every member of a parallel group (stage) before running what follows', async () => {
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

  it('an empty parallel([]) stage is a pure no-op and does not affect ordering', async () => {
    const order: string[] = [];
    const runPromise = run([
      task('a', { run: async () => void order.push('a') }),
      parallel([]),
      task('b', { run: async () => void order.push('b') }),
    ]);
    await runPromise;
    expect(order).toEqual(['a', 'b']);
  });
});

describe('runStages — retry', () => {
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
    expect(finalSnapshot.tasks).toEqual([completed('a')]);
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
    expect(finalSnapshot.tasks).toEqual([failed('a')]);
  });

  it('waits `retryDelay` ms between attempts, not before the first or after the last', async () => {
    const timestamps: number[] = [];
    const t = task('a', {
      retry: 3,
      retryDelay: 30,
      run: async () => {
        timestamps.push(Date.now());
        throw new Error('always fails');
      },
    });
    await run([t]);
    expect(timestamps).toHaveLength(3);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(25);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(25);
  });

  it('supports a retryDelay function, called once per retry (not per attempt)', async () => {
    const seenAttempts: number[] = [];
    const t = task('a', {
      retry: 3,
      retryDelay: (attempt) => {
        seenAttempts.push(attempt);
        return 1;
      },
      run: async () => {
        throw new Error('always fails');
      },
    });
    await run([t]);
    expect(seenAttempts).toEqual([1, 2]);
  });

  it('defaults retryDelay to 0 — attempts still run back-to-back when unset', async () => {
    const timestamps: number[] = [];
    const t = task('a', {
      retry: 3,
      run: async () => {
        timestamps.push(Date.now());
        throw new Error('always fails');
      },
    });
    const start = Date.now();
    await run([t]);
    expect(Date.now() - start).toBeLessThan(25);
    expect(timestamps).toHaveLength(3);
  });
});

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

describe('runStages — timeout', () => {
  it('treats an attempt exceeding `timeout` as a failure', async () => {
    const onTaskFailed = vi.fn();
    const t = task('a', {
      timeout: 10,
      run: () => new Promise(() => {}), // never resolves
    });
    const { finalSnapshot } = await run([t], { onTaskFailed });
    expect(finalSnapshot.tasks).toEqual([failed('a')]);
    expect(onTaskFailed).toHaveBeenCalledWith(t, expect.any(InitializerTimeoutError));
  });

  it('warns via console.warn once a task has run past 50% of its timeout budget', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = task('a', { timeout: 20, run: () => new Promise(() => {}) }); // never resolves
    await run([t]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Task "a" is still running past 50% of its 20ms timeout'),
    );
    warnSpy.mockRestore();
  });

  it('does not warn about the halfway point for a task that finishes well within its timeout', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run([task('a', { timeout: 1000 })]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('trips a per-attempt signal on timeout, so at most one retry attempt is ever truly in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const t = task('slow', {
      timeout: 20,
      retry: 3,
      run: async ({ signal }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await abortableDelay(200, signal);
        } finally {
          inFlight -= 1;
        }
      },
    });
    const { finalSnapshot } = await run([t]);
    expect(maxInFlight).toBe(1);
    expect(inFlight).toBe(0);
    expect(finalSnapshot.tasks).toEqual([failed('slow')]);
  });

  it('a per-attempt timeout does not abort the whole run', async () => {
    const ac = new AbortController();
    const t = task('slow', {
      critical: false,
      timeout: 20,
      run: async ({ signal }) => {
        await abortableDelay(200, signal);
      },
    });
    const { result } = await run([t], {}, ac);
    expect(ac.signal.aborted).toBe(false);
    expect(result.error).toBeNull();
  });
});

describe('runStages — concurrency (parallel options)', () => {
  it('parallel(tasks, { concurrency }) caps how many run at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const makeTask = (id: string) =>
      task(id, {
        run: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await tick();
          inFlight -= 1;
        },
      });
    const tasks = ['a', 'b', 'c', 'd', 'e'].map(makeTask);

    await run([parallel(tasks, { concurrency: 2 })]);

    expect(maxInFlight).toBe(2);
    expect(inFlight).toBe(0);
  });

  it('does not cap concurrency when no `concurrency` option is given', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const makeTask = (id: string) =>
      task(id, {
        run: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await tick();
          inFlight -= 1;
        },
      });
    const tasks = ['a', 'b', 'c'].map(makeTask);

    await run([parallel(tasks)]);

    expect(maxInFlight).toBe(3);
  });
});

describe('runStages — critical vs non-critical failure', () => {
  it('defaults to critical: a failing task records the top-level error', async () => {
    const t = task('a', {
      run: async () => {
        throw new Error('boom');
      },
    });
    const { result } = await run([t]);
    expect(result.error).toEqual({ taskId: 'a', error: expect.any(Error) });
  });

  it('a critical failure aborts the run, so a later stage never starts and ends up cancelled', async () => {
    const runB = vi.fn(async () => {});
    const a = task('a', {
      run: async () => {
        throw new Error('boom');
      },
    });
    const b = task('b', { run: runB });
    const { finalSnapshot } = await run([a, b]);
    expect(runB).not.toHaveBeenCalled();
    expect(finalSnapshot.tasks).toEqual([failed('a'), cancelled('b')]);
  });

  it('a non-critical failure does not record a top-level error, and a later stage still runs normally', async () => {
    const runB = vi.fn(async () => {});
    const a = task('a', {
      critical: false,
      run: async () => {
        throw new Error('boom');
      },
    });
    const b = task('b', { run: runB });
    const { result, finalSnapshot } = await run([a, b]);
    expect(result.error).toBeNull();
    expect(runB).toHaveBeenCalledTimes(1);
    expect(finalSnapshot.tasks).toEqual([failed('a', false), completed('b')]);
  });

  it('a non-critical failure within a shared stage does not stop siblings in that same stage', async () => {
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
    expect(finalSnapshot.tasks).toEqual(expect.arrayContaining([failed('a', false), completed('b')]));
  });

  it('task-1 regression: [config, analytics(critical:false, throws), auth(critical:true)] — auth actually runs', async () => {
    const authRan = vi.fn();
    const entries = [
      task('config'),
      task('analytics', {
        critical: false,
        run: async () => {
          throw new Error('down');
        },
      }),
      task('auth', { critical: true, run: async () => void authRan() }),
    ];
    const { result, finalSnapshot } = await run(entries);
    expect(authRan).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
    expect(finalSnapshot.tasks).toEqual([completed('config'), failed('analytics', false), completed('auth')]);
  });
});

describe('runStages — condition', () => {
  it('skips the task without running it when condition resolves false — the only source of "skipped"', async () => {
    const runSpy = vi.fn(async () => {});
    const t = task('a', { condition: async () => false, run: runSpy });
    const { finalSnapshot } = await run([t]);
    expect(runSpy).not.toHaveBeenCalled();
    expect(finalSnapshot.tasks).toEqual([skipped('a')]);
  });

  it('runs the task normally when condition resolves true', async () => {
    const t = task('a', { condition: async () => true });
    const { finalSnapshot } = await run([t]);
    expect(finalSnapshot.tasks).toEqual([completed('a')]);
  });

  it('treats a throwing condition as a task failure that respects `critical` — no durationMs, since `run` never started', async () => {
    const t = task('a', {
      condition: async () => {
        throw new Error('condition exploded');
      },
    });
    const { result, finalSnapshot } = await run([t]);
    expect(finalSnapshot.tasks).toEqual([
      { id: 'a', status: 'failed', critical: true, error: expect.any(Error) },
    ]);
    expect(finalSnapshot.tasks[0]).not.toHaveProperty('durationMs');
    expect(result.error).toEqual({ taskId: 'a', error: expect.any(Error) });
  });
});

describe('runStages — cancellation', () => {
  it('marks concurrent in-flight, independent tasks cancelled once the whole run is aborted', async () => {
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

    expect(finalSnapshot.tasks).toEqual(expect.arrayContaining([cancelled('a'), cancelled('b')]));
  });

  it('a later stage ends up cancelled (not skipped) once an earlier stage was aborted', async () => {
    const ac = new AbortController();
    const dA = deferred();
    const a = task('a', {
      run: async () => {
        await dA.promise;
      },
    });
    const b = task('b');

    const runPromise = run([a, b], {}, ac);
    await tick();
    ac.abort();
    dA.resolve();
    const { finalSnapshot } = await runPromise;

    expect(finalSnapshot.tasks).toEqual([cancelled('a'), cancelled('b')]);
  });
});

describe('runStages — progress', () => {
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

describe('runStages — lifecycle events', () => {
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

describe('runStages — per-task callbacks', () => {
  it('fires onStart/onSuccess for a successful task, with the run context', async () => {
    const onStart = vi.fn();
    const onSuccess = vi.fn();
    const t = task('a', { onStart, onSuccess });
    await run([t]);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('does not fire onSuccess/onError for a task skipped via condition', async () => {
    const onStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const t = task('a', { condition: async () => false, onStart, onSuccess, onError });
    await run([t]);
    expect(onStart).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('fires onError (not onSuccess) with the thrown error once retries are exhausted', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const error = new Error('boom');
    const t = task('a', {
      onSuccess,
      onError,
      run: async () => {
        throw error;
      },
    });
    await run([t]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('fires onError when a throwing condition fails the task, without ever calling onStart', async () => {
    const onStart = vi.fn();
    const onError = vi.fn();
    const conditionError = new Error('condition exploded');
    const t = task('a', {
      onStart,
      onError,
      condition: async () => {
        throw conditionError;
      },
    });
    await run([t]);
    expect(onStart).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(conditionError, expect.anything());
  });

  it('fires per-task callbacks alongside the run-wide events, both scoped to their own task', async () => {
    const order: string[] = [];
    const a = task('a', { onSuccess: () => order.push('a-onSuccess') });
    const b = task('b', { onSuccess: () => order.push('b-onSuccess') });
    await run([a, b], {
      onTaskComplete: (t) => order.push(`${t.id}-onTaskComplete`),
    });
    expect(order).toEqual(['a-onSuccess', 'a-onTaskComplete', 'b-onSuccess', 'b-onTaskComplete']);
  });
});
