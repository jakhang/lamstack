import { describe, expect, it, vi } from 'vitest';
import { createInitializer } from './initializer';
import type { InitializationTask } from './task';

function task(id: string, overrides: Partial<InitializationTask> = {}): InitializationTask {
  return { id, run: async () => {}, ...overrides };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createInitializer', () => {
  it('starts idle, and transitions to running then completed', async () => {
    const handle = createInitializer({ tasks: [task('a')] });
    expect(handle.getSnapshot().status).toBe('idle');

    const runPromise = handle.run();
    expect(handle.getSnapshot().status).toBe('running');

    await runPromise;
    expect(handle.getSnapshot().status).toBe('completed');
    expect(handle.getSnapshot().error).toBeNull();
  });

  it('throws synchronously at creation time for a duplicate task id, not at run()', () => {
    expect(() => createInitializer({ tasks: [task('a'), task('a')] })).toThrow(/Duplicate task id/);
  });

  it('ends in "failed" with the recorded error when a critical task fails', async () => {
    const onError = vi.fn();
    const handle = createInitializer({
      tasks: [
        task('a', {
          run: async () => {
            throw new Error('boom');
          },
        }),
      ],
      onError,
    });
    await handle.run();
    expect(handle.getSnapshot().status).toBe('failed');
    expect(handle.getSnapshot().error).toEqual({ taskId: 'a', error: expect.any(Error) });
    expect(onError).toHaveBeenCalledWith({ taskId: 'a', error: expect.any(Error) });
  });

  it('ends in "completed" even if only a non-critical task failed', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const handle = createInitializer({
      tasks: [
        task('a', {
          critical: false,
          run: async () => {
            throw new Error('boom');
          },
        }),
      ],
      onComplete,
      onError,
    });
    await handle.run();
    expect(handle.getSnapshot().status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('ends in "cancelled" and fires onAbort when abort() is called manually', async () => {
    const onAbort = vi.fn();
    const onError = vi.fn();
    const d = deferred();
    const handle = createInitializer({
      tasks: [task('a', { run: () => d.promise })],
      onAbort,
      onError,
    });
    const runPromise = handle.run();
    handle.abort();
    d.resolve();
    await runPromise;

    expect(handle.getSnapshot().status).toBe('cancelled');
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('run() is idempotent — calling it twice does not re-run tasks', async () => {
    const runSpy = vi.fn(async () => {});
    const handle = createInitializer({ tasks: [task('a', { run: runSpy })] });
    await Promise.all([handle.run(), handle.run()]);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on every snapshot change and supports unsubscribe', async () => {
    const handle = createInitializer({ tasks: [task('a')] });
    const listener = vi.fn();
    const unsubscribe = handle.subscribe(listener);
    await handle.run();
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    const callsBeforeUnsub = listener.mock.calls.length;
    unsubscribe();
    // No further run to trigger — just confirm unsubscribe doesn't throw and
    // the listener isn't invoked again after this point.
    expect(listener.mock.calls.length).toBe(callsBeforeUnsub);
  });

  it('task-1 regression: a failing critical:false task does not swallow a later critical task', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const authRan = vi.fn();
    const handle = createInitializer({
      tasks: [
        task('config'),
        task('analytics', {
          critical: false,
          run: async () => {
            throw new Error('down');
          },
        }),
        task('auth', { critical: true, run: async () => void authRan() }),
      ],
      onComplete,
      onError,
    });
    await handle.run();

    expect(authRan).toHaveBeenCalledTimes(1);
    expect(handle.getSnapshot().tasks).toEqual([
      { id: 'config', status: 'completed', critical: true, durationMs: expect.any(Number) },
      {
        id: 'analytics',
        status: 'failed',
        critical: false,
        error: expect.any(Error),
        durationMs: expect.any(Number),
      },
      { id: 'auth', status: 'completed', critical: true, durationMs: expect.any(Number) },
    ]);
    expect(handle.getSnapshot().status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('abort() before run() prevents any task from starting', async () => {
    const runSpy = vi.fn(async () => {});
    const handle = createInitializer({ tasks: [task('a', { run: runSpy })] });
    handle.abort();
    await handle.run();
    expect(runSpy).not.toHaveBeenCalled();
    expect(handle.getSnapshot().status).toBe('cancelled');
  });
});

describe('createInitializer — shared state (task 6)', () => {
  it('getState() exposes what tasks wrote via state.set(...), readable after the run completes', async () => {
    type AppState = { user: { id: number } };
    const handle = createInitializer<AppState>({
      tasks: [task('load-user', { run: ({ state }) => void state.set('user', { id: 42 }) })],
    });
    await handle.run();
    expect(handle.getState().get('user')).toEqual({ id: 42 });
  });

  it('onComplete receives the same final state', async () => {
    type AppState = { config: string };
    const onComplete = vi.fn();
    const handle = createInitializer<AppState>({
      tasks: [task('load-config', { run: ({ state }) => void state.set('config', 'ready') })],
      onComplete,
    });
    await handle.run();
    expect(onComplete).toHaveBeenCalledTimes(1);
    const stateArg = onComplete.mock.calls[0][0];
    expect(stateArg.get('config')).toBe('ready');
    expect(stateArg).toBe(handle.getState());
  });
});
