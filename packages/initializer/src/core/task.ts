import type { InitializationContext } from './context';

/**
 * A single initialization task.
 */
export interface InitializationTask {
  /** Uniquely identifies the task — used for `dependsOn`, tracking, and error reporting. */
  id: string;

  /**
   * Ids of tasks that must complete successfully before this one starts, in
   * addition to whatever ordering is implied by this task's position in the
   * `tasks` array (see `parallel()` and the sequential-by-default rule).
   */
  dependsOn?: string[];

  /**
   * Whether a failure of this task halts the entire initialization.
   * Defaults to `true` — tasks are assumed required unless explicitly opted
   * out via `critical: false`.
   */
  critical?: boolean;

  /**
   * Maximum number of attempts (the first try plus retries). Defaults to 1
   * (no retry). Attempts run immediately one after another, no backoff.
   */
  retry?: number;

  /** Maximum time (ms) allowed per attempt before it's treated as a failure. */
  timeout?: number;

  /**
   * Optional predicate deciding whether to run this task at all. Returning
   * `false` skips the task (and, transitively, anything that `dependsOn`
   * it). A throwing/rejecting `condition` is treated as a task failure.
   */
  condition?: (context: InitializationContext) => boolean | Promise<boolean>;

  /** The task's actual work. */
  run(context: InitializationContext): Promise<void>;
}

/** A batch of tasks that run concurrently against the same set of dependencies. */
export interface ParallelGroup {
  type: 'parallel';
  tasks: InitializationTask[];
}

export type TaskEntry = InitializationTask | ParallelGroup;

/**
 * Marks a batch of tasks as safe to run concurrently. Use only for tasks
 * that are independent of each other — the initializer waits for the whole
 * group to settle before moving on to whatever comes next.
 */
export function parallel(tasks: InitializationTask[]): ParallelGroup {
  return { type: 'parallel', tasks };
}

export function isParallelGroup(entry: TaskEntry): entry is ParallelGroup {
  return 'type' in entry && entry.type === 'parallel';
}
