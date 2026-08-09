import { buildGraph, executeGraph, type RunnerEvents, type RunnerSnapshot } from './runner';
import { createInitializationState } from './state';
import type { TaskEntry } from './task';

export interface InitializerOptions extends RunnerEvents {
  tasks: TaskEntry[];
}

export interface InitializerHandle {
  /** Starts the initialization sequence. Calling this more than once is a no-op. */
  run(): Promise<void>;
  /** Aborts the sequence in progress. Not-yet-started tasks are marked `cancelled`. */
  abort(): void;
  getSnapshot(): RunnerSnapshot;
  /** Registers a listener called whenever the snapshot changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * Framework-independent entry point: builds the dependency graph up front
 * (so a malformed graph — a cycle, an unknown `dependsOn` id, a duplicate id
 * — throws immediately, before `run()`), and returns a small observable
 * store around the DAG executor in `./runner`.
 */
export function createInitializer(options: InitializerOptions): InitializerHandle {
  const { tasks, ...events } = options;
  const nodes = buildGraph(tasks);
  const state = createInitializationState();
  const ac = new AbortController();

  let started = false;
  let manuallyAborted = false;
  let snapshot: RunnerSnapshot = {
    status: 'idle',
    progress: nodes.size === 0 ? 100 : 0,
    tasks: [...nodes.keys()].map((id) => ({ id, status: 'pending' as const })),
    error: null,
  };

  const listeners = new Set<() => void>();
  const setSnapshot = (next: RunnerSnapshot) => {
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
    const result = await executeGraph(nodes, ac, state, events, setSnapshot);

    const finalStatus = manuallyAborted ? 'cancelled' : result.error ? 'failed' : 'completed';
    setSnapshot({ ...snapshot, status: finalStatus, error: finalStatus === 'failed' ? result.error : null });

    if (finalStatus === 'cancelled') events.onAbort?.();
    else if (finalStatus === 'failed') events.onError?.(result.error!);
    else events.onComplete?.();
  };

  return {
    run,
    abort,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
