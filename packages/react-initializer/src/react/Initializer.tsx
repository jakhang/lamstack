'use client';
import * as React from 'react';
import { createInitializer, type InitializerHandle } from '../core/initializer';
import type { InitializationError, InitializerEvents, InitializerSnapshot, TaskSnapshot } from '../core/runner';
import { createInitializationState } from '../core/state';
import type { StateMap } from '../core/state';
import type { TaskEntry } from '../core/task';
import { InitializerContext } from './InitializerContext';

const noop = () => {};
const noopSubscribe = () => noop;
const idleSnapshot: InitializerSnapshot = { status: 'idle', progress: 0, tasks: [], error: null };
const getIdleSnapshot = () => idleSnapshot;
const emptyState = createInitializationState();
const getEmptyState = () => emptyState;

// `useLayoutEffect` on the client, `useEffect` on the server (SSR would warn
// otherwise). Creating the handle and calling `run()` here — instead of in a
// regular `useEffect` — lets synchronously/near-instantly resolving runs
// (e.g. `tasks: []`) settle before the browser paints, instead of guaranteed
// showing the splash screen for at least one frame first (see P1-5).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

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

export interface CancelledScreenProps {
  retry: () => void;
}

export interface InitializerProps<S extends StateMap = StateMap> extends InitializerEvents<S> {
  tasks: TaskEntry<S>[];
  /** Custom loading UI, shown while any task is pending/running. */
  splashScreen?: React.ComponentType<SplashScreenProps>;
  /** Custom error UI, shown when a critical task fails. */
  errorScreen?: React.ComponentType<ErrorScreenProps>;
  /** Custom UI shown when the run was cancelled via `abort()` (e.g. from a "Skip" button on the splash screen). Without this, `<Initializer>` would otherwise be stuck showing the splash screen forever after a cancellation. */
  cancelledScreen?: React.ComponentType<CancelledScreenProps>;
  /**
   * Once the splash screen has been shown, keep it up for at least this many
   * ms before switching to `children`/`errorScreen`/`cancelledScreen` — even
   * if the run settles sooner. Prevents a jarring flash for runs that are
   * fast but not instant (e.g. resolve in 50ms). Defaults to 0 (no minimum).
   */
  minSplashDuration?: number;
  /** The app to render once initialization completes. */
  children: React.ReactNode;
}

/** `String(x)` on a plain thrown object gives `[object Object]` — this tries harder. */
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

const DefaultSplashScreen: React.FC<SplashScreenProps> = ({ progress }) => (
  <div role="status" aria-live="polite" aria-busy="true" style={{ padding: 20, textAlign: 'center' }}>
    <h2>
      Initializing... {progress}%
    </h2>
  </div>
);

const DefaultErrorScreen: React.FC<ErrorScreenProps> = ({ error, retry }) => (
  <div role="alert" style={{ padding: 20, color: 'red', textAlign: 'center' }}>
    <h2>Initialization Failed</h2>
    <p>
      Task &quot;{error.taskId}&quot; failed: {formatError(error.error)}
    </p>
    <button onClick={retry}>Retry</button>
  </div>
);

const DefaultCancelledScreen: React.FC<CancelledScreenProps> = ({ retry }) => (
  <div role="status" style={{ padding: 20, textAlign: 'center' }}>
    <h2>Initialization Cancelled</h2>
    <button onClick={retry}>Retry</button>
  </div>
);

/**
 * Runs `tasks` — a sequence of stages (a task, or `parallel([...])` tasks
 * running concurrently) — before rendering `children`, with retry, timeout,
 * and critical/non-critical failure handling built in. Shows `splashScreen`
 * while running and `errorScreen` if a critical task fails.
 *
 * `tasks`/event-handler props are only read at the moment a run (re)starts
 * (mount, or after `retry()`/the error screen's Retry button is used).
 * Changing them mid-flight does not restart or reactively affect an
 * in-progress run.
 */
export function Initializer<S extends StateMap = StateMap>({
  tasks,
  splashScreen: SplashScreen = DefaultSplashScreen,
  errorScreen: ErrorScreen = DefaultErrorScreen,
  cancelledScreen: CancelledScreen = DefaultCancelledScreen,
  minSplashDuration = 0,
  children,
  ...events
}: InitializerProps<S>) {
  const [retryIndex, setRetryIndex] = React.useState(0);
  // null only for the brief window before the first layout effect below runs.
  const [handle, setHandle] = React.useState<InitializerHandle<S> | null>(null);

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
  // Layout (not passive) so a synchronously/near-instantly settling run
  // (e.g. `tasks: []`) never paints an intermediate splash frame — see P1-5.
  useIsomorphicLayoutEffect(() => {
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
    () => ({ ...snapshot, retry, abort: handle?.abort ?? noop, getState: handle?.getState ?? getEmptyState }),
    [snapshot, retry, handle],
  );

  const isSettled = snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled';

  // `holding` is flipped true the moment the splash first appears (while
  // still unsettled) — *before* `isSettled` can ever flip true — so the very
  // first render where `isSettled` becomes true already has it available and
  // computes `showSettled` correctly. Flipping it reactively (after the
  // fact, once already settled) would show settled content for one frame
  // first, then yank it back for `minSplashDuration` — the opposite of the
  // intent. `Date.now()` only ever runs inside effects, never in the render
  // body itself, which render must stay pure of.
  const holdingStartedAt = React.useRef<number | null>(null);
  const [holding, setHolding] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    holdingStartedAt.current = null;
    setHolding(false);
  }, [retryIndex]);

  useIsomorphicLayoutEffect(() => {
    if (!isSettled && minSplashDuration > 0 && !holding) {
      holdingStartedAt.current = Date.now();
      setHolding(true);
    }
  }, [isSettled, minSplashDuration, holding]);

  React.useEffect(() => {
    if (!isSettled || !holding || holdingStartedAt.current === null) return;
    const remaining = minSplashDuration - (Date.now() - holdingStartedAt.current);
    if (remaining <= 0) {
      setHolding(false);
      return;
    }
    const timer = setTimeout(() => setHolding(false), remaining);
    return () => clearTimeout(timer);
  }, [isSettled, holding, minSplashDuration]);

  const showSettled = isSettled && !holding;

  return (
    <InitializerContext.Provider value={contextValue}>
      {showSettled && snapshot.status === 'failed' && snapshot.error ? (
        <ErrorScreen error={snapshot.error} retry={retry} />
      ) : showSettled && snapshot.status === 'cancelled' ? (
        <CancelledScreen retry={retry} />
      ) : showSettled && snapshot.status === 'completed' ? (
        children
      ) : (
        <SplashScreen progress={snapshot.progress} tasks={snapshot.tasks} />
      )}
    </InitializerContext.Provider>
  );
}
