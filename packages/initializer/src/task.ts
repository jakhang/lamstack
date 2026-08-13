import type { InitializationContext } from './context';
import type { StateMap } from './state';

/**
 * A single initialization task. Parameterize with a `StateMap` (e.g.
 * `InitializationTask<{ user: User }>`) to get `context.state.get`/`.set`
 * type-checked per key instead of `unknown`-typed.
 */
export interface InitializationTask<S extends StateMap = StateMap> {
  /** Uniquely identifies the task — used for tracking and error reporting. */
  id: string;

  /** Human-readable name for UI (splash/error screens) — falls back to `id` if unset. */
  label?: string;

  /**
   * Whether a failure of this task halts the entire initialization.
   * Defaults to `true` — tasks are assumed required unless explicitly opted
   * out via `critical: false`.
   */
  critical?: boolean;

  /**
   * Maximum number of attempts (the first try plus retries). Defaults to 1
   * (no retry).
   */
  retry?: number;

  /**
   * Delay (ms) before each retry — not before the first attempt, and not
   * after the last one. A number applies the same delay every time; a
   * function `(attempt) => ms` receives the 1-based attempt that just failed,
   * for custom backoff (e.g. exponential: `(n) => 2 ** n * 100`). Defaults to
   * 0 — attempts run back-to-back, as before.
   */
  retryDelay?: number | ((attempt: number) => number);

  /** Maximum time (ms) allowed per attempt before it's treated as a failure. */
  timeout?: number;

  /**
   * Optional predicate deciding whether to run this task at all. Returning
   * `false` skips it — the only source of a `'skipped'` status. A
   * throwing/rejecting `condition` is treated as a task failure.
   */
  condition?: (context: InitializationContext<S>) => boolean | Promise<boolean>;

  /**
   * The task's actual work. Written as `run: (context) => ...` (a property,
   * not method shorthand) so the parameter is checked contravariantly rather
   * than bivariantly — method shorthand silently accepts a `run` typed for
   * an incompatible narrower/wider context. May return `void` for
   * synchronous work — it doesn't have to be an async function that awaits
   * nothing just to satisfy the type.
   */
  run: (context: InitializationContext<S>) => void | Promise<void>;

  /**
   * Called right before this task's `run` starts (after `condition` passes,
   * if any) — fires alongside the run-wide `onTaskStart` event passed to
   * `createInitializer`, but scoped to just this task.
   */
  onStart?: (context: InitializationContext<S>) => void;

  /** Called once this task's `run` completes successfully (after any retries). */
  onSuccess?: (context: InitializationContext<S>) => void;

  /**
   * Called when this task ultimately fails — `run` (after exhausting
   * `retry`) or `condition` threw/rejected. Fires alongside the run-wide
   * `onTaskFailed` event, before a `critical` failure aborts the run.
   */
  onError?: (error: unknown, context: InitializationContext<S>) => void;
}

export interface ParallelOptions {
  /**
   * Max number of this group's tasks running at once (e.g. to cap
   * simultaneous network requests when batching many independent fetches).
   * Defaults to unlimited — every task in the group starts together, as soon
   * as the previous stage has settled.
   */
  concurrency?: number;
}

/** A stage whose tasks all run concurrently, rather than one task alone. */
export interface ParallelGroup<S extends StateMap = StateMap> {
  type: 'parallel';
  tasks: InitializationTask<S>[];
  concurrency?: number;
}

export type TaskEntry<S extends StateMap = StateMap> = InitializationTask<S> | ParallelGroup<S>;

/**
 * Marks a batch of tasks as safe to run concurrently. Use only for tasks
 * that are independent of each other — the initializer waits for the whole
 * group to settle before moving on to whatever comes next.
 */
export function parallel<S extends StateMap = StateMap>(
  tasks: InitializationTask<S>[],
  options?: ParallelOptions,
): ParallelGroup<S> {
  return { type: 'parallel', tasks, concurrency: options?.concurrency };
}

export function isParallelGroup<S extends StateMap = StateMap>(entry: TaskEntry<S>): entry is ParallelGroup<S> {
  return 'type' in entry && entry.type === 'parallel';
}
