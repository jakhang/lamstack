import type { InitializationState } from './state';

/** Passed to every task's `run`/`condition`. */
export interface InitializationContext {
  /** Tripped when the whole initialization is aborted (manually, or by a critical task failing). */
  signal: AbortSignal;
  /** Shared key/value bag for passing data between tasks. */
  state: InitializationState;
}
