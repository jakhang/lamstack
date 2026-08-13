import type { InitializationContext } from './context';
import { isDev } from './dev-warnings';
import type { InitializationState, StateMap } from './state';
import { isParallelGroup, type InitializationTask, type TaskEntry } from './task';

export type InitializationStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type InitializationTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface InitializationError {
  taskId: string;
  error: unknown;
}

export interface TaskSnapshot {
  id: string;
  /** Human-readable label for UI, if the task set one — falls back to `id` otherwise. */
  label?: string;
  status: InitializationTaskStatus;
  /** Whether this task's failure halts the whole run (mirrors `InitializationTask.critical`, defaulting to `true`). */
  critical: boolean;
  /**
   * The error that caused a 'failed' status, for both critical and
   * non-critical failures. `InitializerSnapshot.error` only ever holds the
   * first *critical* failure — a `critical: false` task's error is
   * otherwise only reachable via the `onTaskFailed` event, invisible to any
   * UI that only reads snapshots.
   */
  error?: unknown;
  /** How long the task's `run` took, once settled (`completed` or `failed`). Not set for `pending`/`running`/`skipped`/`cancelled`. */
  durationMs?: number;
}

export interface InitializerSnapshot {
  status: InitializationStatus;
  /** Percentage of tasks that have settled (0-100). */
  progress: number;
  tasks: TaskSnapshot[];
  error: InitializationError | null;
}

export interface InitializerEvents<S extends StateMap = StateMap> {
  onTaskStart?: (task: InitializationTask<S>) => void;
  onTaskComplete?: (task: InitializationTask<S>) => void;
  onTaskFailed?: (task: InitializationTask<S>, error: unknown) => void;
  /** Fires once the run completes successfully, with the final shared `state` — see `InitializerHandle.getState`. */
  onComplete?: (state: InitializationState<S>) => void;
  onError?: (error: InitializationError) => void;
  onAbort?: () => void;
}

export class InitializerTimeoutError extends Error {
  constructor(taskId: string, timeout: number) {
    super(`[@lamstack/initializer] Task "${taskId}" timed out after ${timeout}ms`);
    this.name = 'InitializerTimeoutError';
  }
}

/** Caps how many `parallel()` tasks in the same stage run at once — see `ParallelOptions.concurrency`. */
class Semaphore {
  private available: number;
  private readonly queue: (() => void)[] = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.available -= 1;
  }

  release(): void {
    this.available += 1;
    this.queue.shift()?.();
  }
}

/** Every task across every stage, in declared order — the flat unit `id` uniqueness, initial snapshots, and progress totals are all computed over. */
function flattenTasks<S extends StateMap>(entries: readonly TaskEntry<S>[]): InitializationTask<S>[] {
  const tasks: InitializationTask<S>[] = [];
  for (const entry of entries) {
    if (isParallelGroup(entry)) tasks.push(...entry.tasks);
    else tasks.push(entry);
  }
  return tasks;
}

/**
 * Throws on a duplicate task id — the only structural validation left once
 * there's no dependency graph to check — and returns the flattened task
 * list, so `createInitializer` can build its initial snapshot from the same
 * pass instead of flattening `entries` a second time.
 */
export function validateTasks<S extends StateMap>(entries: readonly TaskEntry<S>[]): InitializationTask<S>[] {
  const tasks = flattenTasks(entries);
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`[@lamstack/initializer] Duplicate task id: "${task.id}"`);
    }
    seen.add(task.id);
  }
  return tasks;
}

/**
 * Runs one attempt. On timeout, trips a signal scoped to *this attempt* —
 * derived from `context.signal` so a whole-run abort still propagates —
 * rather than just walking away from `task.run()` via `Promise.race` and
 * leaving it running in the background. A task that checks `signal` (e.g. an
 * abortable delay, or passing it to `fetch`) can now actually stop; one that
 * doesn't still can't be forcibly killed — JS has no preemptive cancellation,
 * only cooperative, same as the whole-run abort in `runStages`.
 */
