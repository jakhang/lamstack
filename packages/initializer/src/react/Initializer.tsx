'use client';
import * as React from 'react';
import { createInitializer, type InitializerHandle } from '../core/initializer';
import type { InitializationError, RunnerEvents, RunnerSnapshot, TaskSnapshot } from '../core/runner';
import type { TaskEntry } from '../core/task';
import { InitializerContext } from './InitializerContext';

const noop = () => {};
const noopSubscribe = () => noop;
const idleSnapshot: RunnerSnapshot = { status: 'idle', progress: 0, tasks: [], error: null };
const getIdleSnapshot = () => idleSnapshot;

export interface SplashScreenProps {
  /** Percentage of tasks that have settled (0-100). */
  progress: number;
  /** Per-task status, in the order tasks were declared. */
  tasks: TaskSnapshot[];
}

export interface ErrorScreenProps {
  error: InitializationError;
  retry: () => void;
}

export interface InitializerProps extends RunnerEvents {
  tasks: TaskEntry[];
  /** Custom loading UI, shown while any task is pending/running. */
  splashScreen?: React.ComponentType<SplashScreenProps>;
  /** Custom error UI, shown when a critical task fails. */
  errorScreen?: React.ComponentType<ErrorScreenProps>;
  /** The app to render once initialization completes. */
  children: React.ReactNode;
}

const DefaultSplashScreen: React.FC<SplashScreenProps> = ({ progress }) => (
  <div style={{ padding: 20, textAlign: 'center' }}>
    <h2>
      Initializing... {progress}%
    </h2>
  </div>
);

const DefaultErrorScreen: React.FC<ErrorScreenProps> = ({ error, retry }) => (
  <div style={{ padding: 20, color: 'red', textAlign: 'center' }}>
    <h2>Initialization Failed</h2>
    <p>
      Task &quot;{error.taskId}&quot; failed: {String(error.error)}
    </p>
    <button onClick={retry}>Retry</button>
  </div>
);

/**
 * Runs `tasks` — a dependency graph of async initialization work, with
 * optional parallel batching, retry, timeout, and critical/non-critical
 * failure handling — before rendering `children`. Shows `splashScreen`
 * while running and `errorScreen` if a critical task fails.
 *
 * `tasks`/event-handler props are only read at the moment a run (re)starts
 * (mount, or after `retry()`/the error screen's Retry button is used).
 * Changing them mid-flight does not restart or reactively affect an
 * in-progress run.
 */
export function Initializer({
  tasks,
  splashScreen: SplashScreen = DefaultSplashScreen,
  errorScreen: ErrorScreen = DefaultErrorScreen,
  children,
  ...events
}: InitializerProps) {
  const [retryIndex, setRetryIndex] = React.useState(0);
  // null only for the brief window before the first effect below runs.
  const [handle, setHandle] = React.useState<InitializerHandle | null>(null);

  const tasksRef = React.useRef(tasks);
  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const eventsRef = React.useRef(events);
  React.useEffect(() => {
    eventsRef.current = events;
  });

  const retry = React.useCallback(() => {
    setRetryIndex((index) => index + 1);
  }, []);

  // Building the handle reads tasksRef/eventsRef, so it belongs in an effect
  // (refs may not be read during render) — this also naturally implements
  // "tasks/events are only read at the moment a run (re)starts": this effect
  // only reruns on retryIndex, not on every tasks/events identity change.
  React.useEffect(() => {
    const newHandle = createInitializer({ tasks: tasksRef.current, ...eventsRef.current });
    setHandle(newHandle);
    void newHandle.run();
    return () => newHandle.abort();
  }, [retryIndex]);

  const snapshot = React.useSyncExternalStore(
    handle ? handle.subscribe : noopSubscribe,
    handle ? handle.getSnapshot : getIdleSnapshot,
    handle ? handle.getSnapshot : getIdleSnapshot,
  );

  const contextValue = React.useMemo(
    () => ({ ...snapshot, retry, abort: handle?.abort ?? noop }),
    [snapshot, retry, handle],
  );

  return (
    <InitializerContext.Provider value={contextValue}>
      {snapshot.status === 'failed' && snapshot.error ? (
        <ErrorScreen error={snapshot.error} retry={retry} />
      ) : snapshot.status !== 'completed' ? (
        <SplashScreen progress={snapshot.progress} tasks={snapshot.tasks} />
      ) : (
        children
      )}
    </InitializerContext.Provider>
  );
}
