import type { InitializationContext } from './context';
import type { InitializationState } from './state';
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
  status: InitializationTaskStatus;
}

export interface RunnerSnapshot {
  status: InitializationStatus;
  /** Percentage of tasks that have settled (0-100). */
  progress: number;
  tasks: TaskSnapshot[];
  error: InitializationError | null;
}

export interface RunnerEvents {
  onTaskStart?: (task: InitializationTask) => void;
  onTaskComplete?: (task: InitializationTask) => void;
  onTaskFailed?: (task: InitializationTask, error: unknown) => void;
  onComplete?: () => void;
  onError?: (error: InitializationError) => void;
  onAbort?: () => void;
}

export class InitializerTimeoutError extends Error {
  constructor(taskId: string, timeout: number) {
    super(`[@omnireact/initializer] Task "${taskId}" timed out after ${timeout}ms`);
    this.name = 'InitializerTimeoutError';
  }
}

export interface GraphNode {
  task: InitializationTask;
  dependsOn: Set<string>;
}

/**
 * =============================================================================
 * Graph construction
 * =============================================================================
 *
 * `tasks` is flattened into a dependency graph. Two mechanisms produce
 * dependencies, and they're unioned together:
 *
 *  - Position: scanning the array in order, each entry depends on the
 *    "barrier" set left by whatever came immediately before it. A plain task
 *    becomes the new one-task barrier for what follows. A `parallel([...])`
 *    group's tasks all depend on the same prior barrier (so they run
 *    concurrently, not on each other) and, together, become the barrier for
 *    what follows — the initializer waits for the whole group before moving
 *    on.
 *  - `dependsOn`: explicit extra dependencies, for edges that position alone
 *    can't express (e.g. a later task depending on a non-adjacent earlier
 *    one).
 *
 * If a dependency doesn't complete successfully (failed, skipped, or
 * cancelled), tasks that depend on it are skipped rather than run — see
 * `runNode`.
 * =============================================================================
 */
export function buildGraph(entries: readonly TaskEntry[]): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  let barrier: string[] = [];

  const addNode = (task: InitializationTask, autoDeps: readonly string[]) => {
    if (nodes.has(task.id)) {
      throw new Error(`[@omnireact/initializer] Duplicate task id: "${task.id}"`);
    }
    nodes.set(task.id, { task, dependsOn: new Set([...autoDeps, ...(task.dependsOn ?? [])]) });
  };

  for (const entry of entries) {
    if (isParallelGroup(entry)) {
      for (const task of entry.tasks) addNode(task, barrier);
      barrier = entry.tasks.map((task) => task.id);
    } else {
      addNode(entry, barrier);
      barrier = [entry.id];
    }
  }

  for (const node of nodes.values()) {
    for (const depId of node.dependsOn) {
      if (!nodes.has(depId)) {
        throw new Error(
          `[@omnireact/initializer] Task "${node.task.id}" depends on unknown task "${depId}"`,
        );
      }
    }
  }

  assertAcyclic(nodes);
  return nodes;
}

function assertAcyclic(nodes: Map<string, GraphNode>): void {
  const visited = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, path: readonly string[]) => {
    const mark = visited.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') {
      throw new Error(
        `[@omnireact/initializer] Circular dependency detected: ${[...path, id].join(' -> ')}`,
      );
    }
    visited.set(id, 'visiting');
    for (const depId of nodes.get(id)!.dependsOn) {
      visit(depId, [...path, id]);
    }
    visited.set(id, 'done');
  };

  for (const id of nodes.keys()) visit(id, []);
}

// =============================================================================
// Execution
// =============================================================================