async function runWithTimeout<S extends StateMap>(
  task: InitializationTask<S>,
  context: InitializationContext<S>,
): Promise<void> {
  if (!task.timeout) {
    await task.run(context);
    return;
  }

  const timeoutController = new AbortController();
  const attemptContext: InitializationContext<S> = {
    ...context,
    signal: AbortSignal.any([context.signal, timeoutController.signal]),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort();
      reject(new InitializerTimeoutError(task.id, task.timeout!));
    }, task.timeout);
  });

  // Dev-only early warning at 50% of the budget — a task that's frequently
  // this close to timing out is worth a heads-up before it starts actually
  // failing, not just a hard cutoff at 100%.
  let halfwayTimer: ReturnType<typeof setTimeout> | undefined;
  if (isDev()) {
    halfwayTimer = setTimeout(() => {
      console.warn(
        `[@lamstack/initializer] Task "${task.id}" is still running past 50% of its ` +
          `${task.timeout}ms timeout.`,
      );
    }, task.timeout / 2);
  }

  try {
    await Promise.race([task.run(attemptContext), timeoutPromise]);
  } finally {
    clearTimeout(timer);
    clearTimeout(halfwayTimer);
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts — whichever comes first. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Runs `task` up to `task.retry` times (default 1, i.e. no retry), waiting `task.retryDelay` between attempts. */
async function runWithRetry<S extends StateMap>(
  task: InitializationTask<S>,
  context: InitializationContext<S>,
): Promise<void> {
  const maxAttempts = Math.max(1, task.retry ?? 1);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runWithTimeout(task, context);
      return;
    } catch (error) {
      lastError = error;
      if (context.signal.aborted) throw error;
      if (attempt < maxAttempts && task.retryDelay) {
        const delayMs = typeof task.retryDelay === 'function' ? task.retryDelay(attempt) : task.retryDelay;
        if (delayMs > 0) await abortableSleep(delayMs, context.signal);
        if (context.signal.aborted) throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Runs a single task to completion: `condition` check, then `run` (with
 * retry/timeout), reporting every status transition via `updateStatus`. A
 * critical failure is reported via `reportCriticalFailure`, which aborts the
 * whole run — `runStages` is what stops moving to the next stage once that
 * happens, this function only ever handles the one task in front of it.
 */
async function runTask<S extends StateMap>(
  task: InitializationTask<S>,
  context: InitializationContext<S>,
  reportCriticalFailure: (error: InitializationError) => void,
  updateStatus: (id: string, status: InitializationTaskStatus, error?: unknown, durationMs?: number) => void,
  events: InitializerEvents<S>,
): Promise<void> {
  if (context.signal.aborted) {
    updateStatus(task.id, 'cancelled');
    return;
  }

  if (task.condition) {
    let shouldRun: boolean;
    try {
      shouldRun = await task.condition(context);
    } catch (conditionError) {
      updateStatus(task.id, 'failed', conditionError);
      task.onError?.(conditionError, context);
      events.onTaskFailed?.(task, conditionError);
      if (task.critical !== false) reportCriticalFailure({ taskId: task.id, error: conditionError });
      return;
    }
    if (context.signal.aborted) {
      updateStatus(task.id, 'cancelled');
      return;
    }
    if (!shouldRun) {
      updateStatus(task.id, 'skipped');
      return;
    }
  }

  updateStatus(task.id, 'running');
  task.onStart?.(context);
  events.onTaskStart?.(task);
  const startedAt = Date.now();

  try {
    await runWithRetry(task, context);
    if (context.signal.aborted) {
      updateStatus(task.id, 'cancelled');
      return;
    }
    updateStatus(task.id, 'completed', undefined, Date.now() - startedAt);
    task.onSuccess?.(context);
    events.onTaskComplete?.(task);
  } catch (error) {
    if (context.signal.aborted) {
      updateStatus(task.id, 'cancelled');
      return;
    }
    updateStatus(task.id, 'failed', error, Date.now() - startedAt);
    task.onError?.(error, context);
    events.onTaskFailed?.(task, error);
    if (task.critical !== false) reportCriticalFailure({ taskId: task.id, error });
  }
}

export interface RunStagesResult {
  /** The first critical task failure, if any halted the run. */
  error: InitializationError | null;
}

/**
 * Runs `entries` — a list of stages, each either one task or a
 * `parallel([...])` group — strictly in order: every task in a stage starts
 * together and the run waits for all of them to settle before moving to the
 * next stage. A critical failure aborts the signal, which stops the *next*
 * stage from starting (tasks already in flight in the current stage still
 * run to completion) — everything that never got a chance to start ends up
 * `'cancelled'`. `emitSnapshot` is called after every task status
 * transition so callers can drive reactive UI.
 */
export async function runStages<S extends StateMap = StateMap>(
  entries: readonly TaskEntry<S>[],
  ac: AbortController,
  state: InitializationState<S>,
  events: InitializerEvents<S>,
  emitSnapshot: (snapshot: InitializerSnapshot) => void,
): Promise<RunStagesResult> {
  const context: InitializationContext<S> = { signal: ac.signal, state };
  const allTasks = validateTasks(entries);
  const total = allTasks.length;
  let settledCount = 0;
  let recordedError: InitializationError | null = null;

  const statuses = new Map<string, InitializationTaskStatus>();
  const taskErrors = new Map<string, unknown>();
  const durations = new Map<string, number>();
  for (const task of allTasks) statuses.set(task.id, 'pending');

  const snapshot = (): InitializerSnapshot => ({
    status: 'running',
    progress: total === 0 ? 100 : Math.round((settledCount / total) * 100),
    tasks: allTasks.map((task) => ({
      id: task.id,
      label: task.label,
      status: statuses.get(task.id)!,
      critical: task.critical !== false,
      ...(taskErrors.has(task.id) ? { error: taskErrors.get(task.id) } : {}),
      ...(durations.has(task.id) ? { durationMs: durations.get(task.id) } : {}),
    })),
    error: recordedError,
  });

  const updateStatus = (id: string, status: InitializationTaskStatus, error?: unknown, durationMs?: number) => {
    statuses.set(id, status);
    if (status === 'failed') taskErrors.set(id, error);
    if (durationMs !== undefined) durations.set(id, durationMs);
    if (status !== 'running') settledCount += 1;
    emitSnapshot(snapshot());
  };

  const reportCriticalFailure = (error: InitializationError) => {
    if (!recordedError) {
      recordedError = error;
      ac.abort();
    }
  };

  if (total === 0) {
    emitSnapshot(snapshot());
    return { error: null };
  }

  for (const entry of entries) {
    const stageTasks = isParallelGroup(entry) ? entry.tasks : [entry];
    if (stageTasks.length === 0) continue; // an empty parallel([]) is a pure no-op

    const semaphore = isParallelGroup(entry) && entry.concurrency ? new Semaphore(entry.concurrency) : undefined;

    await Promise.all(
      stageTasks.map(async (task) => {
        if (semaphore) await semaphore.acquire();
        try {
          await runTask(task, context, reportCriticalFailure, updateStatus, events);
        } finally {
          semaphore?.release();
        }
      }),
    );

    if (context.signal.aborted) break;
  }

  // Anything still 'pending' never got its stage reached — the run was
  // aborted (manually, or by a critical failure) before then.
  for (const task of allTasks) {
    if (statuses.get(task.id) === 'pending') updateStatus(task.id, 'cancelled');
  }

  return { error: recordedError };
}
