import { isParallelGroup, type TaskEntry } from './task';
import type { StateMap } from './state';

/**
 * `true` unless a bundler/runtime has explicitly set `NODE_ENV=production`.
 * Guarded for environments where `process` isn't defined at all (some
 * browser contexts without a bundler polyfill) — treated as non-production,
 * since there's no signal saying otherwise.
 */
export function isDev(): boolean {
  return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
}

/**
 * Static checks over `entries` — no execution required. Pure (no console
 * access) so it's independently testable; `warnAboutTasks` below is the
 * dev-gated, `console.warn`-ing wrapper actually used by `createInitializer`.
 */
export function collectTaskWarnings<S extends StateMap>(entries: readonly TaskEntry<S>[]): string[] {
  const warnings: string[] = [];

  entries.forEach((entry, index) => {
    const isLastStage = index === entries.length - 1;
    const stageTasks = isParallelGroup(entry) ? entry.tasks : [entry];

    for (const task of stageTasks) {
      // A — retry without timeout: a hung single attempt blocks every retry
      // after it forever, since nothing bounds how long an attempt can run.
      if ((task.retry ?? 1) > 1 && !task.timeout) {
        warnings.push(
          `Task "${task.id}" has retry: ${task.retry} but no timeout — a hung attempt blocks ` +
            `every retry after it, since nothing bounds how long a single attempt can run.`,
        );
      }
    }

    // B — a critical: false task in its own sequential stage (not inside a
    // parallel() group) still forces the *next* stage to wait for it to
    // settle, even though its failure won't halt the run. That's likely not
    // what "non-critical" was meant to imply — if it's genuinely fine to
    // ignore, it's usually also fine to run alongside the next stage's work.
    if (!isParallelGroup(entry) && entry.critical === false && !isLastStage) {
      warnings.push(
        `Task "${entry.id}" is critical: false but runs in its own sequential stage — the ` +
          `next stage still waits for it to settle before starting, even though its failure ` +
          `won't block the run. Consider whether it belongs in parallel() with what follows.`,
      );
    }
  });

  return warnings;
}

/** Dev-mode-only (`NODE_ENV !== 'production'`) `console.warn` wrapper around `collectTaskWarnings`. */
export function warnAboutTasks<S extends StateMap>(entries: readonly TaskEntry<S>[]): void {
  if (!isDev()) return;
  for (const warning of collectTaskWarnings(entries)) {
    console.warn(`[@lamstack/initializer] ${warning}`);
  }
}

/**
 * Runs `collectTaskWarnings` and returns its findings as plain strings — e.g.
 * for asserting on in a test, or a lint script — without needing to call
 * `createInitializer` (which would also start scheduling work).
 */
export function checkTasks<S extends StateMap = StateMap>(entries: TaskEntry<S>[]): string[] {
  return collectTaskWarnings(entries);
}