async function runWithTimeout(task: InitializationTask, context: InitializationContext): Promise<void> {
  if (!task.timeout) {
    await task.run(context);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InitializerTimeoutError(task.id, task.timeout!)), task.timeout);
  });
  try {
    await Promise.race([task.run(context), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `task` up to `task.retry` times (default 1, i.e. no retry), immediately, with no backoff. */
async function runWithRetry(task: InitializationTask, context: InitializationContext): Promise<void> {
  const maxAttempts = Math.max(1, task.retry ?? 1);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runWithTimeout(task, context);
      return;
    } catch (error) {
      lastError = error;
      if (context.signal.aborted) throw error;
    }
  }
  throw lastError;
}

async function runNode(
  node: GraphNode,
  statuses: Map<string, InitializationTaskStatus>,
  context: InitializationContext,
  reportCriticalFailure: (error: InitializationError) => void,
  updateStatus: (id: string, status: InitializationTaskStatus) => void,
  events: RunnerEvents,
): Promise<void> {
  const { task } = node;

  // A task with unsatisfied dependencies is "skipped" (cascade), regardless
  // of *why* the dependency didn't complete — including a dependency that
  // was itself cancelled by an abort. Tasks with no dependencies vacuously
  // pass this check and fall through to the plain abort check below, so an
  // independent branch that never got to start is correctly "cancelled"
  // rather than "skipped".
  const depsSatisfied = [...node.dependsOn].every((depId) => statuses.get(depId) === 'completed');
  if (!depsSatisfied) {
    updateStatus(task.id, 'skipped');
    return;
  }

  if (context.signal.aborted) {
    updateStatus(task.id, 'cancelled');
    return;
  }

  if (task.condition) {
    let shouldRun: boolean;
    try {
      shouldRun = await task.condition(context);
    } catch (conditionError) {
      updateStatus(task.id, 'failed');
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
  events.onTaskStart?.(task);

  try {
    await runWithRetry(task, context);
    if (context.signal.aborted) {
      updateStatus(task.id, 'cancelled');
      return;
    }
    updateStatus(task.id, 'completed');
    events.onTaskComplete?.(task);
  } catch (error) {
    if (context.signal.aborted) {
      updateStatus(task.id, 'cancelled');
      return;
    }
    updateStatus(task.id, 'failed');
    events.onTaskFailed?.(task, error);
    if (task.critical !== false) reportCriticalFailure({ taskId: task.id, error });
  }
}

export interface ExecuteGraphResult {
  /** The first critical task failure, if any halted the run. */
  error: InitializationError | null;
}

/**
 * Runs every node in `nodes` to completion, respecting the dependency graph
 * (independent branches run concurrently — a node starts as soon as its
 * dependencies have all settled). `emitSnapshot` is called after every task
 * status transition so callers can drive reactive UI.
 */
export async function executeGraph(
  nodes: Map<string, GraphNode>,
  ac: AbortController,
  state: InitializationState,
  events: RunnerEvents,
  emitSnapshot: (snapshot: RunnerSnapshot) => void,
): Promise<ExecuteGraphResult> {
  const context: InitializationContext = { signal: ac.signal, state };
  const total = nodes.size;
  let settledCount = 0;
  let recordedError: InitializationError | null = null;

  const statuses = new Map<string, InitializationTaskStatus>();
  for (const id of nodes.keys()) statuses.set(id, 'pending');

  const snapshot = (): RunnerSnapshot => ({
    status: 'running',
    progress: total === 0 ? 100 : Math.round((settledCount / total) * 100),
    tasks: [...statuses.entries()].map(([id, status]) => ({ id, status })),
    error: recordedError,
  });

  const updateStatus = (id: string, status: InitializationTaskStatus) => {
    statuses.set(id, status);
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

  const promises = new Map<string, Promise<void>>();
  const getOrCreatePromise = (id: string): Promise<void> => {
    let p = promises.get(id);
    if (!p) {
      const node = nodes.get(id)!;
      p = (async () => {
        await Promise.all([...node.dependsOn].map((depId) => getOrCreatePromise(depId)));
        await runNode(node, statuses, context, reportCriticalFailure, updateStatus, events);
      })();
      promises.set(id, p);
    }
    return p;
  };

  for (const id of nodes.keys()) getOrCreatePromise(id);
  await Promise.all(promises.values());

  return { error: recordedError };
}
