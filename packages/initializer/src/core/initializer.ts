import { warnAboutTasks } from './dev-warnings';
import { runStages, validateTasks, type InitializerEvents, type InitializerSnapshot } from './runner';
import { createInitializationState } from './state';
import type { InitializationState, StateMap } from './state';
import type { TaskEntry } from './task';

export interface InitializerOptions<S extends StateMap = StateMap> extends InitializerEvents<S> {
  tasks: TaskEntry<S>[];
}

export interface InitializerHandle<S extends StateMap = StateMap> {
  /** Starts the run. Calling this more than once is a no-op. */
  run(): Promise<void>;
  /** Aborts the run in progress. Not-yet-started tasks are marked `cancelled`. */
  abort(): void;
  getSnapshot(): InitializerSnapshot;
  /**
   * The shared `state` bag tasks wrote to via `state.set(...)`. Populated
   * throughout the run, but only meaningful to read once `getSnapshot().status`
   * is `'completed'` — mid-run or after a `'failed'`/`'cancelled'` result it
   * may only be partially filled in.
   */
  getState(): InitializationState<S>;
  /** Registers a listener called whenever the snapshot changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * Framework-independent entry point: validates `tasks` up front (so a
 * duplicate id throws immediately, before `run()`), and returns a small
 * observable store around the stage executor in `./runner`.
 */
export function createInitializer<S extends StateMap = StateMap>(
  options: InitializerOptions<S>,
): InitializerHandle<S> {
  const { tasks, ...events } = options;
  const allTasks = validateTasks(tasks);
  warnAboutTasks(tasks);
  const state = createInitializationState<S>();
  const ac = new AbortController();

  let started = false;
  let manuallyAborted = false;
  let snapshot: InitializerSnapshot = {
    status: 'idle',
    progress: allTasks.length === 0 ? 100 : 0,
    tasks: allTasks.map((task) => ({
      id: task.id,
      label: task.label,
      status: 'pending' as const,
      critical: task.critical !== false,
    })),
    error: null,
  };

  const listeners = new Set<() => void>();
  const setSnapshot = (next: InitializerSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const abort = () => {
    if (manuallyAborted || ac.signal.aborted) return;
    manuallyAborted = true;
    ac.abort();
  };

  const run = async (): Promise<void> => {
    if (started) return;
    started = true;

    setSnapshot({ ...snapshot, status: 'running' });
    const result = await runStages(tasks, ac, state, events, setSnapshot);

    const finalStatus = manuallyAborted ? 'cancelled' : result.error ? 'failed' : 'completed';
    setSnapshot({ ...snapshot, status: finalStatus, error: finalStatus === 'failed' ? result.error : null });

    if (finalStatus === 'cancelled') events.onAbort?.();
    else if (finalStatus === 'failed') events.onError?.(result.error!);
    else events.onComplete?.(state);
  };

  return {
    run,
    abort,
    getSnapshot: () => snapshot,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
